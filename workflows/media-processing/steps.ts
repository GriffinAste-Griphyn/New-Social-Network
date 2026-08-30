import { createHash, randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import { get, head, put } from "@vercel/blob"
import { and, eq } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  mediaAssets,
  mediaProcessingJobs,
  mediaRenditions,
  stories,
} from "@/lib/db/schema"
import { invalidateMobileFeedSnapshotsForCreator } from "@/lib/feed-snapshot-store"
import {
  maximumMediaProcessingAttempts,
  mediaAudioProfile,
  mediaEncoderVersion,
  mediaPipelineLimits,
  selectRenditionProfiles,
  type MediaRenditionProfile,
  type MediaSourceMetadata,
  validateSourceMetadata,
} from "@/lib/media-pipeline/contracts"
import { mediaDeliveryAccess } from "@/lib/media-pipeline/features"
import {
  encodeMediaAudioRenditionFile,
  encodeMediaRendition,
  encodeMediaRenditionFile,
  generateMediaPoster,
  generateMediaPosterFile,
  inspectAudioMediaFile,
  inspectMediaFile,
  inspectAndHashMediaStream,
  mediaContentType,
} from "@/lib/media-pipeline/ffmpeg"
import {
  buildHlsMasterPlaylist,
  type PublishedAudioRendition,
  type PublishedRendition,
} from "@/lib/media-pipeline/manifest"
import {
  migrateMediaDeliveryPrefix,
  renditionPrefix,
} from "@/lib/media-pipeline/paths"
import { buildStoryMediaRoute } from "@/lib/story-media/access"
import { enqueueStoryPublication } from "@/lib/story-publication"
import { deriveStoryPublicationStatus } from "@/lib/stories/cloudflare-status"

import { FatalError } from "workflow"

class MediaProcessingFatalError extends FatalError {}

type EncodedRendition = {
  profile: MediaRenditionProfile
  playlistPathname: string
  playlistUrl: string
  byteSize: number
  checksum: string
  segmentCount: number
  encodingMs: number
  codec: string
  durationMs: number
  frameRate: number | null
}

export type EncodedAudioRendition = {
  playlistPathname: string
  playlistUrl: string
  byteSize: number
  checksum: string
  segmentCount: number
  encodingMs: number
  codec: string
  durationMs: number
  bitrate: number
  channels: number
  sampleRate: number
}

type PublishedMaster = {
  pathname: string
  url: string
  byteSize: number
  checksum: string
}

type PublishedPoster = {
  pathname: string
  url: string
  byteSize: number
  checksum: string
}

const renditionUploadConcurrency = 8
const workflowLeaseRecoveryMs = 15 * 60 * 1_000
const activeJobStatuses = ["inspecting", "encoding", "publishing"] as const

function logMediaPipeline(
  level: "info" | "error",
  message: string,
  metadata: Record<string, unknown>,
) {
  const payload = JSON.stringify({
    level,
    message,
    service: "media_pipeline",
    at: new Date().toISOString(),
    ...metadata,
  })
  if (level === "error") console.error(payload)
  else console.info(payload)
}

function privateBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw new MediaProcessingFatalError(
      "BLOB_READ_WRITE_TOKEN is not configured.",
    )
  }
  return token
}

function deliveryBlobToken() {
  const token = process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw new MediaProcessingFatalError(
      "MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN is not configured.",
    )
  }
  return token
}

async function publishRenditionFiles(input: {
  prefix: string
  files: Array<{ fileName: string; body: Buffer }>
  token: string
}) {
  const access = mediaDeliveryAccess()
  const uploaded: Awaited<ReturnType<typeof put>>[] = []
  for (
    let index = 0;
    index < input.files.length;
    index += renditionUploadConcurrency
  ) {
    const batch = input.files.slice(index, index + renditionUploadConcurrency)
    uploaded.push(
      ...(await Promise.all(
        batch.map((file) =>
          put(`${input.prefix}/${file.fileName}`, file.body, {
            access,
            token: input.token,
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 31_536_000,
            contentType: mediaContentType(file.fileName),
          }),
        ),
      )),
    )
  }
  return uploaded
}

function deliveryMediaUrl(blob: { pathname: string; url: string }) {
  return mediaDeliveryAccess() === "public"
    ? blob.url
    : buildStoryMediaRoute(blob.pathname)
}

async function readJob(jobId: string) {
  const [job] = await getDb()
    .select()
    .from(mediaProcessingJobs)
    .where(eq(mediaProcessingJobs.id, jobId))
    .limit(1)

  if (!job) {
    throw new MediaProcessingFatalError(
      `Media processing job ${jobId} was not found.`,
    )
  }
  return job
}

