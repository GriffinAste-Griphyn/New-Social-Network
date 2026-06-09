import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"
import { getMyStoryStack } from "@/lib/story-store"

vi.mock("@/lib/auth", () => ({
  getCompleteMobileSession: vi.fn(),
}))

vi.mock("@/lib/creator-stats", () => ({
  getCreatorStats: vi.fn(),
}))

vi.mock("@/lib/story-store", () => ({
  getMyStoryStack: vi.fn(),
  getStoryStackForStory: vi.fn(),
  removeStoryForOwner: vi.fn(),
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

vi.mock("@/lib/story-storage", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/story-storage")>(
      "@/lib/story-storage",
    )

  return {
    ...actual,
    publicStoryMediaUrl: vi.fn((value: string | null) =>
      value ? `https://cdn.example.com${value}` : null,
    ),
    removeStoryAsset: vi.fn(),
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

describe("mobile my story stack API", () => {
  beforeEach(() => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(getCreatorStats).mockResolvedValue({
      followerCount: 0,
      followingCount: 0,
      totalStories: 1,
      liveStories: 0,
      expiredStories: 0,
      removedStories: 0,
      totalViews: 0,
      uniqueViewers: 0,
      completedViews: 0,
      completionRate: 0,
      averageViewedSeconds: 0,
      totalViewedSeconds: 0,
      comments: 0,
      replies: 0,
      earnings: {
        totalCents: 0,
        pendingCents: 0,
        approvedCents: 0,
        paidCents: 0,
        reversedCents: 0,
        availableCents: 0,
        nextAvailableAt: null,
      },
      stories: [],
    })
  })

  it("returns an owner processing video in My Story instead of 404", async () => {
    vi.mocked(getMyStoryStack).mockResolvedValue({
      owner: {
        id: "creator_123",
        name: "Creator",
        handle: "creator",
        imageUrl: null,
      },
      hasActiveStory: true,
      liveCount: 1,
      latestThumbnailUrl: "/api/story-media/stories/video-thumb.jpg",
      latestAssetKind: "video",
      expiresSoonLabel: "24h left",
      items: [
        {
          id: "story_processing",
          creator: "Creator",
          handle: "@creator",
          assetKind: "video",
          mediaUrl: "/api/story-media/stories/video.m3u8",
          thumbnailUrl: "/api/story-media/stories/video-thumb.jpg",
          processingStatus: "processing",
          title: "Video processing",
          caption: "Video processing",
          textOverlays: [],
          durationSeconds: 10,
          lastUploadedAt: "2026-06-08T16:00:00.000Z",
          progressPercent: 96,
          timelineSegmentCount: 1,
          createdAt: "2026-06-08T16:00:00.000Z",
          expiresAt: "2026-06-09T16:00:00.000Z",
          minutesRemaining: 1440,
          brandTags: [],
          elements: [],
        },
      ],
    })

    const { GET } = await import("@/app/api/mobile/stories/[id]/route")
    const response = await GET(
      new Request("https://app.example.com/api/mobile/stories/my-story"),
      { params: Promise.resolve({ id: "my-story" }) } as never,
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      story: {
        id: "my-story",
        items: [
          {
            id: "story_processing",
            assetKind: "video",
            processingStatus: "processing",
            mediaUrl:
              "https://cdn.example.com/api/story-media/stories/video.m3u8?v=story_processing",
            thumbnailUrl:
              "https://cdn.example.com/api/story-media/stories/video-thumb.jpg?v=story_processing",
          },
        ],
      },
    })
  })
})
