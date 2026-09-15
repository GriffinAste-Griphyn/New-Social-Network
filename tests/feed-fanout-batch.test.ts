import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getDb } from "@/lib/db"
import { redisPipeline } from "@/lib/upstash-redis"
import { fanoutStoryFollowerBatch } from "@/lib/feed-timeline-store"
vi.mock("@/lib/feed-snapshot-store", () => ({ invalidateMobileFeedSnapshots: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
vi.mock("@/lib/upstash-redis", () => ({ redisCommand: vi.fn(), redisPipeline: vi.fn() }))
const where = vi.fn(), limit = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getDb).mockReturnValue({ select: () => ({ from: () => ({ where }) }) } as never)
  where.mockReturnValue({ orderBy: () => ({ limit }) })
  vi.mocked(redisPipeline).mockResolvedValue([])
})
describe("bounded follower fanout", () => {
  it("advances a full page with a stable follower cursor and includes the creator once", async () => {
    limit.mockResolvedValue(Array.from({ length: 250 }, (_, i) => ({ followerId: `f-${String(i).padStart(4, "0")}` })))
    const result = await fanoutStoryFollowerBatch({ creatorId: "owner", storyId: "s", createdAt: new Date(), cursor: null })
    expect(limit).toHaveBeenCalledWith(250)
    expect(result).toEqual({ viewerCount: 251, nextCursor: "f-0249" })
    expect(vi.mocked(redisPipeline).mock.calls[0][0]).toHaveLength(753)
  })
  it("uses keyset pagination and stops at the final page", async () => {
    limit.mockResolvedValue([{ followerId: "f-0250" }])
    const result = await fanoutStoryFollowerBatch({ creatorId: "owner", storyId: "s", createdAt: new Date(), cursor: "f-0249" })
    expect(result).toEqual({ viewerCount: 1, nextCursor: null })
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0])
    expect(query.sql).toContain('"follows"."follower_id" >')
    expect(query.params).toContain("f-0249")
    expect(vi.mocked(redisPipeline).mock.calls[0][0]).toHaveLength(3)
  })
  it("fails a page on Redis errors so its cursor is not advanced", async () => {
    limit.mockResolvedValue([{ followerId: "f-1" }])
    vi.mocked(redisPipeline).mockRejectedValue(new Error("offline"))
    await expect(fanoutStoryFollowerBatch({ creatorId: "owner", storyId: "s", createdAt: new Date(), cursor: null })).rejects.toThrow("offline")
  })
})
