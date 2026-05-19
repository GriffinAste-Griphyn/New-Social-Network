import { randomUUID } from "node:crypto"

import { and, desc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { getDb } from "@/lib/db"
import { follows, stories, storyInteractions, users } from "@/lib/db/schema"
import {
  applyMediaModerationResult,
  createMediaAssetFromStoredStoryAsset,
} from "@/lib/media-assets"
import { moderateUserContent } from "@/lib/safety/moderate-content"
import { recordModerationCheck } from "@/lib/safety/moderation-checks"
import {
  assertUsersCanConnect,
  getBlockedPeerIds,
} from "@/lib/social-safety"
import type { StoredStoryAsset } from "@/lib/story-storage"
import type { ContentModerationResult } from "@/lib/safety/policy"

export type StoryInteractionKind = "reply" | "comment" | "reaction"

export type StoryInteractionEvent = {
  id: string
  storyId: string
  creatorId: string
  story: {
    assetKind: "image" | "video"
    mediaUrl: string
    thumbnailUrl: string | null
  }
  actor: {
    id: string
    name: string
    handle: string
    imageUrl: string | null
  }
  kind: StoryInteractionKind
  body: string | null
  reaction: string | null
  mediaUrl: string | null
  mediaThumbnailUrl: string | null
  mediaAssetKind: "image" | "video" | null
  createdAt: string
}

export type SentStoryInteractionEvent = StoryInteractionEvent & {
  target: {
    id: string
    name: string
    handle: string
    imageUrl: string | null
  }
}

function mapEvent(row: {
  id: string
  storyId: string
  creatorId: string
  actorId: string
  displayName: string | null
  handle: string | null
  avatarUrl: string | null
  kind: StoryInteractionKind
  storyAssetKind: "image" | "video"
  storyMediaUrl: string
  storyThumbnailUrl: string | null
  body: string | null
  reaction: string | null
  mediaUrl: string | null
  mediaThumbnailUrl: string | null
  mediaAssetKind: "image" | "video" | null
  createdAt: Date
}): StoryInteractionEvent | null {
  if (!row.displayName || !row.handle) {
    return null
  }

  return {
    id: row.id,
    storyId: row.storyId,
    creatorId: row.creatorId,
    story: {
      assetKind: row.storyAssetKind,
      mediaUrl: row.storyMediaUrl,
      thumbnailUrl: row.storyThumbnailUrl,
    },
    actor: {
      id: row.actorId,
      name: row.displayName,
      handle: row.handle,
      imageUrl: row.avatarUrl,
    },
    kind: row.kind,
    body: row.body,
    reaction: row.reaction,
    mediaUrl: row.mediaUrl,
    mediaThumbnailUrl: row.mediaThumbnailUrl,
    mediaAssetKind: row.mediaAssetKind,
    createdAt: row.createdAt.toISOString(),
  }
}

function mapSentEvent(row: {
  id: string
  storyId: string
  creatorId: string
  actorId: string
  actorDisplayName: string | null
  actorHandle: string | null
  actorAvatarUrl: string | null
  creatorDisplayName: string | null
  creatorHandle: string | null
  creatorAvatarUrl: string | null
  kind: StoryInteractionKind
  storyAssetKind: "image" | "video"
  storyMediaUrl: string
  storyThumbnailUrl: string | null
  body: string | null
  reaction: string | null
  mediaUrl: string | null
  mediaThumbnailUrl: string | null
  mediaAssetKind: "image" | "video" | null
  createdAt: Date
}): SentStoryInteractionEvent | null {
  if (
    !row.actorDisplayName ||
    !row.actorHandle ||
    !row.creatorDisplayName ||
    !row.creatorHandle
  ) {
    return null
  }

  return {
    id: row.id,
    storyId: row.storyId,
    creatorId: row.creatorId,
    story: {
      assetKind: row.storyAssetKind,
      mediaUrl: row.storyMediaUrl,
      thumbnailUrl: row.storyThumbnailUrl,
    },
    actor: {
      id: row.actorId,
      name: row.actorDisplayName,
      handle: row.actorHandle,
      imageUrl: row.actorAvatarUrl,
    },
    target: {
      id: row.creatorId,
      name: row.creatorDisplayName,
      handle: row.creatorHandle,
      imageUrl: row.creatorAvatarUrl,
    },
    kind: row.kind,
    body: row.body,
    reaction: row.reaction,
    mediaUrl: row.mediaUrl,
    mediaThumbnailUrl: row.mediaThumbnailUrl,
    mediaAssetKind: row.mediaAssetKind,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function createStoryInteraction(input: {
  storyId: string
  actorId: string
  kind: StoryInteractionKind
  body?: string | null
  reaction?: string | null
  storedAsset?: StoredStoryAsset | null
  moderationMediaUrl?: string | null
  moderationThumbnailUrl?: string | null
}) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      status: stories.status,
    })
    .from(stories)
    .where(eq(stories.id, input.storyId))
    .limit(1)

  if (!story) {
    throw new Error("That story is no longer available.")
  }

  if (story.status === "removed") {
    throw new Error("That story is no longer available.")
  }

  if (story.creatorId === input.actorId) {
    throw new Error("You cannot reply to your own story.")
  }

  await assertUsersCanConnect({
    actorId: input.actorId,
    targetUserId: story.creatorId,
  })

  const [follow] = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(
      and(
        eq(follows.followerId, input.actorId),
        eq(follows.followeeId, story.creatorId),
      ),
    )
    .limit(1)

  if (!follow) {
    throw new Error("Follow this creator before responding.")
  }

  const body = input.body?.trim() || null
  const reaction = input.reaction?.trim() || null
  const storedAsset = input.storedAsset ?? null
  const mediaAsset = storedAsset
    ? await createMediaAssetFromStoredStoryAsset({
        ownerUserId: input.actorId,
        purpose: "story_reply",
        storedAsset,
      })
    : null

  if ((input.kind === "reply" || input.kind === "comment") && !body && !storedAsset) {
    throw new Error("Enter a message before sending.")
  }

  if (input.kind === "reaction" && !reaction) {
    throw new Error("Choose a reaction before sending.")
  }

  const mediaModerationReason =
    mediaAsset &&
    (mediaAsset.scanStatus === "flagged" || mediaAsset.scanStatus === "failed")
      ? mediaAsset.scanReason ?? "Reply media was flagged by safety scanning."
      : null
  const contentModeration = await moderateUserContent({
    textParts: [body, reaction],
    media: storedAsset
      ? {
          assetKind: storedAsset.assetKind,
          contentType: storedAsset.contentType,
          byteSize: storedAsset.byteSize,
          durationMs: storedAsset.durationMs,
          mediaUrl: input.moderationMediaUrl ?? storedAsset.mediaUrl,
          thumbnailUrl: input.moderationThumbnailUrl ?? storedAsset.thumbnailUrl,
        }
      : null,
  })
  const moderation: ContentModerationResult = mediaModerationReason
    ? {
        action: "hold",
        provider: [contentModeration.provider, "local-media"].join("+"),
        reason: mediaModerationReason,
        categories: [
          ...contentModeration.categories,
          {
            key: "unsupported_media",
            confidence: 1,
            reason: mediaModerationReason,
            source: "local_media",
          },
        ],
        rawResult: contentModeration.rawResult,
        error: contentModeration.error,
      }
    : contentModeration
  const moderationStatus =
    moderation.action === "approve"
      ? "approved"
      : moderation.action === "reject"
        ? "rejected"
        : "flagged"
  const interactionId = `story-interaction-${randomUUID()}`

  if (mediaAsset) {
    await applyMediaModerationResult({
      mediaAssetId: mediaAsset.id,
      actorUserId: input.actorId,
      result: moderation,
    }).catch(() => undefined)
  }

  const [event] = await db
    .insert(storyInteractions)
    .values({
      id: interactionId,
      storyId: story.id,
      creatorId: story.creatorId,
      actorId: input.actorId,
      kind: input.kind,
      body,
      reaction,
      mediaUrl: storedAsset?.mediaUrl ?? null,
      mediaThumbnailUrl: storedAsset?.thumbnailUrl ?? null,
      mediaAssetKind: storedAsset?.assetKind ?? null,
      mediaAssetId: mediaAsset?.id ?? null,
      moderationStatus,
      moderationReason: moderation.reason,
    })
    .returning()

  await recordModerationCheck({
    targetKind: "interaction",
    targetId: interactionId,
    actorUserId: input.actorId,
    mediaAssetId: mediaAsset?.id,
    result: moderation,
  }).catch(() => undefined)

  return event
}

