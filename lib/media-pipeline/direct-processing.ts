import { and, asc, eq, inArray, lt, or } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  mediaAssets,
  mediaProcessingJobs,
  mediaRenditions,
  stories,
} from "@/lib/db/schema"
import {
  maximumMediaProcessingAttempts,
  mediaEncoderVersion,
  selectRenditionProfiles,
  type MediaRenditionProfile,
  type MediaSourceMetadata,
} from "@/lib/media-pipeline/contracts"
import { migrateMediaDeliveryPrefix } from "@/lib/media-pipeline/paths"
import {
  activatePlayableMediaProcessingStep,
  completeMediaProcessingStep,
  encodeMediaAudioRenditionStep,
  encodeMediaRenditionStep,
  failMediaProcessingStep,
  generateMediaPosterStep,
  inspectMediaSourceStep,
  publishMasterPlaylistStep,
} from "@/workflows/media-processing/steps"

const executionLeaseRecoveryMs = 15 * 60 * 1_000
const directRunBudgetMs = 235 * 1_000
const maximumSlicesPerRun = 10
const activeStatuses = ["inspecting", "encoding", "publishing"] as const

type MediaProcessingStage =
  | { kind: "bootstrap" }
  | { kind: "rendition"; profile: MediaRenditionProfile }
  | {
      kind: "publish"
      profiles: MediaRenditionProfile[]
      isFinal: boolean
    }

type MediaProcessingSliceResult =
  | { status: "continue"; jobId: string; attempt: number }
  | { status: "completed"; jobId: string; attempt: number }
  | { status: "already_running" | "already_ready" | "exhausted"; jobId: string }

export type MediaProcessingRunResult =
  | Exclude<MediaProcessingSliceResult, { status: "continue" }>
  | {
      status: "yielded"
      jobId: string
      attempt: number
      slices: number
      elapsedMs: number
    }

type DirectJob = Awaited<ReturnType<typeof readDirectJob>>

export function planNextMediaProcessingStage(input: {
  source: MediaSourceMetadata | null
  hasPoster: boolean
  hasAudioRendition?: boolean
  readyVariantLabels: Set<string>
  publishedVariantLabels?: Set<string>
}): MediaProcessingStage {
  if (
    !input.source ||
    !input.hasPoster ||
    (input.source.hasAudio && !input.hasAudioRendition)
  ) {
    return { kind: "bootstrap" }
  }

  const profiles = selectRenditionProfiles(input.source)
  const readyProfiles = profiles.filter((profile) =>
    input.readyVariantLabels.has(profile.label),
  )
  const publishedVariantLabels = input.publishedVariantLabels ?? new Set()
  const publicationIsCurrent =
    readyProfiles.length === publishedVariantLabels.size &&
    readyProfiles.every((profile) => publishedVariantLabels.has(profile.label))

  if (readyProfiles.length > 0 && !publicationIsCurrent) {
    return {
      kind: "publish",
      profiles: readyProfiles,
      isFinal: readyProfiles.length === profiles.length,
    }
  }

  const priority = ["540p", "720p", "360p", "1080p"] as const
  const nextProfile = priority
    .map((label) => profiles.find((profile) => profile.label === label))
    .find(
      (profile): profile is MediaRenditionProfile =>
        Boolean(profile && !input.readyVariantLabels.has(profile.label)),
    )

  if (nextProfile) return { kind: "rendition", profile: nextProfile }

  // Re-publishing the final deterministic version is intentional. If a prior
  // invocation wrote the master row but stopped before finalizing the job,
  // this makes the transition idempotent and recoverable.
  return { kind: "publish", profiles: readyProfiles, isFinal: true }
}

function isRecoverableJob(job: {
  status: string
  attempts: number
  updatedAt: Date
}) {
  if (
    job.attempts >= maximumMediaProcessingAttempts ||
    job.status === "ready"
  ) {
    return false
  }
  if (job.status === "error" || job.status === "pending") {
    return true
  }
  return job.updatedAt.getTime() <= Date.now() - executionLeaseRecoveryMs
}

async function readDirectJob(jobId: string) {
  const [job] = await getDb()
    .select()
    .from(mediaProcessingJobs)
    .where(eq(mediaProcessingJobs.id, jobId))
    .limit(1)
  return job ?? null
}

