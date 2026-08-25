import path from "node:path"

import { del, list } from "@vercel/blob"
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
} from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  mediaAssets,
  stories,
  storyInteractions,
  users,
} from "@/lib/db/schema"
import { getPrivateVercelBlobPathname } from "@/lib/story-media/access"
import {
  removeCloudflareStreamVideoByUid,
  removeDirectBlobStoryVideoPoster,
  removeStoryAsset,
} from "@/lib/story-storage"

type MediaAsset = typeof mediaAssets.$inferSelect

export type ExpiredStoryMediaCleanupCandidate = Pick<
  MediaAsset,
  | "id"
  | "storageProvider"
  | "storageKey"
  | "mediaUrl"
  | "thumbnailUrl"
  | "placeholderUrl"
  | "originalMediaUrl"
  | "originalThumbnailUrl"
  | "byteSize"
  | "originalByteSize"
  | "durationMs"
  | "originalStorageKey"
  | "pipelineVersion"
>

const cleanupScanMultiplier = 4
const maximumCleanupScan = 2_000

export async function getExpiredStoryMediaForCleanup(input: {
  now?: Date
  limit?: number
} = {}): Promise<ExpiredStoryMediaCleanupCandidate[]> {
  const now = input.now ?? new Date()
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500)
  const scanLimit = Math.min(limit * cleanupScanMultiplier, maximumCleanupScan)
  const db = getDb()

  const assets = await db
    .select({
      id: mediaAssets.id,
      storageProvider: mediaAssets.storageProvider,
      storageKey: mediaAssets.storageKey,
      mediaUrl: mediaAssets.mediaUrl,
      thumbnailUrl: mediaAssets.thumbnailUrl,
      placeholderUrl: mediaAssets.placeholderUrl,
      originalMediaUrl: mediaAssets.originalMediaUrl,
      originalThumbnailUrl: mediaAssets.originalThumbnailUrl,
      byteSize: mediaAssets.byteSize,
      originalByteSize: mediaAssets.originalByteSize,
      durationMs: mediaAssets.durationMs,
      originalStorageKey: mediaAssets.originalStorageKey,
      pipelineVersion: mediaAssets.pipelineVersion,
    })
    .from(mediaAssets)
    .where(
      and(
        isNull(mediaAssets.deletedAt),
        inArray(mediaAssets.purpose, ["story", "story_reply"]),
      ),
    )
    .orderBy(asc(mediaAssets.createdAt))
    .limit(scanLimit)

  if (assets.length === 0) {
    return []
  }

  const assetIds = assets.map((asset) => asset.id)
  const [storyReferences, replyReferences, avatarReferences] =
    await Promise.all([
      db
        .select({
          mediaAssetId: stories.mediaAssetId,
          expiresAt: stories.expiresAt,
          status: stories.status,
        })
        .from(stories)
        .where(inArray(stories.mediaAssetId, assetIds)),
      db
        .select({
          mediaAssetId: storyInteractions.mediaAssetId,
          expiresAt: stories.expiresAt,
          status: stories.status,
        })
        .from(storyInteractions)
        .innerJoin(stories, eq(storyInteractions.storyId, stories.id))
        .where(
          and(
            isNotNull(storyInteractions.mediaAssetId),
            inArray(storyInteractions.mediaAssetId, assetIds),
          ),
        ),
      db
        .select({ mediaAssetId: users.avatarAssetId })
        .from(users)
        .where(
          and(
            isNotNull(users.avatarAssetId),
            inArray(users.avatarAssetId, assetIds),
          ),
        ),
    ])

  const expiredAssetIds = new Set<string>()
  const protectedAssetIds = new Set(
    avatarReferences.flatMap((reference) =>
      reference.mediaAssetId ? [reference.mediaAssetId] : [],
    ),
  )

  for (const reference of [...storyReferences, ...replyReferences]) {
    if (!reference.mediaAssetId) {
      continue
    }

    if (reference.status === "removed" || reference.expiresAt <= now) {
      expiredAssetIds.add(reference.mediaAssetId)
    } else {
      protectedAssetIds.add(reference.mediaAssetId)
    }
  }

  return assets
    .filter(
      (asset) =>
        expiredAssetIds.has(asset.id) && !protectedAssetIds.has(asset.id),
    )
    .slice(0, limit)
}