export async function listStoryInteractionsForCreator(input: {
  creatorId: string
  kinds?: StoryInteractionKind[]
  limit?: number
}): Promise<StoryInteractionEvent[]> {
  const db = getDb()
  const blockedPeerIds = await getBlockedPeerIds(input.creatorId)
  const kinds = input.kinds?.length ? input.kinds : undefined
  const filters = [
    eq(storyInteractions.creatorId, input.creatorId),
    eq(storyInteractions.moderationStatus, "approved"),
    kinds ? inArray(storyInteractions.kind, kinds) : undefined,
  ].filter(Boolean)

  const rows = await db
    .select({
      id: storyInteractions.id,
      storyId: storyInteractions.storyId,
      creatorId: storyInteractions.creatorId,
      actorId: storyInteractions.actorId,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
      storyAssetKind: stories.assetKind,
      storyMediaUrl: stories.mediaUrl,
      storyThumbnailUrl: stories.thumbnailUrl,
      kind: storyInteractions.kind,
      body: storyInteractions.body,
      reaction: storyInteractions.reaction,
      mediaUrl: storyInteractions.mediaUrl,
      mediaThumbnailUrl: storyInteractions.mediaThumbnailUrl,
      mediaAssetKind: storyInteractions.mediaAssetKind,
      createdAt: storyInteractions.createdAt,
    })
    .from(storyInteractions)
    .innerJoin(stories, eq(stories.id, storyInteractions.storyId))
    .innerJoin(users, eq(users.id, storyInteractions.actorId))
    .where(and(...filters))
    .orderBy(desc(storyInteractions.createdAt))
    .limit(input.limit ?? 50)

  return rows.flatMap((row) => {
    if (blockedPeerIds.has(row.actorId)) {
      return []
    }

    const event = mapEvent(row)

    return event ? [event] : []
  })
}

