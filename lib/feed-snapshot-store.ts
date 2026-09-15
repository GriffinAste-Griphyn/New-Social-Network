import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { invalidateByTag } from "@vercel/functions"

import { getDb } from "@/lib/db"
import { follows } from "@/lib/db/schema"
import type { FeedData } from "@/lib/story-store"
import { hasRedisCache, redisCommand } from "@/lib/upstash-redis"

const freshSnapshotTtlMs = 60 * 1000
const staleSnapshotTtlSeconds = 5 * 60

export type CachedFeedSnapshot = {
  timelineLimit: number
  cachedAt: number
  payload: FeedData
}

function snapshotKey(viewerId: string) {
  return `mobile-feed:snapshot:v3:${viewerId}`
}

function revisionKey(viewerId: string) { return `mobile-feed:revision:v3:${viewerId}` }

// null means Redis is unavailable: serve relational data but do not cache it.
export async function readFeedSnapshotRevision(viewerId: string): Promise<string | null> {
  if (!hasRedisCache()) return null
  try { return await redisCommand<string>(["GET", revisionKey(viewerId)]) ?? "" }
  catch { return null }
}

export async function readFeedSnapshot(viewerId: string) {
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

export function usableFeedSnapshot(snapshot: CachedFeedSnapshot | null, timelineLimit = 21, stale = false) {
  if (!snapshot || !snapshot.payload || snapshot.timelineLimit !== timelineLimit ||
      !Number.isFinite(snapshot.cachedAt) || snapshot.cachedAt > Date.now() ||
      snapshot.cachedAt + (stale ? staleSnapshotTtlSeconds * 1000 : freshSnapshotTtlMs) <= Date.now()) return null
  if (snapshot.payload.snapshotExpiresAt && Date.parse(snapshot.payload.snapshotExpiresAt) <= Date.now()) return null
  return snapshot.payload
}

export async function writeMobileFeedSnapshot(viewerId: string, feed: FeedData, timelineLimit: number, expectedRevision: string | null) {
  const snapshot: CachedFeedSnapshot = {
    timelineLimit,
    cachedAt: Date.now(),
    payload: feed,
  }

  if (!hasRedisCache() || expectedRevision === null) return
  // Atomically refuse to resurrect a snapshot invalidated during the rebuild.
  await redisCommand([
    "EVAL",
    "if (redis.call('GET', KEYS[2]) or '') ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1",
    2, snapshotKey(viewerId), revisionKey(viewerId), expectedRevision,
    JSON.stringify(snapshot), staleSnapshotTtlSeconds,
  ])
}

export async function invalidateMobileFeedSnapshots(viewerIds: string[]) {
  const uniqueViewerIds = [...new Set(viewerIds.filter(Boolean))]
  if (uniqueViewerIds.length === 0) {
    return
  }

  if (hasRedisCache()) {
    await redisCommand([
      "EVAL",
      "for i = 1, #KEYS, 2 do redis.call('SET', KEYS[i + 1], ARGV[1], 'EX', 600); redis.call('DEL', KEYS[i]); end; return 1",
      uniqueViewerIds.length * 2,
      ...uniqueViewerIds.flatMap(id => [snapshotKey(id), revisionKey(id)]), randomUUID(),
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
