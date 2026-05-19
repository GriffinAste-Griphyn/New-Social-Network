import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  createStory,
  getFeedData,
  getStoryUploadStatusForOwner,
} from "@/lib/story-store"
import {
  publicStoryMediaUrl,
  removeStoryAsset,
  saveStoryAsset,
  StoryUploadError,
} from "@/lib/story-storage"

vi.mock("@/lib/auth", () => ({
  getCompleteMobileSession: vi.fn(),
}))

vi.mock("@/lib/request-security", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/request-security")>(
      "@/lib/request-security",
    )

  return {
    ...actual,
    enforceRequestRateLimits: vi.fn(),
  }
})

vi.mock("@/lib/story-store", () => ({
  createStory: vi.fn(),
  getFeedData: vi.fn(),
  getStoryUploadStatusForOwner: vi.fn(),
}))

vi.mock("@/lib/story-storage", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/story-storage")>(
      "@/lib/story-storage",
    )

  return {
    ...actual,
    publicStoryMediaUrl: vi.fn(),
    removeStoryAsset: vi.fn(),
    saveStoryAsset: vi.fn(),
  }
})

const session = {
  id: "user_123",
  email: "creator@example.com",
  handle: "creator",
  displayName: "Creator",
  avatarUrl: null,
  onboardingIntent: "create" as const,
  creatorStatus: "active" as const,
}

const storedAsset = {
  id: "asset_123",
  assetKind: "image" as const,
  mediaUrl: "/api/story-media/stories/story.jpg",
  thumbnailUrl: "/api/story-media/stories/story-thumb.jpg",
  storageProvider: "vercel-blob" as const,
  storageKey: "stories/story.jpg",
  contentType: "image/jpeg",
  byteSize: 1234,
  checksum: "checksum",
  width: 1080,
  height: 1920,
  durationMs: null,
  processingStatus: "ready" as const,
  scanStatus: "passed" as const,
  scanReason: null,
}
const createdAt = "2026-05-12T00:00:00.000Z"
const expiresAt = "2026-05-13T00:00:00.000Z"
const createdStoryId = "11111111-1111-4111-8111-111111111111"

function formRequest(path: string, formData: FormData) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "x-forwarded-for": "203.0.113.20",
    },
    body: formData,
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

function storyCard(id: string, handle = "@creator", creator = "Creator") {
  return {
    id,
    creator,
    handle,
    title: "Morning update",
    caption: "Caption",
    assetKind: "image" as const,
    mediaUrl: `/media/${id}.jpg`,
    thumbnailUrl: `/media/${id}-thumb.jpg`,
    tags: ["coffee"],
    payoutHint: "$1.00 projected",
    engagement: "10 views",
    createdAt,
    expiresAt,
    lastUploadedAt: createdAt,
    progressPercent: 80,
    timelineSegmentCount: 1,
    minutesRemaining: 60,
    brandTags: ["coffee"],
    elements: [],
    textOverlays: [],
  }
}

describe("story upload and mobile feed API", () => {
  beforeEach(() => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(saveStoryAsset).mockResolvedValue(storedAsset)
    vi.mocked(createStory).mockResolvedValue(createdStoryId)
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue({
      id: createdStoryId,
      status: "live",
      processingStatus: "ready",
      moderationStatus: "approved",
      moderationReason: null,
      isLive: true,
    })
    vi.mocked(publicStoryMediaUrl).mockImplementation((value) =>
      value ? `https://cdn.example.com${value}` : null,
    )
  })

  it("uploads a mobile story and returns signed media URLs", async () => {
    const formData = new FormData()
    formData.set("caption", "Testing #Coffee")
    formData.set("brandTags", "@CoffeeCo")
    formData.set(
      "media",
      new File(["image-bytes"], "story.jpg", { type: "image/jpeg" }),
    )

    const { POST } = await import("@/app/api/mobile/stories/route")
    const response = await POST(formRequest("/api/mobile/stories", formData))

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      storyId: createdStoryId,
      asset: {
        assetKind: "image",
        mediaUrl: "https://cdn.example.com/api/story-media/stories/story.jpg",
        thumbnailUrl:
          "https://cdn.example.com/api/story-media/stories/story-thumb.jpg",
      },
    })
    expect(createStory).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        caption: "Testing #Coffee",
        explicitBrandTags: ["coffeeco"],
        storedAsset,
      }),
    )
  })

  it("rejects story uploads without a complete mobile session", async () => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(null)

    const { POST } = await import("@/app/api/mobile/stories/route")
    const response = await POST(
      formRequest("/api/mobile/stories", new FormData()),
    )

    expect(response.status).toBe(401)
    expect(await responseJson(response)).toMatchObject({
      error: "Sign in before uploading stories.",
    })
    expect(saveStoryAsset).not.toHaveBeenCalled()
  })

  it("removes uploaded media if story creation fails", async () => {
    vi.mocked(createStory).mockRejectedValue(new Error("db failed"))

    const formData = new FormData()
    formData.set(
      "media",
      new File(["image-bytes"], "story.jpg", { type: "image/jpeg" }),
    )

    const { POST } = await import("@/app/api/mobile/stories/route")
    const response = await POST(formRequest("/api/mobile/stories", formData))

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: "Story upload failed. Try again.",
    })
    expect(removeStoryAsset).toHaveBeenCalledWith(storedAsset.mediaUrl)
  })

  it("surfaces upload validation errors to mobile clients", async () => {
    vi.mocked(saveStoryAsset).mockRejectedValue(
      new StoryUploadError("Production story uploads require Blob storage."),
    )

    const formData = new FormData()
    formData.set(
      "media",
      new File(["image-bytes"], "story.jpg", { type: "image/jpeg" }),
    )

    const { POST } = await import("@/app/api/mobile/stories/route")
    const response = await POST(formRequest("/api/mobile/stories", formData))

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: "Production story uploads require Blob storage.",
    })
  })

  it("returns signed, collapsed mobile feed data", async () => {
    vi.mocked(getFeedData).mockResolvedValue({
      featuredStory: storyCard("featured"),
      followingStories: [storyCard("following-a"), storyCard("following-b")],
      followingTimelineStories: [
        storyCard("following-a"),
        storyCard("following-b"),
      ],
      discoverStories: [
        storyCard("discover-a", "@new", "New Creator"),
        storyCard("discover-b", "@new", "New Creator"),
      ],
      followingProfiles: [
        {
          id: "profile_1",
          name: "Creator",
          handle: "@creator",
          imageUrl: "/avatar.jpg",
        },
      ],
      suggestedAccounts: [],
      myStory: {
        owner: {
          id: "user_123",
          name: "Creator",
          handle: "@creator",
          imageUrl: "/me.jpg",
        },
        hasActiveStory: true,
        liveCount: 1,
        latestThumbnailUrl: "/my-thumb.jpg",
        latestAssetKind: "image",
        expiresSoonLabel: null,
        items: [storyCard("my-story")],
      },
    })

    const { POST } = await import("@/app/api/mobile/feed/route")
    const response = await POST(
      new Request("https://app.example.com/api/mobile/feed", {
        method: "POST",
      }),
    )

    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      session: {
        displayName: "Creator",
        handle: "creator",
      },
    })
    expect(payload.followingStories).toHaveLength(1)
    expect(payload.followingTimelineStories).toHaveLength(1)
    expect(payload.discoverTiles).toHaveLength(1)
    expect(payload.myStory).toMatchObject({
      liveCount: 1,
      latestThumbnailUrl: expect.stringContaining(
        "https://cdn.example.com/my-thumb.jpg",
      ),
    })
  })
})