export async function listStoryInteractionsForActor(input: {
  actorId: string
  kinds?: StoryInteractionKind[]
  limit?: number
}): Promise<SentStoryInteractionEvent[]> {
  const db = getDb()
  const blockedPeerIds = await getBlockedPeerIds(input.actorId)
  const actorUsers = alias(users, "actor_users")
  const creatorUsers = alias(users, "creator_users")
  const kinds = input.kinds?.length ? input.kinds : undefined
  const filters = [
    eq(storyInteractions.actorId, input.actorId),
    eq(storyInteractions.moderationStatus, "approved"),
    kinds ? inArray(storyInteractions.kind, kinds) : undefined,
  ].filter(Boolean)

  const rows = await db
    .select({
      id: storyInteractions.id,
      storyId: storyInteractions.storyId,
      creatorId: storyInteractions.creatorId,
      actorId: storyInteractions.actorId,
      actorDisplayName: actorUsers.displayName,
      actorHandle: actorUsers.handle,
      actorAvatarUrl: actorUsers.avatarUrl,
      creatorDisplayName: creatorUsers.displayName,
      creatorHandle: creatorUsers.handle,
      creatorAvatarUrl: creatorUsers.avatarUrl,
      storyAssetKind: stories.assetKind,
      storyMediaUrl: stories.mediaUrl,
      storyThumbnailUrl: stories.thumbnailUrl,
      kind: storyInteractions.kind,
      body: storyInteractions.body,
      reaction: storyInteractions.reaction,
      mediaUrl: storyInteractions.mediaUrl,
      mediaThumbnailUrl: storyInteractions.mediaThumbnailUrl,
      mediaAssetKind: storyInteractions.mediaAssetKind,
      createdAt: storyInteractions.createdAt,
    })
    .from(storyInteractions)
    .innerJoin(stories, eq(stories.id, storyInteractions.storyId))
    .innerJoin(actorUsers, eq(actorUsers.id, storyInteractions.actorId))
    .innerJoin(creatorUsers, eq(creatorUsers.id, storyInteractions.creatorId))
    .where(and(...filters))
    .orderBy(desc(storyInteractions.createdAt))
    .limit(input.limit ?? 50)

  return rows.flatMap((row) => {
    if (blockedPeerIds.has(row.creatorId)) {
      return []
    }

    const event = mapSentEvent(row)

    return event ? [event] : []
  })
}
