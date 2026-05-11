import { randomUUID } from "node:crypto"

import { and, eq, inArray, isNull, lt, or } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  mediaAssets,
  mediaAuditEvents,
  stories,
  storyInteractions,
  users,
} from "@/lib/db/schema"
import {
  fetchCloudflareStreamVideoStatus,
  removeStoryAsset,
  type StoredStoryAsset,
} from "@/lib/story-storage"
import {
  removeProfileAvatar,
  type StoredProfileAvatar,
} from "@/lib/profile-avatar-storage"

type MediaPurpose = "story" | "story_reply" | "avatar"
type MediaAssetStatus = "processing" | "ready" | "flagged" | "rejected" | "deleted" | "error"
type MediaScanStatus = "pending" | "passed" | "flagged" | "failed" | "skipped"

type ScanResult = {
  scanStatus: MediaScanStatus
  scanReason: string | null
}

type CreatedMediaAsset = {
  id: string
  processingStatus: MediaAssetStatus
  scanStatus: MediaScanStatus
  scanReason: string | null
}

function metadata(value: unknown) {
  return JSON.stringify(value)
}

async function auditMediaAsset(input: {
  mediaAssetId: string
  actorUserId?: string | null
  eventType: string
  message?: string | null
  metadata?: unknown
}) {
  await getDb().insert(mediaAuditEvents).values({
    id: `media-audit-${randomUUID()}`,
    mediaAssetId: input.mediaAssetId,
    actorUserId: input.actorUserId ?? null,
    eventType: input.eventType,
    message: input.message ?? null,
    metadata: input.metadata === undefined ? null : metadata(input.metadata),
  })
}

function scanStoredMedia(input: {
  assetKind: "image" | "video"
  contentType: string
  byteSize: number
  width: number | null
  height: number | null
  durationMs: number | null
}): ScanResult {
  if (input.byteSize <= 0) {
    return {
      scanStatus: "failed",
      scanReason: "Media upload has no readable bytes.",
    }
  }

  if (input.assetKind === "image") {
    if (!input.contentType.startsWith("image/")) {
      return {
        scanStatus: "flagged",
        scanReason: "Image upload has an unexpected content type.",
      }
    }

    const megapixels =
      input.width && input.height ? (input.width * input.height) / 1_000_000 : 0

    if (megapixels > 80) {
      return {
        scanStatus: "flagged",
        scanReason: "Image dimensions exceed the production safety limit.",
      }
    }
  }

  if (input.assetKind === "video") {
    if (!input.contentType.startsWith("video/")) {
      return {
        scanStatus: "flagged",
        scanReason: "Video upload has an unexpected content type.",
      }
    }

    if (input.durationMs && input.durationMs > 120_000) {
      return {
        scanStatus: "flagged",
        scanReason: "Video duration exceeds the production safety limit.",
      }
    }
  }

  return {
    scanStatus: "passed",
    scanReason: null,
  }
}

function storyAssetProcessingStatus(storedAsset: StoredStoryAsset): MediaAssetStatus {
  return storedAsset.processingStatus === "processing" ? "processing" : "ready"
}

