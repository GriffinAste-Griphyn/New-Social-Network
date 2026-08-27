import { randomUUID } from "node:crypto"

import { and, asc, eq, isNull, lt, or } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { mediaAssets, mediaProcessingJobs, stories } from "@/lib/db/schema"
import {
  maximumMediaProcessingAttempts,
  mediaEncoderVersion,
  mediaPipelineVersion,
} from "./contracts"
import { createMediaDeliveryPrefix } from "./paths"

export class MediaPipelineDispatchError extends Error {}

const dispatchClaimRecoveryMs = 5 * 60 * 1_000
const activeDispatchLeaseMs = 15 * 60 * 1_000
const maximumErrorRetryDelayMs = 2 * 60 * 1_000

export function mediaProcessingRetryDelayMs(attempts: number) {
  if (attempts <= 0) return 0
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), maximumErrorRetryDelayMs)
}

function mediaProcessingDispatchRecommended(job: {
  status: string
  attempts: number
  updatedAt: Date
}) {
  if (job.status === "ready") return false
  if (job.attempts >= maximumMediaProcessingAttempts) {
    // A bounded run can deliberately yield after its final attempt. Give that
    // pending row one last owner so it transitions to an explicit terminal
    // error instead of leaving the client on an endless queued state.
    return job.status === "pending"
  }
  if (job.status === "pending") return true
  if (job.status === "error") {
    return (
      job.updatedAt.getTime() <=
      Date.now() - mediaProcessingRetryDelayMs(job.attempts)
    )
  }

  return job.updatedAt.getTime() <= Date.now() - activeDispatchLeaseMs
}

export async function createMediaProcessingJob(mediaAssetId: string) {
  const db = getDb()
  const [asset] = await db
    .select({
      id: mediaAssets.id,
      assetKind: mediaAssets.assetKind,
      storageProvider: mediaAssets.storageProvider,
      storageKey: mediaAssets.storageKey,
      originalStorageProvider: mediaAssets.originalStorageProvider,
      originalStorageKey: mediaAssets.originalStorageKey,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, mediaAssetId))
    .limit(1)

  if (!asset || asset.assetKind !== "video") {
    throw new MediaPipelineDispatchError("A video media asset is required.")
  }

  const sourcePathname = asset.originalStorageKey ?? asset.storageKey
  const sourceProvider = asset.originalStorageProvider ?? asset.storageProvider
  if (sourceProvider !== "vercel-blob" || !sourcePathname) {
    throw new MediaPipelineDispatchError(
      "The custom media pipeline requires a private Vercel Blob original.",
    )
  }

  const [existing] = await db
    .select()
    .from(mediaProcessingJobs)
    .where(
      and(
        eq(mediaProcessingJobs.mediaAssetId, mediaAssetId),
        eq(mediaProcessingJobs.pipelineVersion, mediaPipelineVersion),
      ),
    )
    .limit(1)

  if (existing) return existing

  const now = new Date()
  const [created] = await db
    .insert(mediaProcessingJobs)
    .values({
      id: `media-job-${randomUUID()}`,
      mediaAssetId,
      pipelineVersion: mediaPipelineVersion,
      encoderVersion: mediaEncoderVersion,
      sourcePathname,
      outputPrefix: createMediaDeliveryPrefix(),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning()

  if (created) return created

  const [raced] = await db
    .select()
    .from(mediaProcessingJobs)
    .where(
      and(
        eq(mediaProcessingJobs.mediaAssetId, mediaAssetId),
        eq(mediaProcessingJobs.pipelineVersion, mediaPipelineVersion),
      ),
    )
    .limit(1)

  if (!raced) {
    throw new MediaPipelineDispatchError("Could not reserve media processing.")
  }
  return raced
}

export async function enqueueMediaProcessing(mediaAssetId: string) {
  const job = await createMediaProcessingJob(mediaAssetId)
  const dispatchRecommended = mediaProcessingDispatchRecommended(job)

  if (job.status === "ready") {
    return {
      jobId: job.id,
      runId: job.workflowRunId,
      dispatchRecommended: false,
    }
  }

  if (
    dispatchRecommended &&
    job.attempts < maximumMediaProcessingAttempts &&
    (job.status === "pending" || job.status === "error")
  ) {
    const now = new Date()
    const [asset] = await getDb()
      .select({ processingStatus: mediaAssets.processingStatus })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, mediaAssetId))
      .limit(1)
    const alreadyPlayable = asset?.processingStatus === "ready"

    await getDb()
      .update(mediaAssets)
      .set({
        pipelineVersion: job.pipelineVersion,
        encoderVersion: job.encoderVersion,
        processingStatus: alreadyPlayable ? "ready" : "processing",
        qualityStatus: "pending",
        providerStatus: alreadyPlayable ? "enhancing" : "queued",
        providerError: null,
        updatedAt: now,
      })
      .where(eq(mediaAssets.id, mediaAssetId))
    if (!alreadyPlayable) {
      await getDb()
        .update(stories)
        .set({ processingStatus: "processing" })
        .where(eq(stories.mediaAssetId, mediaAssetId))
    }
  }

  // Encoding is started by the owning route as a durable Workflow run and
  // guarded by a database lease. Keeping this function side-effect-light makes
  // repeated upload completions and status polling safely idempotent.
  return { jobId: job.id, runId: null, dispatchRecommended }
}

export async function reconcileMediaProcessingJobs(input: {
  limit?: number
} = {}) {
  const candidates = await getDb()
    .select({ id: mediaProcessingJobs.id, mediaAssetId: mediaProcessingJobs.mediaAssetId })
    .from(mediaProcessingJobs)
    .where(
      and(
        lt(mediaProcessingJobs.attempts, maximumMediaProcessingAttempts),
        or(
          eq(mediaProcessingJobs.status, "error"),
          and(
            eq(mediaProcessingJobs.status, "pending"),
            isNull(mediaProcessingJobs.workflowRunId),
            lt(
              mediaProcessingJobs.updatedAt,
              new Date(Date.now() - dispatchClaimRecoveryMs),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(mediaProcessingJobs.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 25, 1), 100))

  const results = await Promise.allSettled(
    candidates.map((candidate) =>
      enqueueMediaProcessing(candidate.mediaAssetId),
    ),
  )
  return {
    scanned: candidates.length,
    dispatched: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  }
}
