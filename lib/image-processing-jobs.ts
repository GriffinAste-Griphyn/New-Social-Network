import { randomUUID } from "node:crypto"

import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm"
import { start } from "workflow/api"

import { getDb } from "@/lib/db"
import { imageProcessingJobs, mediaAssets } from "@/lib/db/schema"
import { areDurableMediaWorkersEnabled } from "@/lib/media-pipeline/features"
import type { StoryImageContentMode } from "@/lib/story-image-processing"
import { processImageWorkflow } from "@/workflows/image-processing"
import {
  claimImageProcessingStep,
  completeImageProcessingStep,
  failImageProcessingStep,
  processImageAssetStep,
} from "@/workflows/image-processing/steps"

export async function createImageProcessingJob(input: {
  mediaAssetId: string
  basePathname: string
  contentMode: StoryImageContentMode
}) {
  const db = getDb()
  const [asset] = await db
    .select({ sourcePathname: mediaAssets.originalStorageKey })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, input.mediaAssetId))
    .limit(1)
  if (!asset?.sourcePathname) {
    throw new Error("An original image source is required.")
  }

  const [created] = await db
    .insert(imageProcessingJobs)
    .values({
      id: `image-job-${randomUUID()}`,
      mediaAssetId: input.mediaAssetId,
      sourcePathname: asset.sourcePathname,
      basePathname: input.basePathname,
      contentMode: input.contentMode,
    })
    .onConflictDoNothing({ target: imageProcessingJobs.mediaAssetId })
    .returning()
  if (created) return created

  const [existing] = await db
    .select()
    .from(imageProcessingJobs)
    .where(eq(imageProcessingJobs.mediaAssetId, input.mediaAssetId))
    .limit(1)
  if (!existing) throw new Error("Could not reserve image processing.")
  return existing
}

export async function scheduleImageProcessing(jobId: string, source: string) {
  if (!areDurableMediaWorkersEnabled()) {
    const runId = `direct-${randomUUID()}`
    const claimed = await claimImageProcessingStep(jobId, runId)
    if (!claimed) return { jobId, runId: null }

    try {
      const output = await processImageAssetStep(jobId)
      const result = await completeImageProcessingStep(jobId, output)
      console.info("image_processing_direct_finished", { jobId, source, result })
      return { jobId, runId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await failImageProcessingStep(jobId, message)
      throw error
    }
  }

  const run = await start(processImageWorkflow, [jobId])
  console.info("image_processing_workflow_started", {
    jobId,
    source,
    runId: run.runId,
  })
  return { jobId, runId: run.runId }
}

export async function enqueueImageProcessing(input: {
  mediaAssetId: string
  basePathname: string
  contentMode: StoryImageContentMode
  source: string
}) {
  const job = await createImageProcessingJob(input)
  if (job.status === "ready" || job.status === "processing") {
    return { jobId: job.id, runId: job.workflowRunId }
  }
  return scheduleImageProcessing(job.id, input.source)
}

export async function recoverImageProcessingForAsset(mediaAssetId: string) {
  const [asset] = await getDb()
    .select({
      sourcePathname: mediaAssets.originalStorageKey,
      providerStatus: mediaAssets.providerStatus,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, mediaAssetId))
    .limit(1)
  if (!asset?.sourcePathname?.includes("/source.")) return null

  return enqueueImageProcessing({
    mediaAssetId,
    basePathname: asset.sourcePathname.replace(/\/source\.[^/]+$/, ""),
    contentMode: asset.providerStatus?.endsWith(":fill") ? "fill" : "fit",
    source: "story_status_poll",
  })
}

export async function reconcileImageProcessingJobs(
  input: { limit?: number } = {},
) {
  const orphanedAssets = await getDb()
    .select({
      id: mediaAssets.id,
      sourcePathname: mediaAssets.originalStorageKey,
      providerStatus: mediaAssets.providerStatus,
    })
    .from(mediaAssets)
    .leftJoin(
      imageProcessingJobs,
      eq(imageProcessingJobs.mediaAssetId, mediaAssets.id),
    )
    .where(
      and(
        eq(mediaAssets.assetKind, "image"),
        eq(mediaAssets.processingStatus, "processing"),
        isNull(imageProcessingJobs.id),
      ),
    )
    .limit(Math.min(Math.max(input.limit ?? 10, 1), 25))

  for (const asset of orphanedAssets) {
    if (!asset.sourcePathname?.includes("/source.")) continue
    const contentMode = asset.providerStatus?.endsWith(":fill") ? "fill" : "fit"
    await createImageProcessingJob({
      mediaAssetId: asset.id,
      basePathname: asset.sourcePathname.replace(/\/source\.[^/]+$/, ""),
      contentMode,
    }).catch(() => undefined)
  }

  const rows = await getDb()
    .select({ id: imageProcessingJobs.id })
    .from(imageProcessingJobs)
    .where(
      and(
        inArray(imageProcessingJobs.status, ["pending", "error"]),
        lt(imageProcessingJobs.attempts, 6),
        lt(imageProcessingJobs.updatedAt, new Date(Date.now() - 60_000)),
      ),
    )
    .orderBy(asc(imageProcessingJobs.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 10, 1), 25))

  const results = await Promise.allSettled(
    rows.map(({ id }) => scheduleImageProcessing(id, "scheduled_reconciliation")),
  )
  return {
    scanned: rows.length,
    scheduled: results.filter(({ status }) => status === "fulfilled").length,
    failed: results.filter(({ status }) => status === "rejected").length,
  }
}