async function acquireDirectMediaProcessingJob(
  jobId: string,
  expectedAttempt?: number,
) {
  const db = getDb()
  const job = await readDirectJob(jobId)

  if (!job || job.status === "ready") {
    return { state: "already_ready" as const }
  }

  if (expectedAttempt !== undefined) {
    if (
      job.attempts !== expectedAttempt ||
      !activeStatuses.includes(job.status as (typeof activeStatuses)[number])
    ) {
      return { state: "already_running" as const }
    }
    const outputPrefix =
      job.encoderVersion === mediaEncoderVersion
        ? job.outputPrefix
        : migrateMediaDeliveryPrefix(job.outputPrefix, mediaEncoderVersion)
    if (job.encoderVersion !== mediaEncoderVersion) {
      const now = new Date()
      await db
        .update(mediaProcessingJobs)
        .set({
          encoderVersion: mediaEncoderVersion,
          outputPrefix,
          updatedAt: now,
        })
        .where(eq(mediaProcessingJobs.id, job.id))
      await db
        .update(mediaAssets)
        .set({ encoderVersion: mediaEncoderVersion, updatedAt: now })
        .where(eq(mediaAssets.id, job.mediaAssetId))
    }
    return {
      state: "claimed" as const,
      attempt: expectedAttempt,
      job: {
        ...job,
        encoderVersion: mediaEncoderVersion,
        outputPrefix,
      },
    }
  }

  if (job.attempts >= maximumMediaProcessingAttempts) {
    if (job.status !== "error") {
      await failMediaProcessingStep(
        job.id,
        "Video processing stopped after multiple interrupted attempts.",
      )
    }
    return { state: "exhausted" as const }
  }
  if (!isRecoverableJob(job)) {
    return { state: "already_running" as const }
  }

  const now = new Date()
  const nextAttempt = job.attempts + 1
  const preservedProgress = Math.max(job.progressPct, 1)
  const outputPrefix =
    job.encoderVersion === mediaEncoderVersion
      ? job.outputPrefix
      : migrateMediaDeliveryPrefix(job.outputPrefix, mediaEncoderVersion)
  const [claimed] = await db
    .update(mediaProcessingJobs)
    .set({
      workflowRunId: null,
      encoderVersion: mediaEncoderVersion,
      outputPrefix,
      status: "inspecting",
      progressPct: preservedProgress,
      attempts: nextAttempt,
      failureCode: null,
      lastError: null,
      startedAt: job.startedAt ?? now,
      finishedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaProcessingJobs.id, job.id),
        eq(mediaProcessingJobs.status, job.status),
        eq(mediaProcessingJobs.attempts, job.attempts),
      ),
    )
    .returning({ id: mediaProcessingJobs.id })

  if (!claimed) {
    return { state: "already_running" as const }
  }

  const [asset] = await db
    .select({
      processingStatus: mediaAssets.processingStatus,
      providerPctComplete: mediaAssets.providerPctComplete,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, job.mediaAssetId))
    .limit(1)
  const alreadyPlayable = asset?.processingStatus === "ready"

  await db
    .update(mediaAssets)
    .set({
      workflowRunId: null,
      encoderVersion: mediaEncoderVersion,
      processingStatus: alreadyPlayable ? "ready" : "processing",
      providerStatus: alreadyPlayable ? "enhancing" : "processing",
      providerPctComplete: Math.max(
        asset?.providerPctComplete ?? 0,
        preservedProgress,
      ),
      providerError: null,
      qualityStatus: "pending",
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, job.mediaAssetId))
  if (!alreadyPlayable) {
    await db
      .update(stories)
      .set({ processingStatus: "processing" })
      .where(eq(stories.mediaAssetId, job.mediaAssetId))
  }

  return {
    state: "claimed" as const,
    attempt: nextAttempt,
    job: {
      ...job,
      encoderVersion: mediaEncoderVersion,
      outputPrefix,
      attempts: nextAttempt,
      status: "inspecting" as const,
    },
  }
}