export async function claimMediaProcessingWorkflowStep(
  jobId: string,
  workflowRunId: string,
) {
  "use step"

  const job = await readJob(jobId)
  const isStaleActiveJob =
    activeJobStatuses.some((status) => status === job.status) &&
    job.updatedAt.getTime() <= Date.now() - workflowLeaseRecoveryMs
  if (
    job.status === "ready" ||
    job.attempts >= maximumMediaProcessingAttempts ||
    (!["pending", "error"].includes(job.status) && !isStaleActiveJob)
  ) {
    return null
  }
  const attempt = job.attempts + 1
  const now = new Date()
  const outputPrefix =
    job.encoderVersion === mediaEncoderVersion
      ? job.outputPrefix
      : migrateMediaDeliveryPrefix(job.outputPrefix, mediaEncoderVersion)
  const [claimed] = await getDb()
    .update(mediaProcessingJobs)
    .set({
      workflowRunId,
      encoderVersion: mediaEncoderVersion,
      outputPrefix,
      status: "inspecting",
      attempts: attempt,
      progressPct: Math.max(job.progressPct, 1),
      failureCode: null,
      lastError: null,
      startedAt: job.startedAt ?? now,
      finishedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaProcessingJobs.id, jobId),
        eq(mediaProcessingJobs.status, job.status),
        eq(mediaProcessingJobs.attempts, job.attempts),
        eq(mediaProcessingJobs.updatedAt, job.updatedAt),
      ),
    )
    .returning({ id: mediaProcessingJobs.id })

  if (!claimed) return null

  await getDb()
    .update(mediaAssets)
    .set({ workflowRunId, encoderVersion: mediaEncoderVersion, updatedAt: now })
    .where(eq(mediaAssets.id, job.mediaAssetId))

  return { attempt }
}

async function readPrivateSource(pathname: string) {
  const source = await get(pathname, {
    access: "private",
    token: privateBlobToken(),
    useCache: true,
  })
  if (!source || source.statusCode !== 200 || !source.stream) {
    throw new MediaProcessingFatalError(
      "The private source video could not be read.",
    )
  }
  return source
}

async function stagePrivateSource(pathname: string, outputPath: string) {
  const source = await readPrivateSource(pathname)
  await pipeline(
    Readable.fromWeb(source.stream as import("node:stream/web").ReadableStream),
    createWriteStream(outputPath, { flags: "wx" }),
  )
  return outputPath
}

