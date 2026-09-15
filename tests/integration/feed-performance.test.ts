import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { inArray, or } from "drizzle-orm"
import { writeFile } from "node:fs/promises"
import { follows, stories, users, userBlocks, mediaAssets } from "@/lib/db/schema"

const state = vi.hoisted(() => ({ queries: [] as string[] }))
vi.mock("@/lib/db", async () => {
  const { default: postgres } = await import("postgres")
  const { drizzle } = await import("drizzle-orm/postgres-js")
  const url = process.env.FEED_TEST_DATABASE_URL ?? "postgresql://ubeye_test@127.0.0.1:55448/postgres"
  if (new URL(url).hostname !== "127.0.0.1") throw new Error("Feed integration fixtures require a local isolated database")
  const client = postgres(url, { max: 2 })
  const db = drizzle(client, { logger: { logQuery(query: string) { state.queries.push(query) } } })
  return { getDb: () => db, testClient: client }
})
vi.mock("@/lib/upstash-redis", () => ({ hasRedisCache: () => false, redisCommand: vi.fn(), redisPipeline: vi.fn() }))

import { getDb } from "@/lib/db"
import { followingCreatorPageQuery } from "@/lib/feed-pagination"
import { getFeedData, getFollowingTimelinePage, getStoryStacksForStories } from "@/lib/story-store"

describe.skipIf(!process.env.FEED_TEST_DATABASE_URL)("feed performance on PostgreSQL", () => {
  const prefix = `feed448-${randomUUID()}`
  const viewer = `${prefix}-viewer`
  const creators = Array.from({ length: 60 }, (_, i) => `${prefix}-${i}`)
  const userIds = [viewer, ...creators]
  const latest = new Map<string, string>()
  const now = new Date()
  const expires = new Date(now.getTime() + 3_600_000)
  const storyRows = creators.flatMap((creatorId, index) => Array.from({ length: index === 0 ? 100 : 5 }, (_, part) => {
    const id = randomUUID()
    if (part === 0) latest.set(creatorId, id)
    return { id, mediaAssetId: id, creatorId, assetKind: "image" as const, mediaUrl: "/api/story-media/test/fixture.jpg",
      thumbnailUrl: "/api/story-media/test/thumb.jpg", storageProvider: "cloudflare-r2" as const, storageKey: id,
      status: "live" as const, moderationStatus: "approved" as const,
      createdAt: new Date(now.getTime() - part * 1_000), expiresAt: expires }
  }))
  beforeAll(async () => {
    await getDb().insert(users).values(userIds.map((id, i) => ({ id, email: `${id}@example.invalid`, passwordHash: "fixture-only", displayName: "Fixture", handle: `f${prefix.slice(8, 16)}${i}` })))
    await getDb().insert(follows).values(creators.map(id => ({ followerId: viewer, followeeId: id })))
    for (let offset = 0; offset < storyRows.length; offset += 100) {
      const batch = storyRows.slice(offset, offset + 100)
      await getDb().insert(mediaAssets).values(batch.map(row => ({ id: row.id, ownerUserId: row.creatorId, purpose: "story" as const,
        assetKind: "image" as const, storageProvider: "cloudflare-r2" as const, storageKey: row.id, mediaUrl: row.mediaUrl,
        contentType: "image/jpeg", byteSize: 100, checksum: "fixture", processingStatus: "ready" as const })))
      await getDb().insert(stories).values(batch)
    }
    await getDb().insert(userBlocks).values([{ blockerId: viewer, blockedId: creators[58] }, { blockerId: creators[59], blockedId: viewer }])
  })
  afterAll(async () => {
    await getDb().delete(stories).where(inArray(stories.creatorId, userIds))
    await getDb().delete(mediaAssets).where(inArray(mediaAssets.ownerUserId, userIds))
    await getDb().delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followeeId, userIds)))
    await getDb().delete(userBlocks).where(or(inArray(userBlocks.blockerId, userIds), inArray(userBlocks.blockedId, userIds)))
    await getDb().delete(users).where(inArray(users.id, userIds))
    const { testClient } = await import("@/lib/db") as unknown as { testClient: { end(): Promise<void> } }
    await testClient.end()
  })

  it("fills creator pages despite 100 posts by one creator, tied timestamps and blocks in either direction", async () => {
    const ids: string[] = []
    let cursor: { createdAt: Date; id: string } | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const page = await getFollowingTimelinePage(viewer, { timelineCursor: cursor, timelineLimit: 21 })
      const visible = page.slice(0, 20)
      ids.push(...visible.map(row => row.id))
      if (page.length <= 20) break
      expect(visible).toHaveLength(20)
      const last = visible[visible.length - 1]
      cursor = { createdAt: new Date(last.lastUploadedAt!), id: last.id }
    }
    expect(ids).toHaveLength(58)
    expect(new Set(ids).size).toBe(58)
    expect(new Set(ids)).toEqual(new Set(creators.slice(0, 58).map(id => latest.get(id)!)))
  })

  it("supports a full 50-creator page with the 51st lookahead row", async () => {
    expect(await getFollowingTimelinePage(viewer, { timelineLimit: 51 })).toHaveLength(51)
  })

  it("hydrates multiple stacks in a constant number of queries and excludes blocked creators", async () => {
    const ids = [0, 1, 2, 58].map(index => latest.get(creators[index])!)
    state.queries.length = 0
    const stacks = await getStoryStacksForStories(ids, viewer)
    expect(stacks.size).toBe(3)
    expect(stacks.get(ids[0])?.items).toHaveLength(100)
    expect(stacks.has(ids[3])).toBe(false)
    expect(state.queries.length).toBeLessThanOrEqual(4)
  })

  it("coalesces concurrent rebuilds for the same viewer and page shape", async () => {
    const [first, second] = await Promise.all([
      getFeedData(viewer, { useSnapshot: false, timelineLimit: 21 }),
      getFeedData(viewer, { useSnapshot: false, timelineLimit: 21 }),
    ])
    expect(first).toBe(second)
    expect(first.followingTimelineStories).toHaveLength(21)
  })

  it("records the actual query plan without production access", async () => {
    const { testClient } = await import("@/lib/db") as unknown as { testClient: { unsafe(query: string, values: unknown[]): Promise<unknown> } }
    const query = followingCreatorPageQuery(viewer, new Set(creators.slice(58)), null, 21).toSQL()
    const plan = await testClient.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`, query.params)
    expect(JSON.stringify(plan)).toContain("Execution Time")
    if (process.env.FEED_TEST_PLAN_OUTPUT) await writeFile(process.env.FEED_TEST_PLAN_OUTPUT, JSON.stringify(plan, null, 2))
  })
})
