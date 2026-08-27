import { and, asc, eq, gt, inArray } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { mediaAssets, stories } from "@/lib/db/schema"
import { enqueueStoryPublication } from "@/lib/story-publication"
import {
  isCloudflareStreamFullyReady,
  recordCloudflareStreamUploadStatus,
  type CloudflareStreamProviderDetails,
} from "@/lib/media-upload-sessions"
import {
  createCloudflareStreamThumbnailMediaUrl,
  getCloudflareStreamVideoDetails,
  setCloudflareStreamThumbnailAtDefaultTime,
} from "@/lib/story-storage"

type CloudflareStoryStatus = "processing" | "live" | "expired" | "removed"

export function deriveStoryPublicationStatus(input: {
  currentStatus: CloudflareStoryStatus
  moderationStatus: string
  providerReady: boolean
  expiresAt: Date
  now: Date
  scanStatus?: string | null
  structuralReady?: boolean
}): CloudflareStoryStatus {
  if (
    input.currentStatus === "expired" ||
    input.expiresAt.getTime() <= input.now.getTime()
  ) {
    return "expired"
  }

  // A removed story may have been deleted by its creator. Provider callbacks
  // and later moderation changes must never resurrect it.
  if (input.currentStatus === "removed") {
    return "removed"
  }

  if (
    input.moderationStatus === "rejected" ||
    input.moderationStatus === "deleted"
  ) {
    return "removed"
  }

  const structuralReady =
    input.structuralReady ??
    input.scanStatus === "passed"

  return input.moderationStatus === "approved" && input.providerReady && structuralReady
    ? "live"
    : "processing"
}

export function deriveCloudflareStoryStatus(
  input: Parameters<typeof deriveStoryPublicationStatus>[0],
) {
  return deriveStoryPublicationStatus(input)
}

export async function refreshProcessingCloudflareStories(input: {
  creatorId?: string
  limit?: number
} = {}) {
  const pendingStories = await getDb()
    .select({ uid: stories.storageKey })
    .from(stories)
    .where(
      and(
        eq(stories.storageProvider, "cloudflare-stream"),
        eq(stories.processingStatus, "processing"),
        inArray(stories.status, ["processing", "live"]),
        gt(stories.expiresAt, new Date()),
        input.creatorId ? eq(stories.creatorId, input.creatorId) : undefined,
      ),
    )
    .orderBy(asc(stories.createdAt))
    .limit(input.limit ?? 50)

  for (let index = 0; index < pendingStories.length; index += 10) {
    await Promise.all(
      pendingStories.slice(index, index + 10).map(async ({ uid }) => {
        if (!uid) return
        await syncCloudflareStreamStoryStatus({ uid }).catch(() => undefined)
      }),
    )
  }
}

