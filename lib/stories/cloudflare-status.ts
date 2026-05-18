import { asc, and, eq, gt } from "drizzle-orm"

import { processStoryCreatorEarnings } from "@/lib/creator-earnings"
import { notifyCreatorStoryPosted } from "@/lib/creator-notifications"
import { getDb } from "@/lib/db"
import { mediaAssets, stories, users } from "@/lib/db/schema"
import {
  createCloudflareStreamThumbnailMediaUrl,
  getCloudflareStreamVideoDetails,
  setCloudflareStreamThumbnailToLastFrame,
} from "@/lib/story-storage"

export async function refreshProcessingCloudflareStories(input: {
  creatorId?: string
  limit?: number
} = {}) {
  const db = getDb()
  const now = new Date()
  const pendingStories = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      creatorName: users.displayName,
      mediaAssetId: stories.mediaAssetId,
      storageKey: stories.storageKey,
      thumbnailUrl: stories.thumbnailUrl,
      caption: stories.caption,
      durationMs: stories.durationMs,
      byteSize: stories.byteSize,
      width: stories.width,
      height: stories.height,
    })
    .from(stories)
    .innerJoin(users, eq(stories.creatorId, users.id))
    .where(
      and(
        eq(stories.storageProvider, "cloudflare-stream"),
        eq(stories.processingStatus, "processing"),
        eq(stories.status, "processing"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, now),
        input.creatorId ? eq(stories.creatorId, input.creatorId) : undefined,
      ),
    )
    .orderBy(asc(stories.createdAt))
    .limit(input.limit ?? 8)

  await Promise.all(
    pendingStories.map(async (story) => {
      if (!story.storageKey) {
        return
      }

      let details: Awaited<ReturnType<typeof getCloudflareStreamVideoDetails>>

      try {
        details = await getCloudflareStreamVideoDetails(story.storageKey)
      } catch (error) {
        await db
          .update(mediaAssets)
          .set({
            providerError:
              error instanceof Error ? error.message : "Could not check video status.",
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(mediaAssets.id, story.mediaAssetId))
        return
      }

      if (details.state === "error") {
        const checkedAt = new Date()
        await Promise.all([
          db
            .update(mediaAssets)
            .set({
              processingStatus: "error",
              providerStatus: "error",
              providerError:
                details.errorReason ?? "Cloudflare Stream could not process the video.",
              lastCheckedAt: checkedAt,
              updatedAt: checkedAt,
            })
            .where(eq(mediaAssets.id, story.mediaAssetId)),
          db
            .update(stories)
            .set({
              processingStatus: "error",
              moderationReason:
                details.errorReason ?? "Cloudflare Stream could not process the video.",
            })
            .where(eq(stories.id, story.id)),
        ])
        return
      }

      if (!details.readyToStream) {
        await db
          .update(mediaAssets)
          .set({
            providerStatus: details.state ?? "processing",
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(mediaAssets.id, story.mediaAssetId))
        return
      }

      const readyAt = new Date()
      const durationMs = details.durationMs ?? story.durationMs
      const byteSize = details.byteSize ?? story.byteSize
      const width = details.width ?? story.width
      const height = details.height ?? story.height
      const thumbnailUrl =
        story.thumbnailUrl ??
        (story.storageKey
          ? createCloudflareStreamThumbnailMediaUrl(story.storageKey)
          : null)

      if (story.storageKey) {
        await setCloudflareStreamThumbnailToLastFrame(story.storageKey).catch(
          () => undefined,
        )
      }

      await db
        .update(mediaAssets)
        .set({
          processingStatus: "ready",
          providerStatus: "ready",
          providerError: null,
          byteSize: byteSize ?? undefined,
          thumbnailUrl,
          durationMs,
          width,
          height,
          readyAt,
          lastCheckedAt: readyAt,
          updatedAt: readyAt,
        })
        .where(eq(mediaAssets.id, story.mediaAssetId))

      const promotedStories = await db
        .update(stories)
        .set({
          processingStatus: "ready",
          status: "live",
          durationMs,
          byteSize,
          thumbnailUrl,
          width,
          height,
        })
        .where(
          and(
            eq(stories.id, story.id),
            eq(stories.processingStatus, "processing"),
            eq(stories.status, "processing"),
          ),
        )
        .returning({ id: stories.id })

      if (promotedStories.length === 0) {
        return
      }

      await processStoryCreatorEarnings(story.id)
      await notifyCreatorStoryPosted({
        creatorId: story.creatorId,
        creatorName: story.creatorName ?? "Creator",
        storyId: story.id,
        caption: story.caption,
      }).catch(() => undefined)
    }),
  )
}

type CloudflareStreamStoryDetails = Awaited<
  ReturnType<typeof getCloudflareStreamVideoDetails>
>

export async function syncCloudflareStreamStoryStatus(input: {
  uid: string
  details?: CloudflareStreamStoryDetails
}) {
  const db = getDb()
  const now = new Date()
  const [story] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      creatorName: users.displayName,
      mediaAssetId: stories.mediaAssetId,
      storageKey: stories.storageKey,
      thumbnailUrl: stories.thumbnailUrl,
      caption: stories.caption,
      durationMs: stories.durationMs,
      byteSize: stories.byteSize,
      width: stories.width,
      height: stories.height,
      status: stories.status,
      processingStatus: stories.processingStatus,
      moderationStatus: stories.moderationStatus,
    })
    .from(stories)
    .innerJoin(users, eq(stories.creatorId, users.id))
    .where(
      and(
        eq(stories.storageProvider, "cloudflare-stream"),
        eq(stories.storageKey, input.uid),
        gt(stories.expiresAt, now),
      ),
    )
    .limit(1)

  if (!story) {
    return { status: "not_found" as const, storyId: null }
  }

  if (
    story.status !== "processing" ||
    story.processingStatus !== "processing" ||
    story.moderationStatus !== "approved"
  ) {
    return {
      status: story.status,
      processingStatus: story.processingStatus,
      storyId: story.id,
    }
  }

  const details = input.details ?? (await getCloudflareStreamVideoDetails(input.uid))

  if (details.state === "error") {
    const checkedAt = new Date()
    const errorReason =
      details.errorReason ?? "Cloudflare Stream could not process the video."

    await Promise.all([
      db
        .update(mediaAssets)
        .set({
          processingStatus: "error",
          providerStatus: "error",
          providerError: errorReason,
          lastCheckedAt: checkedAt,
          updatedAt: checkedAt,
        })
        .where(eq(mediaAssets.id, story.mediaAssetId)),
      db
        .update(stories)
        .set({
          processingStatus: "error",
          moderationReason: errorReason,
        })
        .where(eq(stories.id, story.id)),
    ])

    return { status: "error" as const, storyId: story.id }
  }

  if (!details.readyToStream) {
    await db
      .update(mediaAssets)
      .set({
        providerStatus: details.state ?? "processing",
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mediaAssets.id, story.mediaAssetId))

    return { status: "processing" as const, storyId: story.id }
  }

  const readyAt = new Date()
  const durationMs = details.durationMs ?? story.durationMs
  const byteSize = details.byteSize ?? story.byteSize
  const width = details.width ?? story.width
  const height = details.height ?? story.height
  const thumbnailUrl =
    story.thumbnailUrl ??
    (story.storageKey ? createCloudflareStreamThumbnailMediaUrl(story.storageKey) : null)

  if (story.storageKey) {
    await setCloudflareStreamThumbnailToLastFrame(story.storageKey).catch(
      () => undefined,
    )
  }

  await db
    .update(mediaAssets)
    .set({
      processingStatus: "ready",
      providerStatus: "ready",
      providerError: null,
      byteSize: byteSize ?? undefined,
      thumbnailUrl,
      durationMs,
      width,
      height,
      readyAt,
      lastCheckedAt: readyAt,
      updatedAt: readyAt,
    })
    .where(eq(mediaAssets.id, story.mediaAssetId))

  const promotedStories = await db
    .update(stories)
    .set({
      processingStatus: "ready",
      status: "live",
      byteSize,
      thumbnailUrl,
      durationMs,
      width,
      height,
    })
    .where(
      and(
        eq(stories.id, story.id),
        eq(stories.processingStatus, "processing"),
        eq(stories.status, "processing"),
      ),
    )
    .returning({ id: stories.id })

  if (promotedStories.length > 0) {
    await processStoryCreatorEarnings(story.id)
    await notifyCreatorStoryPosted({
      creatorId: story.creatorId,
      creatorName: story.creatorName ?? "Creator",
      storyId: story.id,
      caption: story.caption,
    }).catch(() => undefined)
  }

  return { status: "live" as const, storyId: story.id }
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
        creatorId: stories.creatorId,
        storageProvider: stories.storageProvider,
        storageKey: stories.storageKey,
        status: stories.status,
        processingStatus: stories.processingStatus,
        moderationStatus: stories.moderationStatus,
        moderationReason: stories.moderationReason,
      })
      .from(stories)
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
    story.status === "processing" &&
    story.processingStatus === "processing"
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
    status: story.status,
    processingStatus: story.processingStatus,
    moderationStatus: story.moderationStatus,
    moderationReason: story.moderationReason,
    isLive: story.status === "live" && story.processingStatus === "ready",
  }
}
