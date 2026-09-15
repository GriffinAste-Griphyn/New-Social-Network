import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ batch: vi.fn(), single: vi.fn(), mine: vi.fn(), stats: vi.fn() }))
vi.mock("@/lib/story-store", () => ({ getStoryStacksForStories: mocks.batch, getStoryStackForStory: mocks.single, getMyStoryStack: mocks.mine }))
vi.mock("@/lib/creator-stats", () => ({ getCreatorStats: mocks.stats }))
vi.mock("@/lib/story-storage", async original => ({ ...await original<object>(), publicStoryMediaUrl: (url: string) => url }))
import { getMobileInitialStoryStacks } from "@/lib/mobile-story-stacks"

const stack = (id: string, title = "Story") => ({ id, creatorId: id, creator: id, handle: `@${id}`, avatarUrl: null,
  items: [{ id, assetKind: "image", mediaUrl: "https://media.invalid/story.jpg", thumbnailUrl: null, placeholderUrl: null, title, postedAt: "now", textOverlays: [] }] })
beforeEach(() => { vi.clearAllMocks(); mocks.stats.mockResolvedValue({ stories: [] }) })
it("hydrates all selected creator stacks with one batch instead of per-story reads", async () => {
  mocks.batch.mockResolvedValue(new Map(["a", "b", "c"].map(id => [id, stack(id)])))
  const result = await getMobileInitialStoryStacks({ storyIds: ["a", "b", "a", "c"], viewerId: "viewer", request: new Request("https://www.ubeye.ai/api/mobile/feed") })
  expect(Object.keys(result)).toEqual(["a", "b", "c"])
  expect(mocks.batch).toHaveBeenCalledOnce()
  expect(mocks.batch).toHaveBeenCalledWith(["a", "b", "c"], "viewer")
  expect(mocks.single).not.toHaveBeenCalled()
})
it("omits oversized complete stacks while preserving other ready stacks", async () => {
  mocks.batch.mockResolvedValue(new Map([["large", stack("large", "x".repeat(140 * 1024))], ["small", stack("small")]]))
  const result = await getMobileInitialStoryStacks({ storyIds: ["large", "small"], viewerId: "viewer", request: new Request("https://www.ubeye.ai/api/mobile/feed") })
  expect(Object.keys(result)).toEqual(["small"])
  expect(result.small.story.items).toHaveLength(1)
})
it("reuses the feed's owner summary rather than reading it again", async () => {
  mocks.batch.mockResolvedValue(new Map())
  await getMobileInitialStoryStacks({ storyIds: ["my-story"], viewerId: "viewer", request: new Request("https://www.ubeye.ai/api/mobile/feed"),
    myStory: { owner: { id: "viewer", name: "Viewer", handle: "viewer", imageUrl: null }, hasActiveStory: false,
      liveCount: 0, latestThumbnailUrl: null, latestAssetKind: null, expiresSoonLabel: null, items: [] } })
  expect(mocks.mine).not.toHaveBeenCalled()
})
