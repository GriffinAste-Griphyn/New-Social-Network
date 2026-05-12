import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { searchDiscoverProfiles } from "@/lib/follow-store"

vi.mock("@/lib/auth", () => ({
  getCompleteMobileSession: vi.fn(),
}))

vi.mock("@/lib/follow-store", () => ({
  searchDiscoverProfiles: vi.fn(),
}))

const session = {
  id: "viewer_123",
  email: "viewer@example.com",
  handle: "viewer",
  displayName: "Viewer",
  avatarUrl: null,
  onboardingIntent: "explore" as const,
  creatorStatus: "inactive" as const,
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("mobile discover search API", () => {
  beforeEach(() => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
  })

  it("searches complete creator profiles by query", async () => {
    vi.mocked(searchDiscoverProfiles).mockResolvedValue([
      {
        id: "user_griffinaste",
        name: "Griffin",
        handle: "griffinaste",
        imageUrl: "/api/profile-avatar-media/avatars/avatar.jpg",
        activeStoryId: null,
        hasActiveStory: false,
      },
    ])

    const { GET } = await import("@/app/api/mobile/discover/search/route")
    const response = await GET(
      new Request("https://app.example.com/api/mobile/discover/search?q=griffinaste"),
    )

    expect(response.status).toBe(200)
    expect(searchDiscoverProfiles).toHaveBeenCalledWith({
      viewerId: "viewer_123",
      query: "griffinaste",
    })
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      profiles: [
        {
          id: "user_griffinaste",
          handle: "griffinaste",
          imageUrl:
            "https://app.example.com/api/profile-avatar-media/avatars/avatar.jpg",
        },
      ],
    })
  })

  it("requires a complete mobile session", async () => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(null)

    const { GET } = await import("@/app/api/mobile/discover/search/route")
    const response = await GET(
      new Request("https://app.example.com/api/mobile/discover/search?q=griffinaste"),
    )

    expect(response.status).toBe(401)
    expect(searchDiscoverProfiles).not.toHaveBeenCalled()
  })
})