async function readReadyOutputs(job: NonNullable<DirectJob>) {
  const outputs = await getDb()
    .select({
      kind: mediaRenditions.kind,
      label: mediaRenditions.label,
      qualityDetails: mediaRenditions.qualityDetails,
    })
    .from(mediaRenditions)
    .where(
      and(
        eq(mediaRenditions.mediaAssetId, job.mediaAssetId),
        eq(mediaRenditions.encoderVersion, job.encoderVersion),
        eq(mediaRenditions.status, "ready"),
        eq(mediaRenditions.qualityStatus, "passed"),
      ),
    )

  const master = outputs.find(
    (output) => output.kind === "hls-master" && output.label === "adaptive",
  )
  const publishedLabels = (
    master?.qualityDetails as { renditionLabels?: unknown } | null
  )?.renditionLabels

  return {
    hasPoster: outputs.some(
      (output) => output.kind === "poster" && output.label === "540x960",
    ),
    hasAudioRendition: outputs.some(
      (output) =>
        output.kind === "hls-audio" && output.label === "audio",
    ),
    readyVariantLabels: new Set(
      outputs
        .filter((output) => output.kind === "hls-variant")
        .map((output) => output.label),
    ),
    publishedVariantLabels: new Set(
      Array.isArray(publishedLabels)
        ? publishedLabels.filter(
            (label): label is string => typeof label === "string",
          )
        : [],
    ),
  }
}

async function updateDirectProgress(
  job: NonNullable<DirectJob>,
  progressPct: number,
) {
  const db = getDb()
  const now = new Date()
  const [currentJob] = await db
    .select({ progressPct: mediaProcessingJobs.progressPct })
    .from(mediaProcessingJobs)
    .where(eq(mediaProcessingJobs.id, job.id))
    .limit(1)
  const [asset] = await db
    .select({
      processingStatus: mediaAssets.processingStatus,
      providerPctComplete: mediaAssets.providerPctComplete,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, job.mediaAssetId))
    .limit(1)
  const monotonicProgress = Math.max(
    progressPct,
    currentJob?.progressPct ?? 0,
    asset?.providerPctComplete ?? 0,
  )
  const alreadyPlayable = asset?.processingStatus === "ready"

  await db
    .update(mediaProcessingJobs)
    .set({ progressPct: monotonicProgress, updatedAt: now })
    .where(eq(mediaProcessingJobs.id, job.id))
  await db
    .update(mediaAssets)
    .set({
      providerStatus: alreadyPlayable ? "enhancing" : "processing",
      providerPctComplete: monotonicProgress,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, job.mediaAssetId))
}

async function executeMediaProcessingSlice(job: NonNullable<DirectJob>) {
  const source = (job.sourceMetadata as MediaSourceMetadata | null) ?? null
  const outputs = await readReadyOutputs(job)
  const stage = planNextMediaProcessingStage({ source, ...outputs })

  switch (stage.kind) {
    case "bootstrap":
      {
        const inspected = await inspectMediaSourceStep(job.id)
        await Promise.all([
          generateMediaPosterStep(job.id),
          encodeMediaAudioRenditionStep(job.id, inspected.source),
        ])
      }
      await updateDirectProgress(job, 15)
      return { completed: false }
    case "rendition": {
      const inspected = await inspectMediaSourceStep(job.id)
      await encodeMediaRenditionStep(job.id, stage.profile, inspected.source)
      const profiles = selectRenditionProfiles(inspected.source)
      const completedCount = outputs.readyVariantLabels.size + 1
      await updateDirectProgress(
        job,
        Math.round(15 + (completedCount / profiles.length) * 70),
      )
      return { completed: false }
    }
    case "publish": {
      const inspected = await inspectMediaSourceStep(job.id)
      const renditions = await Promise.all(
        stage.profiles.map((profile) =>
          encodeMediaRenditionStep(job.id, profile, inspected.source),
        ),
      )
      const poster = await generateMediaPosterStep(job.id)
      const audio = await encodeMediaAudioRenditionStep(job.id, inspected.source)
      const master = await publishMasterPlaylistStep(job.id, renditions, audio)
      if (stage.isFinal) {
        await completeMediaProcessingStep(
          job.id,
          inspected.source,
          master,
          poster,
        )
        return { completed: true }
      }

      const progressPct = Math.round(
        15 + (stage.profiles.length / inspected.profiles.length) * 70,
      )
      await activatePlayableMediaProcessingStep(
        job.id,
        inspected.source,
        master,
        poster,
        stage.profiles,
        progressPct,
      )
      return { completed: false }
    }
  }
}