export async function inspectMediaSourceStep(jobId: string) {
  "use step"

  const job = await readJob(jobId)
  if (job.sourceMetadata) {
    const source = job.sourceMetadata as MediaSourceMetadata
    return { source, profiles: selectRenditionProfiles(source) }
  }

  const sourceHead = await head(job.sourcePathname, {
    token: privateBlobToken(),
  }).catch(() => null)
  if (!sourceHead) {
    throw new MediaProcessingFatalError(
      "The private source video was not found.",
    )
  }
  if (sourceHead.size > mediaPipelineLimits.maximumSourceBytes) {
    throw new MediaProcessingFatalError(
      "The source video exceeds the processing size limit.",
    )
  }

  const sourceBlob = await readPrivateSource(job.sourcePathname)
  const inspected = await inspectAndHashMediaStream(sourceBlob.stream)
  const source = inspected.metadata
  const sourceFailure = validateSourceMetadata(source)
  if (sourceFailure) {
    throw new MediaProcessingFatalError(
      `Media quality control failed: ${sourceFailure}.`,
    )
  }
  const [asset] = await getDb()
    .select({
      checksum: mediaAssets.originalChecksum,
      byteSize: mediaAssets.originalByteSize,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, job.mediaAssetId))
    .limit(1)
  if (
    asset?.checksum &&
    inspected.checksum.toLowerCase() !== asset.checksum.toLowerCase()
  ) {
    throw new MediaProcessingFatalError(
      "The source video failed its integrity check.",
    )
  }
  if (asset?.byteSize && sourceHead.size !== asset.byteSize) {
    throw new MediaProcessingFatalError(
      "The source video size does not match the completed upload.",
    )
  }

  await getDb()
    .update(mediaProcessingJobs)
    .set({
      status: "inspecting",
      progressPct: 10,
      sourceMetadata: source,
      startedAt: job.startedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(mediaProcessingJobs.id, jobId))

  logMediaPipeline("info", "source_inspected", {
    jobId,
    mediaAssetId: job.mediaAssetId,
    width: source.width,
    height: source.height,
    durationMs: source.durationMs,
    frameRate: source.frameRate,
    videoCodec: source.videoCodec,
    hasAudio: source.hasAudio,
    checksum: inspected.checksum,
  })

  return { source, profiles: selectRenditionProfiles(source) }
}

async function encodeMediaRenditionCore(
  jobId: string,
  profile: MediaRenditionProfile,
  sourceMetadata: MediaSourceMetadata,
  stagedSourcePath?: string,
): Promise<EncodedRendition> {
  const job = await readJob(jobId)
  const [existing] = await getDb()
    .select()
    .from(mediaRenditions)
    .where(
      and(
        eq(mediaRenditions.mediaAssetId, job.mediaAssetId),
        eq(mediaRenditions.kind, "hls-variant"),
        eq(mediaRenditions.label, profile.label),
        eq(mediaRenditions.encoderVersion, job.encoderVersion),
        eq(mediaRenditions.status, "ready"),
        eq(mediaRenditions.qualityStatus, "passed"),
      ),
    )
    .limit(1)

  if (existing) {
    const details = (existing.qualityDetails ?? {}) as {
      segmentCount?: number
      encodingMs?: number
    }
    return {
      profile,
      playlistPathname: existing.storageKey,
      playlistUrl: existing.mediaUrl,
      byteSize: existing.byteSize,
      checksum: existing.checksum,
      segmentCount: details.segmentCount ?? 0,
      encodingMs: details.encodingMs ?? 0,
      codec: "avc1.640029",
      durationMs: existing.durationMs ?? sourceMetadata.durationMs,
      frameRate:
        ((existing.qualityDetails ?? {}) as { frameRate?: number | null })
          .frameRate ?? sourceMetadata.frameRate,
    }
  }

  await getDb()
    .update(mediaProcessingJobs)
    .set({ status: "encoding", updatedAt: new Date() })
    .where(eq(mediaProcessingJobs.id, jobId))

  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), `ubeye-${profile.label}-`),
  )
  try {
    const outputDirectory = path.join(tempDirectory, profile.label)
    await mkdir(outputDirectory, { recursive: true })
    const encoded = stagedSourcePath
      ? await encodeMediaRenditionFile({
          inputPath: stagedSourcePath,
          profile,
          outputDirectory,
          sourceMetadata,
        })
      : await readPrivateSource(job.sourcePathname).then((source) =>
          encodeMediaRendition({
            source: source.stream,
            profile,
            outputDirectory,
            sourceMetadata,
          }),
        )
    const playlistFile = encoded.files.find(
      (file) => file.fileName === "index.m3u8",
    )
    const segmentCount = encoded.files.filter((file) =>
      file.fileName.endsWith(".m4s"),
    ).length
    const initFile = encoded.files.find((file) => file.fileName === "init.mp4")

    if (!playlistFile || !initFile || segmentCount === 0) {
      throw new Error(`FFmpeg produced an incomplete ${profile.label} package.`)
    }

    const encodedMetadata = await inspectMediaFile(
      path.join(outputDirectory, "index.m3u8"),
    )
    const durationToleranceMs = Math.max(
      1_500,
      Math.round(sourceMetadata.durationMs * 0.03),
    )
    if (
      encodedMetadata.width !== profile.width ||
      encodedMetadata.height !== profile.height ||
      encodedMetadata.videoCodec !== "h264" ||
      encodedMetadata.hasAudio ||
      Math.abs(encodedMetadata.durationMs - sourceMetadata.durationMs) >
        durationToleranceMs
    ) {
      throw new Error(
        `Encoded ${profile.label} package failed structural quality control.`,
      )
    }

    const token = deliveryBlobToken()
    const prefix = renditionPrefix(job.outputPrefix, profile.label)
    const uploaded = await publishRenditionFiles({
      prefix,
      files: encoded.files,
      token,
    })
    const uploadedPlaylist = uploaded.find((blob) =>
      blob.pathname.endsWith("/index.m3u8"),
    )
    if (!uploadedPlaylist) {
      throw new Error(`The ${profile.label} playlist was not published.`)
    }

    const byteSize = encoded.files.reduce(
      (total, file) => total + file.body.byteLength,
      0,
    )
    const measuredBitrate = Math.max(
      1,
      Math.ceil((byteSize * 8) / Math.max(encodedMetadata.durationMs / 1_000, 0.001)),
    )
    const now = new Date()
    const values = {
      id: `media-rendition-${randomUUID()}`,
      mediaAssetId: job.mediaAssetId,
      processingJobId: job.id,
      kind: "hls-variant",
      label: profile.label,
      storageProvider: "vercel-blob" as const,
      storageKey: uploadedPlaylist.pathname,
      mediaUrl: deliveryMediaUrl(uploadedPlaylist),
      contentType: "application/vnd.apple.mpegurl",
      codec: "avc1.640029",
      width: profile.width,
      height: profile.height,
      durationMs: encodedMetadata.durationMs,
      bitrate: measuredBitrate,
      byteSize,
      checksum: playlistFile.checksum,
      status: "ready" as const,
      qualityStatus: "passed" as const,
      qualityDetails: {
        segmentCount,
        encodingMs: encoded.encodingMs,
        initByteSize: initFile.body.byteLength,
        verifiedWidth: encodedMetadata.width,
        verifiedHeight: encodedMetadata.height,
        verifiedDurationMs: encodedMetadata.durationMs,
        verifiedVideoCodec: encodedMetadata.videoCodec,
        verifiedAudioCodec: encodedMetadata.audioCodec,
        frameRate: encodedMetadata.frameRate,
        measuredBitrate,
      },
      encoderVersion: job.encoderVersion,
      createdAt: now,
      updatedAt: now,
    }

    const [recorded] = await getDb()
      .insert(mediaRenditions)
      .values(values)
      .onConflictDoUpdate({
        target: [
          mediaRenditions.mediaAssetId,
          mediaRenditions.kind,
          mediaRenditions.label,
          mediaRenditions.encoderVersion,
        ],
        set: {
          processingJobId: values.processingJobId,
          storageKey: values.storageKey,
          mediaUrl: values.mediaUrl,
          codec: values.codec,
          durationMs: values.durationMs,
          bitrate: values.bitrate,
          byteSize: values.byteSize,
          checksum: values.checksum,
          status: values.status,
          qualityStatus: values.qualityStatus,
          qualityDetails: values.qualityDetails,
          updatedAt: now,
        },
      })
      .returning()

    logMediaPipeline("info", "rendition_encoded", {
      jobId,
      mediaAssetId: job.mediaAssetId,
      rendition: profile.label,
      byteSize,
      segmentCount,
      encodingMs: encoded.encodingMs,
    })

    return {
      profile,
      playlistPathname: recorded.storageKey,
      playlistUrl: recorded.mediaUrl,
      byteSize,
      checksum: playlistFile.checksum,
      segmentCount,
      encodingMs: encoded.encodingMs,
      codec: values.codec,
      durationMs: encodedMetadata.durationMs,
      frameRate: encodedMetadata.frameRate,
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

async function encodeMediaAudioRenditionCore(
  jobId: string,
  sourceMetadata: MediaSourceMetadata,
  stagedSourcePath?: string,
): Promise<EncodedAudioRendition | null> {
  if (!sourceMetadata.hasAudio) return null

  const job = await readJob(jobId)
  const [existing] = await getDb()
    .select()
    .from(mediaRenditions)
    .where(
      and(
        eq(mediaRenditions.mediaAssetId, job.mediaAssetId),
        eq(mediaRenditions.kind, "hls-audio"),
        eq(mediaRenditions.label, mediaAudioProfile.label),
        eq(mediaRenditions.encoderVersion, job.encoderVersion),
        eq(mediaRenditions.status, "ready"),
        eq(mediaRenditions.qualityStatus, "passed"),
      ),
    )
    .limit(1)

  if (existing) {
    const details = (existing.qualityDetails ?? {}) as {
      segmentCount?: number
      encodingMs?: number
      verifiedChannels?: number
      verifiedSampleRate?: number
    }
    return {
      playlistPathname: existing.storageKey,
      playlistUrl: existing.mediaUrl,
      byteSize: existing.byteSize,
      checksum: existing.checksum,
      segmentCount: details.segmentCount ?? 0,
      encodingMs: details.encodingMs ?? 0,
      codec: existing.codec ?? "mp4a.40.2",
      durationMs: existing.durationMs ?? sourceMetadata.durationMs,
      bitrate: existing.bitrate ?? mediaAudioProfile.bitrate,
      channels: details.verifiedChannels ?? (sourceMetadata.audioChannels === 1 ? 1 : 2),
      sampleRate: details.verifiedSampleRate ?? mediaAudioProfile.sampleRate,
    }
  }

  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ubeye-audio-"))
  try {
    const sourcePath = stagedSourcePath ?? path.join(tempDirectory, "source")
    if (!stagedSourcePath) {
      await stagePrivateSource(job.sourcePathname, sourcePath)
    }
    const outputDirectory = path.join(tempDirectory, mediaAudioProfile.label)
    await mkdir(outputDirectory, { recursive: true })
    const encoded = await encodeMediaAudioRenditionFile({
      inputPath: sourcePath,
      outputDirectory,
      audioChannels: sourceMetadata.audioChannels,
    })
    const playlistFile = encoded.files.find(
      (file) => file.fileName === "index.m3u8",
    )
    const initFile = encoded.files.find((file) => file.fileName === "init.mp4")
    const segmentCount = encoded.files.filter((file) =>
      file.fileName.endsWith(".m4s"),
    ).length
    if (!playlistFile || !initFile || segmentCount === 0) {
      throw new Error("FFmpeg produced an incomplete audio package.")
    }

    const encodedMetadata = await inspectAudioMediaFile(
      path.join(outputDirectory, "index.m3u8"),
    )
    const expectedChannels = sourceMetadata.audioChannels === 1 ? 1 : 2
    const durationToleranceMs = Math.max(
      1_500,
      Math.round(sourceMetadata.durationMs * 0.03),
    )
    const bitrateIsInvalid =
      encodedMetadata.audioBitrate !== null &&
      (encodedMetadata.audioBitrate < 120_000 ||
        encodedMetadata.audioBitrate > 190_000)
    if (
      encodedMetadata.audioCodec !== "aac" ||
      encodedMetadata.hasVideo ||
      encodedMetadata.audioChannels !== expectedChannels ||
      encodedMetadata.audioSampleRate !== mediaAudioProfile.sampleRate ||
      bitrateIsInvalid ||
      Math.abs(encodedMetadata.durationMs - sourceMetadata.durationMs) >
        durationToleranceMs
    ) {
      throw new Error("Encoded audio package failed structural quality control.")
    }

    const uploaded = await publishRenditionFiles({
      prefix: renditionPrefix(job.outputPrefix, mediaAudioProfile.label),
      files: encoded.files,
      token: deliveryBlobToken(),
    })
    const uploadedPlaylist = uploaded.find((blob) =>
      blob.pathname.endsWith("/index.m3u8"),
    )
    if (!uploadedPlaylist) {
      throw new Error("The audio playlist was not published.")
    }

    const byteSize = encoded.files.reduce(
      (total, file) => total + file.body.byteLength,
      0,
    )
    const measuredBitrate = Math.max(
      1,
      Math.ceil(
        (byteSize * 8) /
          Math.max(encodedMetadata.durationMs / 1_000, 0.001),
      ),
    )
    const now = new Date()
    const values = {
      id: `media-rendition-${randomUUID()}`,
      mediaAssetId: job.mediaAssetId,
      processingJobId: job.id,
      kind: "hls-audio",
      label: mediaAudioProfile.label,
      storageProvider: "vercel-blob" as const,
      storageKey: uploadedPlaylist.pathname,
      mediaUrl: deliveryMediaUrl(uploadedPlaylist),
      contentType: "application/vnd.apple.mpegurl",
      codec: "mp4a.40.2",
      durationMs: encodedMetadata.durationMs,
      bitrate: measuredBitrate,
      byteSize,
      checksum: playlistFile.checksum,
      status: "ready" as const,
      qualityStatus: "passed" as const,
      qualityDetails: {
        segmentCount,
        encodingMs: encoded.encodingMs,
        initByteSize: initFile.body.byteLength,
        verifiedDurationMs: encodedMetadata.durationMs,
        verifiedAudioCodec: encodedMetadata.audioCodec,
        verifiedAudioBitrate: encodedMetadata.audioBitrate,
        verifiedChannels: encodedMetadata.audioChannels,
        verifiedSampleRate: encodedMetadata.audioSampleRate,
        measuredBitrate,
        loudnessNormalization: false,
      },
      encoderVersion: job.encoderVersion,
      createdAt: now,
      updatedAt: now,
    }
    const [recorded] = await getDb()
      .insert(mediaRenditions)
      .values(values)
      .onConflictDoUpdate({
        target: [
          mediaRenditions.mediaAssetId,
          mediaRenditions.kind,
          mediaRenditions.label,
          mediaRenditions.encoderVersion,
        ],
        set: {
          processingJobId: values.processingJobId,
          storageKey: values.storageKey,
          mediaUrl: values.mediaUrl,
          contentType: values.contentType,
          codec: values.codec,
          durationMs: values.durationMs,
          bitrate: values.bitrate,
          byteSize: values.byteSize,
          checksum: values.checksum,
          status: values.status,
          qualityStatus: values.qualityStatus,
          qualityDetails: values.qualityDetails,
          updatedAt: now,
        },
      })
      .returning()

    logMediaPipeline("info", "audio_rendition_encoded", {
      jobId,
      mediaAssetId: job.mediaAssetId,
      bitrate: measuredBitrate,
      channels: encodedMetadata.audioChannels,
      sampleRate: encodedMetadata.audioSampleRate,
      encodingMs: encoded.encodingMs,
    })

    return {
      playlistPathname: recorded.storageKey,
      playlistUrl: recorded.mediaUrl,
      byteSize,
      checksum: playlistFile.checksum,
      segmentCount,
      encodingMs: encoded.encodingMs,
      codec: values.codec,
      durationMs: encodedMetadata.durationMs,
      bitrate: measuredBitrate,
      channels: expectedChannels,
      sampleRate: mediaAudioProfile.sampleRate,
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

export async function encodeMediaRenditionStep(
  jobId: string,
  profile: MediaRenditionProfile,
  sourceMetadata: MediaSourceMetadata,
) {
  "use step"
  return encodeMediaRenditionCore(jobId, profile, sourceMetadata)
}

export async function encodeMediaAudioRenditionStep(
  jobId: string,
  sourceMetadata: MediaSourceMetadata,
) {
  "use step"
  return encodeMediaAudioRenditionCore(jobId, sourceMetadata)
}

export async function encodeMediaRenditionBatchStep(
  jobId: string,
  profiles: MediaRenditionProfile[],
  sourceMetadata: MediaSourceMetadata,
) {
  "use step"

  const job = await readJob(jobId)
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ubeye-source-batch-"))
  try {
    const sourcePath = path.join(tempDirectory, "source")
    await stagePrivateSource(job.sourcePathname, sourcePath)
    const renditions: EncodedRendition[] = []
    for (const profile of profiles) {
      renditions.push(
        await encodeMediaRenditionCore(
          jobId,
          profile,
          sourceMetadata,
          sourcePath,
        ),
      )
    }
    return renditions
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

export async function publishMasterPlaylistStep(
  jobId: string,
  renditions: EncodedRendition[],
  audio?: EncodedAudioRendition | null,
): Promise<PublishedMaster> {
  "use step"

  const job = await readJob(jobId)
  const ordered = [...renditions].sort(
    (left, right) => left.profile.height - right.profile.height,
  )
  if (ordered.length === 0 || ordered.some((item) => item.segmentCount < 1)) {
    throw new MediaProcessingFatalError(
      "No verified HLS renditions are available to publish.",
    )
  }
  if (audio && audio.segmentCount < 1) {
    throw new MediaProcessingFatalError(
      "No verified HLS audio rendition is available to publish.",
    )
  }

  const playlist = buildHlsMasterPlaylist(
    ordered.map(
      (item): PublishedRendition => ({
        profile: item.profile,
        playlistUrl: `${item.profile.label}/index.m3u8`,
        codec: item.codec,
        byteSize: item.byteSize,
        durationMs: item.durationMs,
        frameRate: item.frameRate,
      }),
    ),
    audio
      ? ({
          playlistUrl: `${mediaAudioProfile.label}/index.m3u8`,
          codec: audio.codec,
          bitrate: audio.bitrate,
        } satisfies PublishedAudioRendition)
      : null,
  )
  const body = Buffer.from(playlist, "utf8")
  const checksum = createHash("sha256").update(body).digest("hex")
  const renditionLabels = ordered.map((item) => item.profile.label)
  const masterFileName =
    `master-${renditionLabels.join("-")}-${checksum.slice(0, 12)}.m3u8`
  const blob = await put(`${job.outputPrefix}/${masterFileName}`, body, {
    access: mediaDeliveryAccess(),
    token: deliveryBlobToken(),
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31_536_000,
    contentType: "application/vnd.apple.mpegurl",
  })

  const now = new Date()
  await getDb()
    .insert(mediaRenditions)
    .values({
      id: `media-rendition-${randomUUID()}`,
      mediaAssetId: job.mediaAssetId,
      processingJobId: job.id,
      kind: "hls-master",
      label: "adaptive",
      storageProvider: "vercel-blob",
      storageKey: blob.pathname,
      mediaUrl: deliveryMediaUrl(blob),
      contentType: "application/vnd.apple.mpegurl",
      byteSize: body.byteLength,
      checksum,
      status: "ready",
      qualityStatus: "passed",
      qualityDetails: {
        renditionCount: ordered.length,
        renditionLabels,
        hasAudioRendition: Boolean(audio),
      },
      encoderVersion: job.encoderVersion,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        mediaRenditions.mediaAssetId,
        mediaRenditions.kind,
        mediaRenditions.label,
        mediaRenditions.encoderVersion,
      ],
      set: {
        processingJobId: job.id,
        storageKey: blob.pathname,
        mediaUrl: deliveryMediaUrl(blob),
        byteSize: body.byteLength,
        checksum,
        status: "ready",
        qualityStatus: "passed",
        qualityDetails: {
          renditionCount: ordered.length,
          renditionLabels,
          hasAudioRendition: Boolean(audio),
        },
        updatedAt: now,
      },
    })
  await getDb()
    .update(mediaProcessingJobs)
    .set({ status: "publishing", updatedAt: now })
    .where(eq(mediaProcessingJobs.id, jobId))

  logMediaPipeline("info", "master_published", {
    jobId,
    mediaAssetId: job.mediaAssetId,
    renditionCount: ordered.length,
    renditionLabels,
    masterFileName,
    byteSize: body.byteLength,
  })

  return {
    pathname: blob.pathname,
    url: deliveryMediaUrl(blob),
    byteSize: body.byteLength,
    checksum,
  }
}

async function generateMediaPosterCore(
  jobId: string,
  stagedSourcePath?: string,
): Promise<PublishedPoster> {
  const job = await readJob(jobId)
  const [existing] = await getDb()
    .select()
    .from(mediaRenditions)
    .where(
      and(
        eq(mediaRenditions.mediaAssetId, job.mediaAssetId),
        eq(mediaRenditions.kind, "poster"),
        eq(mediaRenditions.label, "540x960"),
        eq(mediaRenditions.encoderVersion, job.encoderVersion),
        eq(mediaRenditions.status, "ready"),
      ),
    )
    .limit(1)
  if (existing) {
    return {
      pathname: existing.storageKey,
      url: existing.mediaUrl,
      byteSize: existing.byteSize,
      checksum: existing.checksum,
    }
  }

  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ubeye-poster-"))
  try {
    const outputPath = path.join(tempDirectory, "poster.jpg")
    const poster = stagedSourcePath
      ? await generateMediaPosterFile({
          inputPath: stagedSourcePath,
          outputPath,
        })
      : await readPrivateSource(job.sourcePathname).then((source) =>
          generateMediaPoster({ source: source.stream, outputPath }),
        )
    const blob = await put(`${job.outputPrefix}/poster.jpg`, poster.body, {
      access: mediaDeliveryAccess(),
      token: deliveryBlobToken(),
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31_536_000,
      contentType: "image/jpeg",
    })
    const now = new Date()
    await getDb()
      .insert(mediaRenditions)
      .values({
        id: `media-rendition-${randomUUID()}`,
        mediaAssetId: job.mediaAssetId,
        processingJobId: job.id,
        kind: "poster",
        label: "540x960",
        storageProvider: "vercel-blob",
        storageKey: blob.pathname,
        mediaUrl: deliveryMediaUrl(blob),
        contentType: "image/jpeg",
        width: 540,
        height: 960,
        byteSize: poster.body.byteLength,
        checksum: poster.checksum,
        status: "ready",
        qualityStatus: "passed",
        qualityDetails: { sourceTimeSeconds: 0.1 },
        encoderVersion: job.encoderVersion,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          mediaRenditions.mediaAssetId,
          mediaRenditions.kind,
          mediaRenditions.label,
          mediaRenditions.encoderVersion,
        ],
        set: {
          processingJobId: job.id,
          storageKey: blob.pathname,
          mediaUrl: deliveryMediaUrl(blob),
          byteSize: poster.body.byteLength,
          checksum: poster.checksum,
          status: "ready",
          qualityStatus: "passed",
          updatedAt: now,
        },
      })
    logMediaPipeline("info", "poster_published", {
      jobId,
      mediaAssetId: job.mediaAssetId,
      byteSize: poster.body.byteLength,
    })
    return {
      pathname: blob.pathname,
      url: deliveryMediaUrl(blob),
      byteSize: poster.body.byteLength,
      checksum: poster.checksum,
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

export async function generateMediaPosterStep(jobId: string) {
  "use step"
  return generateMediaPosterCore(jobId)
}

export async function encodeInitialMediaStep(
  jobId: string,
  profile: MediaRenditionProfile,
  sourceMetadata: MediaSourceMetadata,
) {
  "use step"

  const job = await readJob(jobId)
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ubeye-source-initial-"))
  try {
    const sourcePath = path.join(tempDirectory, "source")
    await stagePrivateSource(job.sourcePathname, sourcePath)
    const [rendition, audio, poster] = await Promise.all([
      encodeMediaRenditionCore(jobId, profile, sourceMetadata, sourcePath),
      encodeMediaAudioRenditionCore(jobId, sourceMetadata, sourcePath),
      generateMediaPosterCore(jobId, sourcePath),
    ])
    return { rendition, audio, poster }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

async function publishPlayableMediaReferences(input: {
  job: Awaited<ReturnType<typeof readJob>>
  source: MediaSourceMetadata
  master: PublishedMaster
  poster: PublishedPoster
  highest: MediaRenditionProfile
  final: boolean
  progressPct: number
  now: Date
}) {
  const { job, source, master, poster, highest, final, progressPct, now } = input
  const db = getDb()
  const [currentAsset] = await db
    .select({ readyAt: mediaAssets.readyAt })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, job.mediaAssetId))
    .limit(1)

  await db
    .update(mediaAssets)
    .set({
      storageProvider: "vercel-blob",
      storageKey: master.pathname,
      mediaUrl: master.url,
      thumbnailUrl: poster.url,
      placeholderUrl: poster.url,
      contentType: "application/vnd.apple.mpegurl",
      byteSize: master.byteSize,
      checksum: master.checksum,
      width: highest.width,
      height: highest.height,
      durationMs: source.durationMs,
      originalWidth: source.width,
      originalHeight: source.height,
      originalDurationMs: source.durationMs,
      processingStatus: "ready",
      providerStatus: final ? "ready" : "enhancing",
      providerPctComplete: final ? 100 : progressPct,
      providerError: null,
      qualityStatus: final ? "passed" : "pending",
      highestVerifiedRendition: highest.label,
      readyAt: currentAsset?.readyAt ?? now,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, job.mediaAssetId))

  const linkedStories = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      status: stories.status,
      moderationStatus: stories.moderationStatus,
      expiresAt: stories.expiresAt,
    })
    .from(stories)
    .where(eq(stories.mediaAssetId, job.mediaAssetId))

  for (const story of linkedStories) {
    const nextStatus = deriveStoryPublicationStatus({
      currentStatus: story.status,
      moderationStatus: story.moderationStatus,
      providerReady: true,
      structuralReady: true,
      expiresAt: story.expiresAt,
      now,
    })
    await db
      .update(stories)
      .set({
        mediaUrl: master.url,
        thumbnailUrl: poster.url,
        placeholderUrl: poster.url,
        storageProvider: "vercel-blob",
        storageKey: master.pathname,
        contentType: "application/vnd.apple.mpegurl",
        byteSize: master.byteSize,
        checksum: master.checksum,
        width: highest.width,
        height: highest.height,
        durationMs: source.durationMs,
        processingStatus: "ready",
        status: nextStatus,
      })
      .where(eq(stories.id, story.id))

    if (nextStatus === "live" && story.status !== "live") {
      // The durable publication outbox is written before Workflow dispatch.
      // A downstream quota or transient dispatch failure must not roll a
      // verified, playable video back to an error state.
      await enqueueStoryPublication(story.id).catch((error) => {
        logMediaPipeline("error", "story_publication_dispatch_deferred", {
          jobId: job.id,
          mediaAssetId: job.mediaAssetId,
          storyId: story.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }

  for (const creatorId of new Set(
    linkedStories.map((story) => story.creatorId),
  )) {
    await invalidateMobileFeedSnapshotsForCreator(creatorId).catch((error) => {
      logMediaPipeline("error", "media_feed_invalidation_deferred", {
        jobId: job.id,
        mediaAssetId: job.mediaAssetId,
        creatorId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  return linkedStories.length
}

export async function activatePlayableMediaProcessingStep(
  jobId: string,
  source: MediaSourceMetadata,
  master: PublishedMaster,
  poster: PublishedPoster,
  readyProfiles: MediaRenditionProfile[],
  progressPct: number,
) {
  "use step"

  const job = await readJob(jobId)
  const highest = [...readyProfiles].sort(
    (left, right) => left.height - right.height,
  ).at(-1)
  if (!highest) {
    throw new MediaProcessingFatalError(
      "A verified rendition is required for playback.",
    )
  }
  const now = new Date()
  const monotonicProgress = Math.max(job.progressPct, progressPct)

  await getDb()
    .update(mediaProcessingJobs)
    .set({
      status: "encoding",
      progressPct: monotonicProgress,
      failureCode: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(mediaProcessingJobs.id, jobId))

  const storyCount = await publishPlayableMediaReferences({
    job,
    source,
    master,
    poster,
    highest,
    final: false,
    progressPct: monotonicProgress,
    now,
  })

  logMediaPipeline("info", "playback_activated", {
    jobId,
    mediaAssetId: job.mediaAssetId,
    storyCount,
    highestRendition: highest.label,
    renditionCount: readyProfiles.length,
    progressPct: monotonicProgress,
  })
}

export async function completeMediaProcessingStep(
  jobId: string,
  source: MediaSourceMetadata,
  master: PublishedMaster,
  poster: PublishedPoster,
) {
  "use step"

  const job = await readJob(jobId)
  const profiles = selectRenditionProfiles(source)
  const highest = profiles[profiles.length - 1]
  const now = new Date()
  const encodedRenditions = await getDb()
    .select({
      label: mediaRenditions.label,
      qualityDetails: mediaRenditions.qualityDetails,
    })
    .from(mediaRenditions)
    .where(
      and(
        eq(mediaRenditions.mediaAssetId, job.mediaAssetId),
        eq(mediaRenditions.kind, "hls-variant"),
        eq(mediaRenditions.encoderVersion, job.encoderVersion),
        eq(mediaRenditions.status, "ready"),
      ),
    )
  const encodingMsByRendition = Object.fromEntries(
    encodedRenditions.map((rendition) => [
      rendition.label,
      Number(
        (rendition.qualityDetails as { encodingMs?: number } | null)
          ?.encodingMs ?? 0,
      ),
    ]),
  )
  const metrics = {
    renditionCount: profiles.length,
    sourceDurationMs: source.durationMs,
    sourceFrameRate: source.frameRate,
    highestRendition: highest.label,
    processingMs: job.startedAt
      ? Math.max(0, now.getTime() - job.startedAt.getTime())
      : null,
    encodingMsByRendition,
    encodingMsTotal: Object.values(encodingMsByRendition).reduce(
      (total, duration) => total + duration,
      0,
    ),
  }

  const storyCount = await publishPlayableMediaReferences({
    job,
    source,
    master,
    poster,
    highest,
    final: true,
    progressPct: 100,
    now,
  })

  await getDb()
    .update(mediaProcessingJobs)
    .set({
      status: "ready",
      progressPct: 100,
      failureCode: null,
      lastError: null,
      metrics,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaProcessingJobs.id, jobId))

  logMediaPipeline("info", "processing_completed", {
    jobId,
    mediaAssetId: job.mediaAssetId,
    storyCount,
    highestRendition: highest.label,
    durationMs: source.durationMs,
  })
}

export async function failMediaProcessingStep(jobId: string, message: string) {
  "use step"

  const job = await readJob(jobId)
  const now = new Date()
  const safeMessage = message.slice(0, 2_000)
  const [asset] = await getDb()
    .select({ processingStatus: mediaAssets.processingStatus })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, job.mediaAssetId))
    .limit(1)
  const alreadyPlayable = asset?.processingStatus === "ready"
  await getDb()
    .update(mediaProcessingJobs)
    .set({
      status: "error",
      failureCode: "media_processing_failed",
      lastError: safeMessage,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaProcessingJobs.id, jobId))
  await getDb()
    .update(mediaAssets)
    .set({
      processingStatus: alreadyPlayable ? "ready" : "error",
      providerStatus: alreadyPlayable ? "enhancement_error" : "error",
      providerError: safeMessage,
      qualityStatus: alreadyPlayable ? "pending" : "failed",
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, job.mediaAssetId))
  if (!alreadyPlayable) {
    await getDb()
      .update(stories)
      .set({ processingStatus: "error" })
      .where(eq(stories.mediaAssetId, job.mediaAssetId))
  }

  logMediaPipeline("error", "processing_failed", {
    jobId,
    mediaAssetId: job.mediaAssetId,
    playbackPreserved: alreadyPlayable,
    error: safeMessage,
  })
}