export async function createMediaAssetFromStoredStoryAsset(input: {
  ownerUserId: string
  purpose: Extract<MediaPurpose, "story" | "story_reply">
  storedAsset: StoredStoryAsset
}): Promise<CreatedMediaAsset> {
  const db = getDb()
  const scan = scanStoredMedia(input.storedAsset)
  const processingStatus =
    scan.scanStatus === "flagged" || scan.scanStatus === "failed"
      ? "flagged"
      : storyAssetProcessingStatus(input.storedAsset)
  const now = new Date()
  const id = `media-${randomUUID()}`

  await db.insert(mediaAssets).values({
    id,
    ownerUserId: input.ownerUserId,
    purpose: input.purpose,
    assetKind: input.storedAsset.assetKind,
    storageProvider: input.storedAsset.storageProvider,
    storageKey: input.storedAsset.storageKey,
    mediaUrl: input.storedAsset.mediaUrl,
    thumbnailUrl: input.storedAsset.thumbnailUrl,
    contentType: input.storedAsset.contentType,
    byteSize: input.storedAsset.byteSize,
    checksum: input.storedAsset.checksum,
    width: input.storedAsset.width,
    height: input.storedAsset.height,
    durationMs: input.storedAsset.durationMs,
    processingStatus,
    scanStatus: scan.scanStatus,
    scanReason: scan.scanReason,
    providerStatus: input.storedAsset.processingStatus,
    readyAt: processingStatus === "ready" ? now : null,
    createdAt: now,
    updatedAt: now,
  })

  await auditMediaAsset({
    mediaAssetId: id,
    actorUserId: input.ownerUserId,
    eventType: "uploaded",
    message: `${input.purpose} media uploaded.`,
    metadata: {
      assetKind: input.storedAsset.assetKind,
      contentType: input.storedAsset.contentType,
      byteSize: input.storedAsset.byteSize,
      storageProvider: input.storedAsset.storageProvider,
      storageKey: input.storedAsset.storageKey,
    },
  })

  await auditMediaAsset({
    mediaAssetId: id,
    actorUserId: input.ownerUserId,
    eventType: "scanned",
    message: scan.scanReason ?? "Media passed structural scan.",
    metadata: {
      scanStatus: scan.scanStatus,
    },
  })

  return {
    id,
    processingStatus,
    scanStatus: scan.scanStatus,
    scanReason: scan.scanReason,
  }
}

export async function createMediaAssetFromStoredProfileAvatar(input: {
  ownerUserId: string
  storedAvatar: StoredProfileAvatar
}): Promise<CreatedMediaAsset> {
  const db = getDb()
  const scan = scanStoredMedia({
    assetKind: "image",
    contentType: input.storedAvatar.contentType,
    byteSize: input.storedAvatar.byteSize,
    width: null,
    height: null,
    durationMs: null,
  })
  const processingStatus =
    scan.scanStatus === "flagged" || scan.scanStatus === "failed" ? "flagged" : "ready"
  const now = new Date()
  const id = `media-${randomUUID()}`

  await db.insert(mediaAssets).values({
    id,
    ownerUserId: input.ownerUserId,
    purpose: "avatar",
    assetKind: "image",
    storageProvider: input.storedAvatar.storageProvider,
    storageKey: input.storedAvatar.storageKey,
    mediaUrl: input.storedAvatar.avatarUrl,
    thumbnailUrl: input.storedAvatar.avatarUrl,
    contentType: input.storedAvatar.contentType,
    byteSize: input.storedAvatar.byteSize,
    checksum: input.storedAvatar.checksum,
    processingStatus,
    scanStatus: scan.scanStatus,
    scanReason: scan.scanReason,
    readyAt: processingStatus === "ready" ? now : null,
    createdAt: now,
    updatedAt: now,
  })

  await auditMediaAsset({
    mediaAssetId: id,
    actorUserId: input.ownerUserId,
    eventType: "uploaded",
    message: "Avatar uploaded.",
    metadata: {
      contentType: input.storedAvatar.contentType,
      byteSize: input.storedAvatar.byteSize,
      storageProvider: input.storedAvatar.storageProvider,
      storageKey: input.storedAvatar.storageKey,
    },
  })

  await auditMediaAsset({
    mediaAssetId: id,
    actorUserId: input.ownerUserId,
    eventType: "scanned",
    message: scan.scanReason ?? "Avatar passed structural scan.",
    metadata: {
      scanStatus: scan.scanStatus,
    },
  })

  return {
    id,
    processingStatus,
    scanStatus: scan.scanStatus,
    scanReason: scan.scanReason,
  }
}

