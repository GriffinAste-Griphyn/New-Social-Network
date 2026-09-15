// Uses only disposable, randomly named keys; never targets a real viewer.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
const redisModule = await import("../lib/upstash-redis.ts")
const { hasRedisCache, redisCommand } = redisModule.default ?? redisModule
const snapshotModule = await import("../lib/feed-snapshot-store.ts")
const { readFeedSnapshot, readFeedSnapshotRevision, writeMobileFeedSnapshot, invalidateMobileFeedSnapshots } = snapshotModule.default ?? snapshotModule
assert(hasRedisCache(), "Redis configuration is required for this integration check")
const viewer = `feed-cache-probe-${randomUUID()}`
const feed = { followingTimelineStories: [], myStory: { items: [] } }
try {
  const before = await readFeedSnapshotRevision(viewer)
  assert.equal(before, "")
  await writeMobileFeedSnapshot(viewer, feed, 21, before)
  assert(await readFeedSnapshot(viewer))
  await invalidateMobileFeedSnapshots([viewer])
  const after = await readFeedSnapshotRevision(viewer)
  assert(after && after !== before)
  await writeMobileFeedSnapshot(viewer, feed, 21, before)
  assert.equal(await readFeedSnapshot(viewer), null, "An invalidated rebuild resurrected stale data")
  await writeMobileFeedSnapshot(viewer, feed, 21, after)
  assert(await readFeedSnapshot(viewer))
  console.log("Redis integration passed: invalidation rejected the old rebuild and accepted the current revision.")
} finally {
  await redisCommand(["DEL", `mobile-feed:snapshot:v3:${viewer}`, `mobile-feed:revision:v3:${viewer}`])
}