export async function removeExpiredStoryMediaFromStorage(
  candidate: ExpiredStoryMediaCleanupCandidate,
) {
  if (candidate.storageProvider === "local") {
    return
  }

  if (candidate.storageProvider === "cloudflare-stream") {
    await Promise.all([
      removeCloudflareStreamVideoByUid(candidate.storageKey),
      removeDirectBlobStoryVideoPoster(candidate.storageKey),
    ])
  }

  if (
    candidate.storageProvider === "vercel-blob" &&
    candidate.pipelineVersion &&
    candidate.storageKey.startsWith(`media/${candidate.pipelineVersion}/`)
  ) {
    await removeVercelHlsPackage(candidate)
    return
  }

  const providerUrls = Array.from(
    new Set(
      [
        candidate.mediaUrl,
        candidate.thumbnailUrl,
        candidate.placeholderUrl,
        candidate.originalMediaUrl,
        candidate.originalThumbnailUrl,
      ].filter((value): value is string => Boolean(value)),
    ),
  )

  if (candidate.storageProvider === "cloudflare-stream") {
    const cloudflareUrls = new Set([
      candidate.mediaUrl,
      candidate.thumbnailUrl,
      candidate.placeholderUrl,
    ])
    await Promise.all(
      providerUrls
        .filter((url) => !cloudflareUrls.has(url))
        .map((url) => removeStoryAsset(url)),
    )
    return
  }

  await Promise.all(providerUrls.map((url) => removeStoryAsset(url)))
}

async function removeVercelHlsPackage(
  candidate: ExpiredStoryMediaCleanupCandidate,
) {
  const deliveryToken = process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN
  const privateToken = process.env.BLOB_READ_WRITE_TOKEN
  if (!deliveryToken || !privateToken) {
    throw new Error(
      "Both private and delivery Blob tokens are required for HLS cleanup.",
    )
  }

  const outputPrefix = path.posix.dirname(candidate.storageKey)
  const expectedPrefix = `media/${candidate.pipelineVersion}/`
  if (
    outputPrefix === "." ||
    !outputPrefix.startsWith(expectedPrefix) ||
    candidate.storageKey !== `${outputPrefix}/master.m3u8`
  ) {
    throw new Error("Refusing to delete an invalid HLS delivery prefix.")
  }

  let cursor: string | undefined
  const deliveryObjects: string[] = []
  do {
    const page = await list({
      prefix: `${outputPrefix}/`,
      cursor,
      limit: 1_000,
      token: deliveryToken,
    })
    deliveryObjects.push(...page.blobs.map((blob) => blob.url))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  for (let index = 0; index < deliveryObjects.length; index += 1_000) {
    await del(deliveryObjects.slice(index, index + 1_000), {
      token: deliveryToken,
    })
  }

  const privateObjects = Array.from(
    new Set(
      [
        candidate.originalStorageKey,
        candidate.originalMediaUrl
          ? getPrivateVercelBlobPathname(candidate.originalMediaUrl)
          : null,
        candidate.originalThumbnailUrl
          ? getPrivateVercelBlobPathname(candidate.originalThumbnailUrl)
          : null,
      ].filter((value): value is string => Boolean(value)),
    ),
  )
  if (privateObjects.length > 0) {
    await del(privateObjects, { token: privateToken })
  }
}

export async function markExpiredStoryMediaDeleted(
  candidate: ExpiredStoryMediaCleanupCandidate,
  now = new Date(),
) {
  const db = getDb()

  return db.transaction(async (tx) => {
    const deleted = await tx
      .update(mediaAssets)
      .set({
        deletedAt: now,
        processingStatus: "deleted",
        updatedAt: now,
      })
      .where(and(eq(mediaAssets.id, candidate.id), isNull(mediaAssets.deletedAt)))
      .returning({ id: mediaAssets.id })

    if (deleted.length === 0) {
      return false
    }

    await tx
      .update(stories)
      .set({ status: "expired" })
      .where(
        and(
          eq(stories.mediaAssetId, candidate.id),
          lte(stories.expiresAt, now),
          ne(stories.status, "removed"),
        ),
      )

    return true
  })
}