export async function markMediaAssetDeleted(input: {
  mediaAssetId: string
  actorUserId?: string | null
  reason: string
}) {
  const now = new Date()

  await getDb()
    .update(mediaAssets)
    .set({
      processingStatus: "deleted",
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, input.mediaAssetId))

  await auditMediaAsset({
    mediaAssetId: input.mediaAssetId,
    actorUserId: input.actorUserId,
    eventType: "deleted",
    message: input.reason,
  })
}

export async function markMediaAssetRejected(input: {
  mediaAssetId: string
  actorUserId?: string | null
  reason: string
}) {
  const now = new Date()

  await getDb()
    .update(mediaAssets)
    .set({
      processingStatus: "rejected",
      scanStatus: "flagged",
      scanReason: input.reason,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, input.mediaAssetId))

  await auditMediaAsset({
    mediaAssetId: input.mediaAssetId,
    actorUserId: input.actorUserId,
    eventType: "rejected",
    message: input.reason,
  })
}

export async function markMediaAssetDeleteFailed(input: {
  mediaAssetId: string
  actorUserId?: string | null
  reason: string
}) {
  const now = new Date()

  await getDb()
    .update(mediaAssets)
    .set({
      processingStatus: "error",
      providerError: input.reason,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, input.mediaAssetId))

  await auditMediaAsset({
    mediaAssetId: input.mediaAssetId,
    actorUserId: input.actorUserId,
    eventType: "delete_failed",
    message: input.reason,
  })
}

async function removeStoredMedia(asset: typeof mediaAssets.$inferSelect) {
  if (asset.purpose === "avatar") {
    await removeProfileAvatar(asset.mediaUrl)
    return
  }

  await removeStoryAsset(asset.mediaUrl)
}

export async function cleanupExpiredStoryMedia(input: { limit?: number } = {}) {
  const limit = input.limit ?? 100
  const db = getDb()
  const expiredRows = await db
    .select({
      storyId: stories.id,
      mediaAssetId: stories.mediaAssetId,
      mediaUrl: stories.mediaUrl,
    })
    .from(stories)
    .innerJoin(mediaAssets, eq(mediaAssets.id, stories.mediaAssetId))
    .where(
      and(
        or(eq(stories.status, "live"), eq(stories.status, "expired")),
        lt(stories.expiresAt, new Date()),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .limit(limit)

  for (const row of expiredRows) {
    await db
      .update(stories)
      .set({
        status: "expired",
      })
      .where(eq(stories.id, row.storyId))

    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, row.mediaAssetId))
      .limit(1)

    if (asset && !asset.deletedAt) {
      try {
        await removeStoredMedia(asset)
        await markMediaAssetDeleted({
          mediaAssetId: row.mediaAssetId,
          reason: "Story expired and media was removed from primary storage.",
        })
      } catch (error) {
        await markMediaAssetDeleteFailed({
          mediaAssetId: row.mediaAssetId,
          reason:
            error instanceof Error
              ? error.message
              : "Could not remove expired story media from primary storage.",
        })
      }
    }
  }

  return { expiredStories: expiredRows.length }
}

export async function cleanupOrphanedMediaAssets(input: { limit?: number } = {}) {
  const limit = input.limit ?? 100
  const db = getDb()
  const candidateRows = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        isNull(mediaAssets.deletedAt),
        lt(mediaAssets.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    )
    .limit(limit)

  let deletedOrphans = 0

  for (const asset of candidateRows) {
    const [storyReference, interactionReference, avatarReference] = await Promise.all([
      db
        .select({ id: stories.id })
        .from(stories)
        .where(eq(stories.mediaAssetId, asset.id))
        .limit(1),
      db
        .select({ id: storyInteractions.id })
        .from(storyInteractions)
        .where(eq(storyInteractions.mediaAssetId, asset.id))
        .limit(1),
      db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.avatarAssetId, asset.id))
        .limit(1),
    ])

    if (storyReference[0] || interactionReference[0] || avatarReference[0]) {
      continue
    }

    await removeStoredMedia(asset).catch(() => undefined)
    await markMediaAssetDeleted({
      mediaAssetId: asset.id,
      reason: "Unreferenced media asset was removed by lifecycle cleanup.",
    })
    deletedOrphans += 1
  }

  return { deletedOrphans }
}