export async function syncCloudflareStreamStoryStatus(input: {
  uid: string
  details?: CloudflareStreamProviderDetails
}) {
  const db = getDb()
  const details =
    input.details ?? (await getCloudflareStreamVideoDetails(input.uid))
  const retainedSession = await recordCloudflareStreamUploadStatus({
    uid: input.uid,
    details,
  })
  const [story] = await db
    .select({
      id: stories.id,
      mediaAssetId: stories.mediaAssetId,
      storageKey: stories.storageKey,
      thumbnailUrl: stories.thumbnailUrl,
      durationMs: stories.durationMs,
      byteSize: stories.byteSize,
      width: stories.width,
      height: stories.height,
      expiresAt: stories.expiresAt,
      status: stories.status,
      processingStatus: stories.processingStatus,
      moderationStatus: stories.moderationStatus,
      assetProcessingStatus: mediaAssets.processingStatus,
      assetScanStatus: mediaAssets.scanStatus,
      previousProviderPctComplete: mediaAssets.providerPctComplete,
    })
    .from(stories)
    .innerJoin(mediaAssets, eq(stories.mediaAssetId, mediaAssets.id))
    .where(
      and(
        eq(stories.storageProvider, "cloudflare-stream"),
        eq(stories.storageKey, input.uid),
      ),
    )
    .limit(1)

  if (!story) {
    return retainedSession
      ? {
          status: "retained" as const,
          storyId: null,
          uploadSessionId: retainedSession.id,
        }
      : { status: "not_found" as const, storyId: null }
  }

  const checkedAt = new Date()

  if (details.state === "error") {
    const errorReason =
      details.errorReason ?? "Cloudflare Stream could not process the video."
    const nextStatus = deriveCloudflareStoryStatus({
      currentStatus: story.status,
      moderationStatus: story.moderationStatus,
      providerReady: false,
      expiresAt: story.expiresAt,
      now: checkedAt,
      scanStatus: story.assetScanStatus,
    })

    const reconciledStories = await db
      .update(stories)
      .set({ processingStatus: "error", status: nextStatus })
      .where(
        and(
          eq(stories.id, story.id),
          eq(stories.storageProvider, "cloudflare-stream"),
          eq(stories.storageKey, input.uid),
          eq(stories.status, story.status),
          eq(stories.processingStatus, story.processingStatus),
          eq(stories.moderationStatus, story.moderationStatus),
        ),
      )
      .returning({ id: stories.id })

    if (reconciledStories.length === 0) {
      return { status: "stale" as const, storyId: story.id }
    }

    await db
      .update(mediaAssets)
      .set({
        processingStatus: "error",
        providerStatus: "error",
        providerError: errorReason,
        lastCheckedAt: checkedAt,
        updatedAt: checkedAt,
      })
      .where(eq(mediaAssets.id, story.mediaAssetId))

    return {
      status: nextStatus,
      processingStatus: "error" as const,
      storyId: story.id,
    }
  }

  const observedProviderPercentages = [
    story.previousProviderPctComplete,
    details.pctComplete,
  ].filter((value): value is number => value !== null)
  const providerPctComplete =
    observedProviderPercentages.length > 0
      ? Math.max(...observedProviderPercentages)
      : null
  const providerReady = isCloudflareStreamFullyReady({
    readyToStream:
      story.assetProcessingStatus === "ready" || details.readyToStream,
    state: details.state,
    pctComplete: providerPctComplete,
  })

  if (!providerReady) {
    const nextStatus = deriveCloudflareStoryStatus({
      currentStatus: story.status,
      moderationStatus: story.moderationStatus,
      providerReady: false,
      expiresAt: story.expiresAt,
      now: checkedAt,
      scanStatus: story.assetScanStatus,
    })

    const reconciledStories = await db
      .update(stories)
      .set({ processingStatus: "processing", status: nextStatus })
      .where(
        and(
          eq(stories.id, story.id),
          eq(stories.storageProvider, "cloudflare-stream"),
          eq(stories.storageKey, input.uid),
          eq(stories.status, story.status),
          eq(stories.processingStatus, story.processingStatus),
          eq(stories.moderationStatus, story.moderationStatus),
        ),
      )
      .returning({ id: stories.id })

    if (reconciledStories.length === 0) {
      return { status: "stale" as const, storyId: story.id }
    }

    await db
      .update(mediaAssets)
      .set({
        processingStatus: "processing",
        providerStatus: details.state ?? "processing",
        providerPctComplete:
          details.pctComplete === null ? undefined : providerPctComplete,
        providerError: null,
        lastCheckedAt: checkedAt,
        updatedAt: checkedAt,
      })
      .where(eq(mediaAssets.id, story.mediaAssetId))

    return {
      status: nextStatus,
      processingStatus: "processing" as const,
      storyId: story.id,
    }
  }

  const durationMs = details.durationMs ?? story.durationMs
  const byteSize = details.byteSize ?? story.byteSize
  const width = details.width ?? story.width
  const height = details.height ?? story.height
  const thumbnailUrl =
    story.thumbnailUrl ??
    (story.storageKey
      ? createCloudflareStreamThumbnailMediaUrl(story.storageKey)
      : null)
  const nextStatus = deriveCloudflareStoryStatus({
    currentStatus: story.status,
    moderationStatus: story.moderationStatus,
    providerReady: true,
    expiresAt: story.expiresAt,
    now: checkedAt,
    scanStatus: story.assetScanStatus,
  })

  if (story.storageKey) {
    await setCloudflareStreamThumbnailAtDefaultTime(story.storageKey).catch(
      () => undefined,
    )
  }

  const reconciledStories = await db
    .update(stories)
    .set({
      processingStatus: "ready",
      status: nextStatus,
      byteSize,
      thumbnailUrl,
      placeholderUrl: thumbnailUrl,
      durationMs,
      width,
      height,
    })
    .where(
      and(
        eq(stories.id, story.id),
        eq(stories.storageProvider, "cloudflare-stream"),
        eq(stories.storageKey, input.uid),
        eq(stories.status, story.status),
        eq(stories.processingStatus, story.processingStatus),
        eq(stories.moderationStatus, story.moderationStatus),
      ),
    )
    .returning({ id: stories.id })

  if (reconciledStories.length === 0) {
    return { status: "stale" as const, storyId: story.id }
  }

  await db
    .update(mediaAssets)
    .set({
      processingStatus: "ready",
      providerStatus: details.state ?? "ready",
      providerPctComplete: Math.max(100, providerPctComplete ?? 0),
      providerError: null,
      byteSize: byteSize ?? undefined,
      thumbnailUrl,
      placeholderUrl: thumbnailUrl,
      durationMs,
      width,
      height,
      readyAt: checkedAt,
      lastCheckedAt: checkedAt,
      updatedAt: checkedAt,
    })
    .where(eq(mediaAssets.id, story.mediaAssetId))

  if (nextStatus === "live" && story.status !== "live") {
    await enqueueStoryPublication(story.id)
  }

  return {
    status: nextStatus,
    processingStatus: "ready" as const,
    storyId: story.id,
  }
}

