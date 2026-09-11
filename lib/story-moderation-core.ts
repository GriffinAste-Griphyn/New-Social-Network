import { and, eq, gt } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  mediaAssets,
  stories,
  storyElements,
  storyMentions,
} from "@/lib/db/schema"
import { invalidateMobileFeedSnapshotsForCreator } from "@/lib/feed-snapshot-store"
import { applyMediaModerationResult } from "@/lib/media-assets"
import { moderateUserContent } from "@/lib/safety/moderate-content"
import { recordModerationCheck } from "@/lib/safety/moderation-checks"
import { isRetryableStoryModeration } from "@/lib/safety/moderation-retry"
import type { ContentModerationResult } from "@/lib/safety/policy"
import { reviewableStoryMediaUrl } from "@/lib/story-media/access"
import { enqueueStoryPublication } from "@/lib/story-publication"
import { deriveStoryPublicationStatus } from "@/lib/stories/cloudflare-status"

function moderationStatus(result: ContentModerationResult) {
  return result.action === "approve"
    ? "approved"
    : result.action === "reject"
      ? "rejected"
      : "flagged"
}

export async function moderatePendingStory(storyId: string) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      mediaAssetId: stories.mediaAssetId,
      assetKind: stories.assetKind,
      mediaUrl: stories.mediaUrl,
      thumbnailUrl: stories.thumbnailUrl,
      contentType: stories.contentType,
      byteSize: stories.byteSize,
      durationMs: stories.durationMs,
      caption: stories.caption,
      status: stories.status,
      processingStatus: stories.processingStatus,
      moderationStatus: stories.moderationStatus,
      moderationReason: stories.moderationReason,
      expiresAt: stories.expiresAt,
      scanStatus: mediaAssets.scanStatus,
      scanReason: mediaAssets.scanReason,
    })
    .from(stories)
    .innerJoin(mediaAssets, eq(stories.mediaAssetId, mediaAssets.id))
    .where(eq(stories.id, storyId))
    .limit(1)

  if (
    !story ||
    !isRetryableStoryModeration({
      moderationStatus: story.moderationStatus,
      moderationReason: story.moderationReason,
    })
  ) {
    return { status: "skipped" as const }
  }
  if (story.expiresAt.getTime() <= Date.now() || story.status === "removed") {
    return { status: "expired" as const }
  }
  // Image uploads initially point at the private source object. Wait for the
  // image worker to publish the verified display rendition before asking the
  // moderation provider to retrieve it. The image completion step re-enters
  // moderation as soon as that rendition is ready.
  if (story.assetKind === "image" && story.processingStatus !== "ready") {
    return { status: "waiting_for_media" as const }
  }

  const [elements, mentions] = await Promise.all([
    db
      .select({ label: storyElements.label, href: storyElements.href })
      .from(storyElements)
      .where(eq(storyElements.storyId, story.id)),
    db
      .select({ brandSlug: storyMentions.brandSlug })
      .from(storyMentions)
      .where(eq(storyMentions.storyId, story.id)),
  ])

  let result = await moderateUserContent({
    textParts: [
      story.caption,
      mentions.map(({ brandSlug }) => brandSlug).join(" "),
      ...elements.map(({ label }) => label),
    ],
    linkUrls: elements.flatMap(({ href }) => (href ? [href] : [])),
    media: {
      assetKind: story.assetKind,
      contentType: story.contentType ?? `${story.assetKind}/unknown`,
      byteSize: story.byteSize ?? 0,
      durationMs: story.durationMs,
      mediaUrl:
        story.assetKind === "image"
          ? reviewableStoryMediaUrl(story.mediaUrl)
          : null,
      thumbnailUrl: reviewableStoryMediaUrl(story.thumbnailUrl),
    },
  })

  const retryingInfrastructureHold =
    story.moderationStatus === "flagged" &&
    isRetryableStoryModeration({
      moderationStatus: story.moderationStatus,
      moderationReason: story.moderationReason,
    })
  if (
    (story.scanStatus === "flagged" || story.scanStatus === "failed") &&
    result.action === "approve" &&
    !retryingInfrastructureHold
  ) {
    result = {
      ...result,
      action: "hold",
      provider: `${result.provider}+local-media`,
      reason: story.scanReason ?? "Media failed structural validation.",
    }
  }

  const nextModerationStatus = moderationStatus(result)
  const now = new Date()
  const nextStatus = deriveStoryPublicationStatus({
    currentStatus: story.status,
    moderationStatus: nextModerationStatus,
    providerReady: story.processingStatus === "ready",
    structuralReady: story.scanStatus === "passed",
    expiresAt: story.expiresAt,
    now,
  })
  const [updated] = await db
    .update(stories)
    .set({
      moderationStatus: nextModerationStatus,
      moderationReason: result.reason,
      status: nextStatus,
    })
    .where(
      and(
        eq(stories.id, story.id),
        eq(stories.moderationStatus, story.moderationStatus),
        gt(stories.expiresAt, now),
      ),
    )
    .returning({ id: stories.id })

  if (!updated) return { status: "stale" as const }

  await Promise.all([
    applyMediaModerationResult({
      mediaAssetId: story.mediaAssetId,
      actorUserId: story.creatorId,
      result,
    }),
    recordModerationCheck({
      targetKind: "story",
      targetId: story.id,
      actorUserId: story.creatorId,
      mediaAssetId: story.mediaAssetId,
      result,
    }),
  ])

  if (nextStatus === "live") {
    await enqueueStoryPublication(story.id)
  } else {
    await invalidateMobileFeedSnapshotsForCreator(story.creatorId)
  }

  return {
    status: "completed" as const,
    moderationStatus: nextModerationStatus,
    storyStatus: nextStatus,
  }
}