export async function processMediaJobSlice(
  jobId: string,
  expectedAttempt?: number,
): Promise<MediaProcessingSliceResult> {
  const claim = await acquireDirectMediaProcessingJob(jobId, expectedAttempt)
  if (claim.state !== "claimed") {
    return { status: claim.state, jobId }
  }

  try {
    const result = await executeMediaProcessingSlice(claim.job)
    return {
      status: result.completed ? "completed" : "continue",
      jobId,
      attempt: claim.attempt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failMediaProcessingStep(jobId, message).catch((failureError) => {
      console.error("media_processing_failure_record_failed", {
        jobId,
        error: failureError,
      })
    })
    throw error
  }
}

async function yieldDirectMediaProcessingJob(jobId: string, attempt: number) {
  const db = getDb()
  const now = new Date()
  const job = await readDirectJob(jobId)
  if (
    !job ||
    job.attempts !== attempt ||
    !activeStatuses.includes(job.status as (typeof activeStatuses)[number])
  ) {
    return false
  }

  const [released] = await db
    .update(mediaProcessingJobs)
    .set({
      status: "pending",
      workflowRunId: null,
      failureCode: null,
      lastError: null,
      finishedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaProcessingJobs.id, jobId),
        eq(mediaProcessingJobs.attempts, attempt),
        eq(mediaProcessingJobs.status, job.status),
      ),
    )
    .returning({ id: mediaProcessingJobs.id })

  if (!released) return false

  const [asset] = await db
    .select({ processingStatus: mediaAssets.processingStatus })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, job.mediaAssetId))
    .limit(1)
  const alreadyPlayable = asset?.processingStatus === "ready"

  await db
    .update(mediaAssets)
    .set({
      processingStatus: alreadyPlayable ? "ready" : "processing",
      providerStatus: alreadyPlayable ? "enhancing" : "queued",
      providerError: null,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, job.mediaAssetId))
  if (!alreadyPlayable) {
    await db
      .update(stories)
      .set({ processingStatus: "processing" })
      .where(eq(stories.mediaAssetId, job.mediaAssetId))
  }

  return true
}

export async function processMediaJobRun(
  jobId: string,
  options: { budgetMs?: number; maximumSlices?: number } = {},
): Promise<MediaProcessingRunResult> {
  const startedAt = Date.now()
  const budgetMs = Math.min(
    Math.max(options.budgetMs ?? directRunBudgetMs, 1_000),
    directRunBudgetMs,
  )
  const maximumSlices = Math.min(
    Math.max(options.maximumSlices ?? maximumSlicesPerRun, 1),
    maximumSlicesPerRun,
  )
  let attempt: number | undefined

  for (let slices = 1; slices <= maximumSlices; slices += 1) {
    const result = await processMediaJobSlice(jobId, attempt)
    if (result.status !== "continue") return result

    attempt = result.attempt
    const elapsedMs = Date.now() - startedAt
    if (elapsedMs >= budgetMs || slices === maximumSlices) {
      const yielded = await yieldDirectMediaProcessingJob(jobId, attempt)
      if (!yielded) {
        const current = await readDirectJob(jobId)
        return {
          status: current?.status === "ready" ? "already_ready" : "already_running",
          jobId,
        }
      }
      return { status: "yielded", jobId, attempt, slices, elapsedMs }
    }
  }

  throw new Error("Media processing run ended without a terminal result.")
}

export async function recoverableMediaJobIds(input: { limit?: number } = {}) {
  const staleBefore = new Date(Date.now() - executionLeaseRecoveryMs)
  return getDb()
    .select({ id: mediaProcessingJobs.id })
    .from(mediaProcessingJobs)
    .where(
      and(
        lt(mediaProcessingJobs.attempts, maximumMediaProcessingAttempts),
        or(
          eq(mediaProcessingJobs.status, "error"),
          eq(mediaProcessingJobs.status, "pending"),
          and(
            inArray(mediaProcessingJobs.status, [...activeStatuses]),
            lt(mediaProcessingJobs.updatedAt, staleBefore),
          ),
        ),
      ),
    )
    .orderBy(asc(mediaProcessingJobs.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 1, 1), 3))
}