export async function getStoryUploadStatusForOwner(
  storyId: string,
  ownerId: string,
) {
  const db = getDb()

  const readStory = async () => {
    const [story] = await db
      .select({
        id: stories.id,
        mediaAssetId: stories.mediaAssetId,
        creatorId: stories.creatorId,
        assetKind: stories.assetKind,
        storageProvider: stories.storageProvider,
        storageKey: stories.storageKey,
        status: stories.status,
        processingStatus: stories.processingStatus,
        originalStorageKey: stories.originalStorageKey,
        moderationStatus: stories.moderationStatus,
        moderationReason: stories.moderationReason,
        providerStatus: mediaAssets.providerStatus,
        providerPctComplete: mediaAssets.providerPctComplete,
        providerError: mediaAssets.providerError,
        lastCheckedAt: mediaAssets.lastCheckedAt,
        readyAt: mediaAssets.readyAt,
      })
      .from(stories)
      .innerJoin(mediaAssets, eq(stories.mediaAssetId, mediaAssets.id))
      .where(and(eq(stories.id, storyId), eq(stories.creatorId, ownerId)))
      .limit(1)

    return story ?? null
  }

  let story = await readStory()

  if (!story) {
    return null
  }

  if (
    story.storageProvider === "cloudflare-stream" &&
    story.storageKey &&
    story.processingStatus !== "ready"
  ) {
    await syncCloudflareStreamStoryStatus({ uid: story.storageKey }).catch(
      () => undefined,
    )
    story = await readStory()
  }

  if (!story) {
    return null
  }

  return {
    id: story.id,
    mediaAssetId: story.mediaAssetId,
    assetKind: story.assetKind,
    storageProvider: story.storageProvider,
    status: story.status,
    processingStatus: story.processingStatus,
    hasOriginalRendition: Boolean(story.originalStorageKey),
    moderationStatus: story.moderationStatus,
    moderationReason: story.moderationReason,
    providerStatus: story.providerStatus,
    providerPctComplete: story.providerPctComplete,
    fullQualityReady:
      story.storageProvider === "cloudflare-stream"
        ? story.processingStatus === "ready" &&
          (story.providerPctComplete ?? 0) >= 100
        : story.processingStatus === "ready" &&
          (story.providerPctComplete ?? 0) >= 100,
    providerError: story.providerError,
    lastCheckedAt: story.lastCheckedAt?.toISOString() ?? null,
    readyAt: story.readyAt?.toISOString() ?? null,
    isLive:
      story.status === "live" &&
      story.processingStatus === "ready" &&
      story.moderationStatus === "approved",
  }
}
