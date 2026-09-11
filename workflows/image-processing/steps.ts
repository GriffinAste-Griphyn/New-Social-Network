import { and, eq, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  imageProcessingJobs,
  mediaAssets,
  stories,
} from "@/lib/db/schema"
import { invalidateMobileFeedSnapshotsForCreator } from "@/lib/feed-snapshot-store"
import { moderatePendingStory } from "@/lib/story-moderation-core"
import {
  createServerEncodedStoryImageAsset,
  type StoryImageContentMode,
} from "@/lib/story-image-processing"
import { enqueueStoryPublication } from "@/lib/story-publication"
import { deriveStoryPublicationStatus } from "@/lib/stories/cloudflare-status"

const maximumImageProcessingAttempts = 6

async function readJob(jobId: string) {
  const [job] = await getDb()
    .select()
    .from(imageProcessingJobs)
    .where(eq(imageProcessingJobs.id, jobId))
    .limit(1)
  if (!job) throw new Error(`Image processing job ${jobId} was not found.`)
  return job
}

export async function claimImageProcessingStep(
  jobId: string,
  workflowRunId: string,
) {
  "use step"

  const job = await readJob(jobId)
  if (job.status === "ready" || job.attempts >= maximumImageProcessingAttempts) {
    return null
  }
  if (job.status !== "pending" && job.status !== "error") return null

  const now = new Date()
  const [claimed] = await getDb()
    .update(imageProcessingJobs)
    .set({
      workflowRunId,
      status: "processing",
      attempts: sql`${imageProcessingJobs.attempts} + 1`,
      lastError: null,
      startedAt: job.startedAt ?? now,
      finishedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(imageProcessingJobs.id, job.id),
        eq(imageProcessingJobs.status, job.status),
        eq(imageProcessingJobs.attempts, job.attempts),
      ),
    )
    .returning({ attempts: imageProcessingJobs.attempts })

  if (!claimed) return null
  await getDb()
    .update(mediaAssets)
    .set({
      workflowRunId,
      processingStatus: "processing",
      providerStatus: "processing",
      providerPctComplete: 10,
      providerError: null,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, job.mediaAssetId))
  await getDb()
    .update(stories)
    .set({ processingStatus: "processing" })
    .where(eq(stories.mediaAssetId, job.mediaAssetId))

  return { attempt: claimed.attempts }
}

export async function processImageAssetStep(jobId: string) {
  "use step"

  const job = await readJob(jobId)
  const [asset] = await getDb()
    .select({
      ownerUserId: mediaAssets.ownerUserId,
      sourcePathname: mediaAssets.originalStorageKey,
      contentType: mediaAssets.originalContentType,
      byteSize: mediaAssets.originalByteSize,
      checksum: mediaAssets.originalChecksum,
      storageProvider: mediaAssets.originalStorageProvider,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, job.mediaAssetId))
    .limit(1)

  if (
    !asset?.sourcePathname ||
    !asset.contentType ||
    !asset.byteSize ||
    !asset.checksum
  ) {
    throw new Error("The source image metadata is incomplete.")
  }

  return createServerEncodedStoryImageAsset({
    basePathname: job.basePathname,
    ownerUserId: asset.ownerUserId,
    contentMode: job.contentMode as StoryImageContentMode,
    storageProvider:
      asset.storageProvider === "cloudflare-r2"
        ? "cloudflare-r2"
        : "vercel-blob",
    source: {
      pathname: asset.sourcePathname,
      contentType: asset.contentType,
      byteSize: asset.byteSize,
      checksum: asset.checksum,
    },
    deleteSourceAfterProcessing: false,
  })
}

processImageAssetStep.maxRetries = 5

export async function completeImageProcessingStep(
  jobId: string,
  output: Awaited<ReturnType<typeof processImageAssetStep>>,
) {
  "use step"

  const job = await readJob(jobId)
  const db = getDb()
  const now = new Date()
  await db
    .update(mediaAssets)
    .set({
      storageProvider: output.storageProvider,
      storageKey: output.storageKey,
      mediaUrl: output.mediaUrl,
      thumbnailUrl: output.thumbnailUrl,
      placeholderUrl: output.placeholderUrl ?? null,
      contentType: output.contentType,
      byteSize: output.byteSize,
      checksum: output.checksum,
      width: output.width,
      height: output.height,
      originalWidth: output.originalWidth ?? null,
      originalHeight: output.originalHeight ?? null,
      processingStatus: "ready",
      providerStatus: "ready",
      providerPctComplete: 100,
      providerError: null,
      qualityStatus: "passed",
      readyAt: now,
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
    const status = deriveStoryPublicationStatus({
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
        mediaUrl: output.mediaUrl,
        thumbnailUrl: output.thumbnailUrl,
        placeholderUrl: output.placeholderUrl ?? null,
        storageProvider: output.storageProvider,
        storageKey: output.storageKey,
        contentType: output.contentType,
        byteSize: output.byteSize,
        checksum: output.checksum,
        width: output.width,
        height: output.height,
        originalWidth: output.originalWidth ?? null,
        originalHeight: output.originalHeight ?? null,
        processingStatus: "ready",
        status,
      })
      .where(eq(stories.id, story.id))

    if (status === "live" && story.status !== "live") {
      await enqueueStoryPublication(story.id)
    } else {
      await invalidateMobileFeedSnapshotsForCreator(story.creatorId)
    }
  }

  await db
    .update(imageProcessingJobs)
    .set({
      status: "ready",
      lastError: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(imageProcessingJobs.id, job.id))

  // Moderation is deliberately deferred until the verified display image is
  // available. Keep moderation failures separate from image-processing state:
  // the durable pending moderation row can be retried by the status endpoint
  // and reconciler without falsely reporting that the upload itself failed.
  const pendingModerationStories = linkedStories.filter(
    (story) => story.moderationStatus === "pending",
  )
  const moderationResults = await Promise.allSettled(
    pendingModerationStories.map((story) => moderatePendingStory(story.id)),
  )
  moderationResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("story_moderation_after_image_processing_failed", {
        storyId: pendingModerationStories[index]?.id,
        error: result.reason,
      })
    }
  })

  return { status: "completed" as const, storyCount: linkedStories.length }
}

export async function failImageProcessingStep(jobId: string, message: string) {
  "use step"

  const job = await readJob(jobId)
  const now = new Date()
  const willRetry = job.attempts < maximumImageProcessingAttempts
  await getDb()
    .update(imageProcessingJobs)
    .set({ status: "error", lastError: message.slice(0, 2_000), updatedAt: now })
    .where(eq(imageProcessingJobs.id, job.id))
  await getDb()
    .update(mediaAssets)
    .set({
      processingStatus: willRetry ? "processing" : "error",
      providerStatus: willRetry ? `queued:${job.contentMode}` : "error",
      providerError: willRetry
        ? "Image processing will retry automatically."
        : "Image processing failed after multiple attempts.",
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, job.mediaAssetId))
  await getDb()
    .update(stories)
    .set({ processingStatus: willRetry ? "processing" : "error" })
    .where(eq(stories.mediaAssetId, job.mediaAssetId))
}
