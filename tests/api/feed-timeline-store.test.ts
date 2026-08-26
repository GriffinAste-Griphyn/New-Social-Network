import { beforeEach, describe, expect, it, vi } from "vitest"

import { getDb } from "@/lib/db"
import { redisPipeline } from "@/lib/upstash-redis"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
vi.mock("@/lib/upstash-redis", () => ({
  redisCommand: vi.fn(),
  redisPipeline: vi.fn(),
}))

function timelineDb(followerIds: string[]) {
  const where = vi
    .fn()
    .mockResolvedValue(followerIds.map((followerId) => ({ followerId })))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return { select }
}

describe("story timeline fanout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDb).mockReturnValue(
      timelineDb(["follower_1", "follower_2"]) as never,
    )
    vi.mocked(redisPipeline).mockResolvedValue([])
  })

  it("writes the creator and follower cache entries", async () => {
    const { fanoutStoryToFollowers } = await import(
      "@/lib/feed-timeline-store"
    )

    await expect(
      fanoutStoryToFollowers({
        creatorId: "creator_1",
        storyId: "story_1",
        createdAt: new Date("2026-08-25T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ cached: true, viewerCount: 3 })
    expect(redisPipeline).toHaveBeenCalledOnce()
    expect(vi.mocked(redisPipeline).mock.calls[0]?.[0]).toHaveLength(9)
  })

  it("does not fail publication when the derived cache is unavailable", async () => {
    vi.mocked(redisPipeline).mockRejectedValue(new Error("redis unavailable"))
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { fanoutStoryToFollowers } = await import(
      "@/lib/feed-timeline-store"
    )

    await expect(
      fanoutStoryToFollowers({
        creatorId: "creator_1",
        storyId: "story_1",
        createdAt: new Date("2026-08-25T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ cached: false, viewerCount: 3 })
    expect(warning).toHaveBeenCalledOnce()
    warning.mockRestore()
  })
})
