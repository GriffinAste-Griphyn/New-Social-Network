import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET, POST } from "@/app/api/mobile/feed/route"
import { feedResponseEtag } from "@/lib/feed-response-cache"
import { usableFeedSnapshot } from "@/lib/feed-snapshot-store"
import type { FeedData } from "@/lib/story-store"

const mocks = vi.hoisted(() => ({ session: vi.fn(), snapshot: vi.fn(), feed: vi.fn(), page: vi.fn(), stacks: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getCompleteMobileSession: mocks.session }))
vi.mock("@/lib/feed-snapshot-store", async importOriginal => ({ ...await importOriginal<object>(), readFeedSnapshot: mocks.snapshot }))
vi.mock("@/lib/story-store", () => ({ getFeedData: mocks.feed, getFollowingTimelinePage: mocks.page }))
vi.mock("@/lib/mobile-story-stacks", () => ({ getMobileInitialStoryStacks: mocks.stacks }))
const user = { id: "viewer-a", displayName: "Viewer", handle: "viewer" }
const feed = { featuredStory: null, followingProfiles: [], followingStories: [], followingTimelineStories: [], discoverStories: [], suggestedAccounts: [], myStory: { owner: { id: user.id, name: user.displayName, handle: user.handle, imageUrl: null }, hasActiveStory: false, liveCount: 0, latestThumbnailUrl: null, latestAssetKind: null, expiresSoonLabel: null, items: [] } } satisfies FeedData
const makeRequest = (suffix = "", headers = {}) => new Request(`https://www.ubeye.ai/api/mobile/feed${suffix}`, { headers })
describe("feed response performance contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue(user)
    mocks.snapshot.mockResolvedValue(null)
    mocks.feed.mockResolvedValue(feed)
    mocks.page.mockResolvedValue([])
    mocks.stacks.mockResolvedValue({})
  })
  it("returns 304 before rebuilding or hydrating a fresh unchanged snapshot", async () => {
    const snapshot = { cachedAt: Date.now(), timelineLimit: 21, payload: feed }
    mocks.snapshot.mockResolvedValue(snapshot)
    const request = makeRequest()
    const etag = feedResponseEtag(feed, request, user, 20)
    const response = await GET(makeRequest("", { "if-none-match": etag }))
    expect(response.status).toBe(304)
    expect(await response.text()).toBe("")
    expect(mocks.feed).not.toHaveBeenCalled()
    expect(mocks.stacks).not.toHaveBeenCalled()
    expect(response.headers.get("CDN-Cache-Control")).toBe("no-store")
  })
  it("passes the already-read snapshot through, including a cache miss", async () => {
    await GET(makeRequest())
    expect(mocks.snapshot).toHaveBeenCalledOnce()
    expect(mocks.feed).toHaveBeenCalledWith(user.id, expect.objectContaining({ preloadedSnapshot: null, timelineLimit: 21 }))
  })
  it("does not accept validators from another account, build or page size", async () => {
    const request = makeRequest()
    const tag = feedResponseEtag(feed, request, user, 20)
    expect(feedResponseEtag(feed, request, { ...user, id: "viewer-b" }, 20)).not.toBe(tag)
    expect(feedResponseEtag(feed, makeRequest("", { "x-ubeye-app-build": "448" }), user, 20)).not.toBe(tag)
    expect(feedResponseEtag(feed, request, user, 50)).not.toBe(tag)
    expect(usableFeedSnapshot({ cachedAt: Date.now(), timelineLimit: 21, payload: feed }, 51)).toBeNull()
    mocks.session.mockResolvedValue(null)
    expect((await GET(makeRequest("", { "if-none-match": tag }))).status).toBe(401)
  })
  it("does not revalidate stale, invalidated, expired-story or differently shaped snapshots", async () => {
    const tag = feedResponseEtag(feed, makeRequest(), user, 20)
    for (const snapshot of [null,
      { cachedAt: Date.now() - 61_000, timelineLimit: 21, payload: feed },
      { cachedAt: Date.now(), timelineLimit: 51, payload: feed },
      { cachedAt: Date.now(), timelineLimit: 21, payload: { ...feed, snapshotExpiresAt: new Date(Date.now() - 1).toISOString() } },
    ]) {
      mocks.snapshot.mockResolvedValue(snapshot)
      // A rebuild may coincidentally yield the same body, but it must execute
      // instead of trusting the stale validator before authorization/data work.
      mocks.feed.mockClear()
      await GET(makeRequest("", { "if-none-match": tag }))
      expect(mocks.feed).toHaveBeenCalledOnce()
    }
  })
  it("returns the feed when optional stack preparation exceeds its deadline", async () => {
    vi.useFakeTimers()
    try {
      mocks.stacks.mockReturnValue(new Promise(() => {}))
      const response = GET(makeRequest())
      await vi.waitFor(() => expect(mocks.stacks).toHaveBeenCalledOnce())
      await vi.advanceTimersByTimeAsync(750)
      expect(await (await response).json()).toHaveProperty("initialStoryStacks", {})
    } finally { vi.useRealTimers() }
  })
  it("returns only the requested timeline delta, with no snapshot or initial-stack work", async () => {
    const cursor = Buffer.from(JSON.stringify({ lastSeenAt: new Date().toISOString(), id: "story-cursor" })).toString("base64url")
    const response = await GET(makeRequest(`?cursor=${cursor}&format=timeline-v1`))
    expect(await response.json()).toEqual({ ok: true, followingTimelineStories: [], nextCursor: null })
    expect(mocks.page).toHaveBeenCalledOnce()
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.feed).not.toHaveBeenCalled()
    expect(mocks.stacks).not.toHaveBeenCalled()
  })
  it("keeps the full response for legacy pagination and never returns 304 to POST", async () => {
    const cursor = Buffer.from(JSON.stringify({ lastSeenAt: new Date().toISOString(), id: "story-cursor" })).toString("base64url")
    expect(await (await GET(makeRequest(`?cursor=${cursor}`))).json()).toHaveProperty("myStory")
    expect(mocks.page).not.toHaveBeenCalled()
    const tag = feedResponseEtag(feed, makeRequest(), user, 20)
    mocks.snapshot.mockResolvedValue({ cachedAt: Date.now(), timelineLimit: 21, payload: feed })
    expect((await POST(new Request(makeRequest(), { method: "POST", headers: { "if-none-match": tag } }))).status).toBe(200)
  })
})
