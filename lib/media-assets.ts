import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { mediaAssets, mediaAuditEvents } from "@/lib/db/schema"
import type { StoredProfileAvatar } from "@/lib/profile-avatar-storage"
import type { StoredStoryAsset } from "@/lib/story-storage"
import type { ContentModerationResult } from "@/lib/safety/policy"

type MediaScanStatus = "pending" | "passed" | "flagged" | "failed" | "skipped"

type CreatedMediaAsset = {
  id: string
  processingStatus: "processing" | "ready" | "flagged" | "rejected" | "deleted" | "error"
  scanStatus: MediaScanStatus
  scanReason: string | null
}

function scanStoredMedia(input: {
  assetKind: "image" | "video"
  contentType: string
  byteSize: number
  width: number | null
  height: number | null
  durationMs: number | null
}) {
  if (input.byteSize <= 0) {
    return {
      scanStatus: "failed" as const,
      scanReason: "Media upload has no readable bytes.",
    }
  }

  if (input.assetKind === "image" && !input.contentType.startsWith("image/")) {
    return {
      scanStatus: "flagged" as const,
      scanReason: "Image upload has an unexpected content type.",
    }
  }

  if (input.assetKind === "video" && !input.contentType.startsWith("video/")) {
    return {
      scanStatus: "flagged" as const,
      scanReason: "Video upload has an unexpected content type.",
    }
  }

  if (input.assetKind === "video" && input.durationMs && input.durationMs > 120_000) {
    return {
      scanStatus: "flagged" as const,
      scanReason: "Video duration exceeds the production safety limit.",
    }
  }

  return {
    scanStatus: "passed" as const,
    scanReason: null,
  }
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
    metadata: input.metadata === undefined ? null : JSON.stringify(input.metadata),
  })
}

export async function createMediaAssetFromStoredStoryAsset(input: {
  ownerUserId: string
  purpose: "story" | "story_reply"
  storedAsset: StoredStoryAsset
}): Promise<CreatedMediaAsset> {
  const scan = scanStoredMedia(input.storedAsset)
  const processingStatus =
    scan.scanStatus === "flagged" || scan.scanStatus === "failed"
      ? "flagged"
      : input.storedAsset.processingStatus === "processing"
        ? "processing"
        : "ready"
  const now = new Date()
  const id = `media-${randomUUID()}`

  await getDb().insert(mediaAssets).values({
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
    metadata: { scanStatus: scan.scanStatus },
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
  const scan = scanStoredMedia({
    assetKind: "image",
    contentType: input.storedAvatar.contentType,
    byteSize: input.storedAvatar.byteSize,
    width: 512,
    height: 512,
    durationMs: null,
  })
  const processingStatus =
    scan.scanStatus === "flagged" || scan.scanStatus === "failed" ? "flagged" : "ready"
  const now = new Date()
  const id = `media-${randomUUID()}`

  await getDb().insert(mediaAssets).values({
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
    width: 512,
    height: 512,
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
    metadata: { scanStatus: scan.scanStatus },
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

export async function applyMediaModerationResult(input: {
  mediaAssetId: string
  actorUserId?: string | null
  result: ContentModerationResult
}) {
  const now = new Date()
  const scanStatus =
    input.result.action === "approve"
      ? "passed"
      : input.result.action === "reject"
        ? "failed"
        : "flagged"
  const processingStatus =
    input.result.action === "reject"
      ? "rejected"
      : input.result.action === "hold"
        ? "flagged"
        : undefined

  await getDb()
    .update(mediaAssets)
    .set({
      scanStatus,
      scanReason: input.result.reason,
      ...(processingStatus ? { processingStatus } : {}),
      providerStatus: input.result.provider,
      providerError: input.result.error ?? null,
      lastCheckedAt: now,
      readyAt: input.result.action === "approve" ? now : null,
      updatedAt: now,
    })
    .where(eq(mediaAssets.id, input.mediaAssetId))

  await auditMediaAsset({
    mediaAssetId: input.mediaAssetId,
    actorUserId: input.actorUserId,
    eventType: "content_moderated",
    message: input.result.reason ?? "Media passed content moderation.",
    metadata: {
      action: input.result.action,
      provider: input.result.provider,
      categories: input.result.categories,
      error: input.result.error ?? null,
    },
  })
}
