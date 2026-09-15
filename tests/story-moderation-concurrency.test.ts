import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { moderateUserContent } from "@/lib/safety/moderate-content"
import { applyMediaModerationResult } from "@/lib/media-assets"
import { enqueueStoryPublication } from "@/lib/story-publication"
import { moderatePendingStory } from "@/lib/story-moderation-core"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
vi.mock("@/lib/safety/moderate-content", () => ({ moderateUserContent: vi.fn() }))
vi.mock("@/lib/media-assets", () => ({ applyMediaModerationResult: vi.fn() }))
vi.mock("@/lib/safety/moderation-checks", () => ({ recordModerationCheck: vi.fn() }))
vi.mock("@/lib/feed-snapshot-store", () => ({ invalidateMobileFeedSnapshotsForCreator: vi.fn() }))
vi.mock("@/lib/story-publication", () => ({ enqueueStoryPublication: vi.fn() }))
vi.mock("@/lib/story-media/access", () => ({ reviewableStoryMediaUrl: (url: string) => url }))

describe("asynchronous moderation publication", () => {
  beforeEach(() => vi.clearAllMocks())
  function fixture(updated: Array<{ id: string; status: string }>) {
    const story = { id: "story", creatorId: "owner", mediaAssetId: "media", assetKind: "video", caption: "fixture",
      status: "processing", processingStatus: "processing", moderationStatus: "pending", scanStatus: "passed",
      thumbnailUrl: null, expiresAt: new Date(Date.now() + 60_000) }
    const limit = vi.fn().mockResolvedValue([story])
    const query = { innerJoin: vi.fn(), where: vi.fn(() => ({ limit })) }
    query.innerJoin.mockReturnValue(query)
    const select = vi.fn().mockReturnValueOnce({ from: vi.fn(() => query) })
      .mockReturnValue({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })
    const where = vi.fn((condition: SQL) => { void condition; return { returning: vi.fn().mockResolvedValue(updated) } })
    const set = vi.fn((values: { status: SQL }) => { void values; return { where } })
    const execute = vi.fn().mockResolvedValue({ rows: [{ owner_token: "fixture" }] })
    vi.mocked(getDb).mockReturnValue({ select, update: vi.fn(() => ({ set })), execute } as never)
    vi.mocked(moderateUserContent).mockResolvedValue({ action: "approve", provider: "fixture", reason: null, categories: [] } as never)
    return { set, where }
  }
  it("uses current database readiness when the provider finishes during moderation", async () => {
    const { set, where } = fixture([{ id: "story", status: "live" }])
    await expect(moderatePendingStory("story")).resolves.toMatchObject({ moderationStatus: "approved", storyStatus: "live" })
    expect(enqueueStoryPublication).toHaveBeenCalledWith("story")
    const dialect = new PgDialect()
    const status = dialect.sqlToQuery(set.mock.calls[0][0].status)
    expect(status.sql).toContain('"stories"."processing_status"')
    expect(status.sql).toContain('"media_assets"."scan_status"')
    expect(status.sql).toContain('END::story_status')
    const fence = dialect.sqlToQuery(where.mock.calls[0][0])
    expect(fence.sql).toContain("owner_token =")
    expect(fence.sql).toContain("expires_at > now()")
    expect(fence.params).toContain("processing")
    expect(fence.params).toContain("live")
  })
  it("does not resurrect a deleted story or apply an obsolete review", async () => {
    fixture([])
    await expect(moderatePendingStory("story")).resolves.toEqual({ status: "stale" })
    expect(enqueueStoryPublication).not.toHaveBeenCalled()
    expect(applyMediaModerationResult).not.toHaveBeenCalled()
  })
})
