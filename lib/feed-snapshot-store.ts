import { eq } from "drizzle-orm"
import { invalidateByTag } from "@vercel/functions"

import { getDb } from "@/lib/db"
import { follows } from "@/lib/db/schema"
import type { FeedData } from "@/lib/story-store"
import { hasRedisCache, redisCommand, redisPipeline } from "@/lib/upstash-redis"

const freshSnapshotTtlMs = 60 * 1000
const staleSnapshotTtlSeconds = 5 * 60

type CachedFeedSnapshot = {
  cachedAt: number
  payload: FeedData
}

function snapshotKey(viewerId: string) {
  return `mobile-feed:snapshot:v2:${viewerId}`
}

function serializeFeedData(feed: FeedData) {
  return JSON.parse(JSON.stringify(feed)) as FeedData
}

async function readSnapshot(viewerId: string) {
  if (!hasRedisCache()) {
    return null
  }

  const value = await redisCommand<string>(["GET", snapshotKey(viewerId)]).catch(
    () => null,
  )
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as CachedFeedSnapshot
  } catch {
    await redisCommand(["DEL", snapshotKey(viewerId)]).catch(() => undefined)
    return null
  }
}

export async function readMobileFeedSnapshot(viewerId: string) {
  const snapshot = await readSnapshot(viewerId)
  if (!snapshot) {
    return null
  }

  const staleAt =
    snapshot.cachedAt + staleSnapshotTtlSeconds * 1000
  return staleAt > Date.now() ? snapshot.payload : null
}

export async function readFeedCacheBatch(viewerId: string, timelineLimit: number, beforeScore?: number | null) {
  if (!hasRedisCache()) return { snapshot: null, timelineIds: null as string[] | null }
  const snapKey = snapshotKey(viewerId)
  const tlKey = `mobile-feed:timeline:v1:${viewerId}`
  const res = await redisPipeline([
    ["GET", snapKey],
    ["ZREVRANGEBYSCORE", tlKey, beforeScore ? String(beforeScore) : "+inf", "-inf", "LIMIT", 0, Math.max(1, Math.min(timelineLimit, 500))],
  ]).catch(() => null) as Array<string | string[] | null> | null
  const snapRaw = (res?.[0] ?? null) as string | null
  let snapshot: CachedFeedSnapshot | null = null
  if (snapRaw) { try { snapshot = JSON.parse(snapRaw) as CachedFeedSnapshot } catch { snapshot = null } }
  const tlIds = (res?.[1] ?? null) as string[] | null
  return { snapshot, timelineIds: tlIds }
}

export async function readFreshMobileFeedSnapshot(viewerId: string) {
  const snapshot = await readSnapshot(viewerId)
  if (!snapshot || snapshot.cachedAt + freshSnapshotTtlMs <= Date.now()) {
    return null
  }

  return snapshot.payload
}

export async function writeMobileFeedSnapshot(viewerId: string, feed: FeedData) {
  const snapshot: CachedFeedSnapshot = {
    cachedAt: Date.now(),
    payload: serializeFeedData(feed),
  }

  if (!hasRedisCache()) {
    return
  }

  await redisCommand([
    "SET",
    snapshotKey(viewerId),
    JSON.stringify(snapshot),
    "EX",
    staleSnapshotTtlSeconds,
  ])
}

export async function invalidateMobileFeedSnapshots(viewerIds: string[]) {
  const uniqueViewerIds = [...new Set(viewerIds.filter(Boolean))]
  if (uniqueViewerIds.length === 0) {
    return
  }

  if (hasRedisCache()) {
    await redisCommand([
      "DEL",
      ...uniqueViewerIds.map(snapshotKey),
    ]).catch(() => undefined)
  }

  for (let index = 0; index < uniqueViewerIds.length; index += 128) {
    try {
      await invalidateByTag(
        uniqueViewerIds
          .slice(index, index + 128)
          .map((viewerId) => `feed:${viewerId}`),
      )
    } catch {
      // Local development and non-Vercel test runtimes have no CDN context.
    }
  }
}

export async function invalidateMobileFeedSnapshot(viewerId: string) {
  await invalidateMobileFeedSnapshots([viewerId])
}

export async function invalidateMobileFeedSnapshotsForCreator(creatorId: string) {
  const followerRows = await getDb()
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(eq(follows.followeeId, creatorId))

  await invalidateMobileFeedSnapshots([
    creatorId,
    ...followerRows.map((row) => row.followerId),
  ])
}
