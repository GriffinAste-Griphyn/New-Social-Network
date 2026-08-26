import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

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
  mediaPipelineLimits,
  selectRenditionProfiles,
  type MediaRenditionProfile,
  type MediaSourceMetadata,
  validateSourceMetadata,
} from "@/lib/media-pipeline/contracts"
import {
  encodeMediaRendition,
  generateMediaPoster,
  inspectMediaFile,
  inspectMediaStream,
  mediaContentType,
} from "@/lib/media-pipeline/ffmpeg"
import {
  buildHlsMasterPlaylist,
  type PublishedRendition,
} from "@/lib/media-pipeline/manifest"
import { renditionPrefix } from "@/lib/media-pipeline/paths"
import { enqueueStoryPublication } from "@/lib/story-publication"
import { deriveStoryPublicationStatus } from "@/lib/stories/cloudflare-status"

class MediaProcessingFatalError extends Error {}

type EncodedRendition = {
  profile: MediaRenditionProfile
  playlistPathname: string
  playlistUrl: string
  byteSize: number
  checksum: string
  segmentCount: number
  encodingMs: number
  codec: string
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
            access: "public",
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
  attempt: number,
) {
  "use step"

  const [claimed] = await getDb()
    .update(mediaProcessingJobs)
    .set({
      status: "inspecting",
      progressPct: 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mediaProcessingJobs.id, jobId),
        eq(mediaProcessingJobs.status, "pending"),
        eq(mediaProcessingJobs.attempts, attempt),
      ),
    )
    .returning({ id: mediaProcessingJobs.id })

  return Boolean(claimed)
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
  const source = await inspectMediaStream(sourceBlob.stream)
  const sourceFailure = validateSourceMetadata(source)
  if (sourceFailure) {
    throw new MediaProcessingFatalError(
      `Media quality control failed: ${sourceFailure}.`,
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
  })

  return { source, profiles: selectRenditionProfiles(source) }
}

export async function encodeMediaRenditionStep(
  jobId: string,
  profile: MediaRenditionProfile,
  sourceMetadata: MediaSourceMetadata,
): Promise<EncodedRendition> {
  "use step"

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
      codec: existing.codec ?? "avc1.640029",
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
    const source = await readPrivateSource(job.sourcePathname)
    const encoded = await encodeMediaRendition({
      source: source.stream,
      profile,
      outputDirectory,
    })
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
      encodedMetadata.hasAudio !== sourceMetadata.hasAudio ||
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
    const now = new Date()
    const values = {
      id: `media-rendition-${randomUUID()}`,
      mediaAssetId: job.mediaAssetId,
      processingJobId: job.id,
      kind: "hls-variant",
      label: profile.label,
      storageProvider: "vercel-blob" as const,
      storageKey: uploadedPlaylist.pathname,
      mediaUrl: uploadedPlaylist.url,
      contentType: "application/vnd.apple.mpegurl",
      codec: sourceMetadata.hasAudio
        ? "avc1.640029,mp4a.40.2"
        : "avc1.640029",
      width: profile.width,
      height: profile.height,
      durationMs: encodedMetadata.durationMs,
      bitrate:
        profile.videoBitrate +
        (sourceMetadata.hasAudio ? profile.audioBitrate : 0),
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
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

export async function publishMasterPlaylistStep(
  jobId: string,
  renditions: EncodedRendition[],
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

  const playlist = buildHlsMasterPlaylist(
    ordered.map(
      (item): PublishedRendition => ({
        profile: item.profile,
        playlistUrl: `${item.profile.label}/index.m3u8`,
        codec: item.codec,
      }),
    ),
  )
  const body = Buffer.from(playlist, "utf8")
  const checksum = createHash("sha256").update(body).digest("hex")
  const renditionLabels = ordered.map((item) => item.profile.label)
  const masterFileName = `master-${renditionLabels.join("-")}.m3u8`
  const blob = await put(`${job.outputPrefix}/${masterFileName}`, body, {
    access: "public",
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
      mediaUrl: blob.url,
      contentType: "application/vnd.apple.mpegurl",
      byteSize: body.byteLength,
      checksum,
      status: "ready",
      qualityStatus: "passed",
      qualityDetails: { renditionCount: ordered.length, renditionLabels },
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
        mediaUrl: blob.url,
        byteSize: body.byteLength,
        checksum,
        status: "ready",
        qualityStatus: "passed",
        qualityDetails: { renditionCount: ordered.length, renditionLabels },
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

  return { pathname: blob.pathname, url: blob.url, byteSize: body.byteLength, checksum }
}

export async function generateMediaPosterStep(
  jobId: string,
): Promise<PublishedPoster> {
  "use step"

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
    const source = await readPrivateSource(job.sourcePathname)
    const poster = await generateMediaPoster({
      source: source.stream,
      outputPath,
    })
    const blob = await put(`${job.outputPrefix}/poster.jpg`, poster.body, {
      access: "public",
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
        mediaUrl: blob.url,
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
          mediaUrl: blob.url,
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
      url: blob.url,
      byteSize: poster.body.byteLength,
      checksum: poster.checksum,
    }
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
