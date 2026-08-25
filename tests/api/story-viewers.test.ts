import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  InvalidStoryViewerCursorError,
  listStoryViewers,
  StoryViewersUnavailableError,
} from "@/lib/story-viewers"

vi.mock("@/lib/auth", () => ({
  getCompleteMobileSession: vi.fn(),
}))

vi.mock("@/lib/profile-avatar-storage", () => ({
  publicProfileAvatarUrl: vi.fn((value: string | null, request: Request) =>
    value ? new URL(value, request.url).toString() : null,
  ),
}))

vi.mock("@/lib/story-viewers", async () => {
  class StoryViewersUnavailableError extends Error {}
  class InvalidStoryViewerCursorError extends Error {}

  return {
    listStoryViewers: vi.fn(),
    StoryViewersUnavailableError,
    InvalidStoryViewerCursorError,
  }
})

const session = {
  id: "creator_123",
  email: "creator@example.com",
  handle: "creator",
  displayName: "Creator",
  avatarUrl: null,
  onboardingIntent: "create" as const,
  creatorStatus: "active" as const,
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("mobile story viewers API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(listStoryViewers).mockResolvedValue({
      viewers: [
        {
          id: "viewer_123",
          name: "Viewer",
          handle: "viewer",
          imageUrl: "/api/profile-avatar-media/avatars/viewer.jpg",
          viewCount: 2,
          lastViewedAt: "2026-08-24T18:30:00.000Z",
        },
      ],
      totalViewers: 1,
      totalViews: 2,
      nextCursor: "next_page_cursor",
    })
  })

  it("returns a private paginated viewer list for the story creator", async () => {
    const { GET } = await import(
      "@/app/api/mobile/stories/[id]/viewers/route"
    )
    const response = await GET(
      new Request(
        "https://app.example.com/api/mobile/stories/story_123/viewers?limit=25&cursor=current_page_cursor",
      ),
      { params: Promise.resolve({ id: "story_123" }) } as never,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(listStoryViewers).toHaveBeenCalledWith({
      creatorId: "creator_123",
      storyId: "story_123",
      cursor: "current_page_cursor",
      limit: 25,
    })
    expect(await responseJson(response)).toEqual({
      ok: true,
      viewers: [
        {
          id: "viewer_123",
          name: "Viewer",
          handle: "viewer",
          imageUrl:
            "https://app.example.com/api/profile-avatar-media/avatars/viewer.jpg",
          viewCount: 2,
          lastViewedAt: "2026-08-24T18:30:00.000Z",
        },
      ],
      totalViewers: 1,
      totalViews: 2,
      nextCursor: "next_page_cursor",
    })
  })

  it("requires a complete mobile session", async () => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(null)
    const { GET } = await import(
      "@/app/api/mobile/stories/[id]/viewers/route"
    )
    const response = await GET(
      new Request(
        "https://app.example.com/api/mobile/stories/story_123/viewers",
      ),
      { params: Promise.resolve({ id: "story_123" }) } as never,
    )

    expect(response.status).toBe(401)
    expect(listStoryViewers).not.toHaveBeenCalled()
  })

  it("rejects invalid pagination input", async () => {
    const { GET } = await import(
      "@/app/api/mobile/stories/[id]/viewers/route"
    )
    const response = await GET(
      new Request(
        "https://app.example.com/api/mobile/stories/story_123/viewers?limit=101",
      ),
      { params: Promise.resolve({ id: "story_123" }) } as never,
    )

    expect(response.status).toBe(400)
    expect(listStoryViewers).not.toHaveBeenCalled()
  })

  it("does not expose viewers for a story the session does not own", async () => {
    vi.mocked(listStoryViewers).mockRejectedValueOnce(
      new StoryViewersUnavailableError("That story is not available."),
    )
    const { GET } = await import(
      "@/app/api/mobile/stories/[id]/viewers/route"
    )
    const response = await GET(
      new Request(
        "https://app.example.com/api/mobile/stories/story_456/viewers",
      ),
      { params: Promise.resolve({ id: "story_456" }) } as never,
    )

    expect(response.status).toBe(404)
    expect(await responseJson(response)).toEqual({
      error: "That story is not available.",
    })
  })

  it("rejects malformed opaque cursors", async () => {
    vi.mocked(listStoryViewers).mockRejectedValueOnce(
      new InvalidStoryViewerCursorError("The viewer cursor is invalid."),
    )
    const { GET } = await import(
      "@/app/api/mobile/stories/[id]/viewers/route"
    )
    const response = await GET(
      new Request(
        "https://app.example.com/api/mobile/stories/story_123/viewers?cursor=malformed",
      ),
      { params: Promise.resolve({ id: "story_123" }) } as never,
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toEqual({
      error: "The viewer cursor is invalid.",
    })
  })
})