async function syncCloudflareStreamAsset(asset: typeof mediaAssets.$inferSelect) {
  const db = getDb()
  const status = await fetchCloudflareStreamVideoStatus(asset.storageKey).catch(
    (error) => ({
      readyToStream: false,
      readyToStreamAt: null,
      state: "error",
      errorReasonText:
        error instanceof Error ? error.message : "Could not check Stream status.",
      errorReasonCode: null,
    }),
  )
  const now = new Date()

  if (status.readyToStream && status.state === "ready") {
    await db
      .update(mediaAssets)
      .set({
        processingStatus: "ready",
        providerStatus: status.state,
        providerError: null,
        lastCheckedAt: now,
        readyAt: status.readyToStreamAt ?? now,
        updatedAt: now,
      })
      .where(eq(mediaAssets.id, asset.id))

    await db
      .update(stories)
      .set({
        processingStatus: "ready",
        status: "live",
      })
      .where(
        and(
          eq(stories.mediaAssetId, asset.id),
          eq(stories.status, "processing"),
          eq(stories.moderationStatus, "approved"),
        ),
      )

    await auditMediaAsset({
      mediaAssetId: asset.id,
      eventType: "stream_ready",
      message: "Cloudflare Stream marked the video ready.",
      metadata: status,
    })

    return "ready" as const
  }

  if (status.state === "error") {
    await db
      .update(mediaAssets)
      .set({
        processingStatus: "error",
        providerStatus: status.state,
        providerError: status.errorReasonText ?? "Cloudflare Stream processing failed.",
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(mediaAssets.id, asset.id))

    await db
      .update(stories)
      .set({
        moderationStatus: "flagged",
        moderationReason:
          status.errorReasonText ?? "Cloudflare Stream could not process this video.",
      })
      .where(eq(stories.mediaAssetId, asset.id))

    await auditMediaAsset({
      mediaAssetId: asset.id,
      eventType: "stream_error",
      message: status.errorReasonText ?? "Cloudflare Stream processing failed.",
      metadata: status,
    })

    return "error" as const
  }

  await db
    .update(mediaAssets)
    .set({
      providerStatus: status.state,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, asset.id))

  return "processing" as const
}

export async function syncCloudflareStreamAssetByUid(uid: string) {
  const [asset] = await getDb()
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.storageProvider, "cloudflare-stream"),
        eq(mediaAssets.storageKey, uid),
      ),
    )
    .limit(1)

  if (!asset) {
    return { found: false, result: null }
  }

  return {
    found: true,
    result: await syncCloudflareStreamAsset(asset),
  }
}

export async function syncPendingCloudflareStreamAssets(input: { limit?: number } = {}) {
  const limit = input.limit ?? 50
  const pendingAssets = await getDb()
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.storageProvider, "cloudflare-stream"),
        inArray(mediaAssets.processingStatus, ["processing", "error"]),
      ),
    )
    .limit(limit)
  let ready = 0
  let errored = 0

  for (const asset of pendingAssets) {
    const result = await syncCloudflareStreamAsset(asset)

    if (result === "ready") {
      ready += 1
      continue
    }

    if (result === "error") {
      errored += 1
    }
  }

  return { checked: pendingAssets.length, ready, errored }
}

export async function runMediaLifecycleMaintenance() {
  const [expired, orphans, stream] = await Promise.all([
    cleanupExpiredStoryMedia(),
    cleanupOrphanedMediaAssets(),
    syncPendingCloudflareStreamAssets(),
  ])

  return { expired, orphans, stream }
}
