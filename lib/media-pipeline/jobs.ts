import { randomUUID } from "node:crypto"

import { and, asc, eq, isNull, lt, or } from "drizzle-orm"
import { start } from "workflow/api"

import { getDb } from "@/lib/db"
import { mediaAssets, mediaProcessingJobs, stories } from "@/lib/db/schema"
import { processMediaWorkflow } from "@/workflows/media-processing"

import { mediaEncoderVersion, mediaPipelineVersion } from "./contracts"
import { createMediaDeliveryPrefix } from "./paths"

export class MediaPipelineDispatchError extends Error {}

const dispatchClaimRecoveryMs = 5 * 60 * 1_000

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

  if (
    job.status === "ready" ||
    (job.workflowRunId && job.status !== "error")
  ) {
    return { jobId: job.id, runId: job.workflowRunId }
  }

  if (
    job.status === "pending" &&
    job.attempts > 0 &&
    !job.workflowRunId &&
    job.updatedAt.getTime() > Date.now() - dispatchClaimRecoveryMs
  ) {
    return { jobId: job.id, runId: null }
  }

  const now = new Date()
  const claimed = await getDb().transaction(async (tx) => {
    const [reserved] = await tx
      .update(mediaProcessingJobs)
      .set({
        workflowRunId: null,
        status: "pending",
        attempts: job.attempts + 1,
        lastError: null,
        failureCode: null,
        finishedAt: null,
        startedAt: job.startedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaProcessingJobs.id, job.id),
          eq(mediaProcessingJobs.status, job.status),
          eq(mediaProcessingJobs.attempts, job.attempts),
        ),
      )
      .returning({ attempts: mediaProcessingJobs.attempts })

    if (!reserved) return null

    await tx
      .update(mediaAssets)
      .set({
        workflowRunId: null,
        pipelineVersion: job.pipelineVersion,
        encoderVersion: job.encoderVersion,
        processingStatus: "processing",
        qualityStatus: "pending",
        providerStatus: "queued",
        providerPctComplete: 0,
        providerError: null,
        updatedAt: now,
      })
      .where(eq(mediaAssets.id, mediaAssetId))
    await tx
      .update(stories)
      .set({ processingStatus: "processing" })
      .where(eq(stories.mediaAssetId, mediaAssetId))

    return reserved
  })

  if (!claimed) {
    const [current] = await getDb()
      .select({ workflowRunId: mediaProcessingJobs.workflowRunId })
      .from(mediaProcessingJobs)
      .where(eq(mediaProcessingJobs.id, job.id))
      .limit(1)
    return { jobId: job.id, runId: current?.workflowRunId ?? null }
  }

  try {
    const run = await start(processMediaWorkflow, [job.id, claimed.attempts])
    await getDb()
      .update(mediaProcessingJobs)
      .set({
        workflowRunId: run.runId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaProcessingJobs.id, job.id),
          eq(mediaProcessingJobs.attempts, claimed.attempts),
        ),
      )
    await getDb()
      .update(mediaAssets)
      .set({
        workflowRunId: run.runId,
        updatedAt: new Date(),
      })
      .where(eq(mediaAssets.id, mediaAssetId))

    return { jobId: job.id, runId: run.runId }
  } catch (error) {
    await getDb()
      .update(mediaProcessingJobs)
      .set({
        status: "error",
        failureCode: "workflow_dispatch_failed",
        lastError: (error instanceof Error ? error.message : String(error)).slice(
          0,
          2_000,
        ),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaProcessingJobs.id, job.id),
          eq(mediaProcessingJobs.attempts, claimed.attempts),
        ),
      )
    throw error
  }
}

export async function reconcileMediaProcessingJobs(input: {
  limit?: number
} = {}) {
  const candidates = await getDb()
    .select({ id: mediaProcessingJobs.id, mediaAssetId: mediaProcessingJobs.mediaAssetId })
    .from(mediaProcessingJobs)
    .where(
      and(
        lt(mediaProcessingJobs.attempts, 3),
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
