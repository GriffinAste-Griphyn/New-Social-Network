import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"

vi.mock("@/lib/auth", () => ({
  getCompleteMobileSession: vi.fn(),
}))

vi.mock("@/lib/creator-stats", () => ({
  getCreatorStats: vi.fn(),
}))

vi.mock("@/lib/profile-avatar-storage", () => ({
  publicProfileAvatarUrl: vi.fn((value: string | null, request: Request) =>
    value ? new URL(value, request.url).toString() : null,
  ),
}))

vi.mock("@/lib/story-storage", () => ({
  publicStoryMediaUrl: vi.fn((value: string | null) =>
    value ? `https://cdn.example.com${value}` : null,
  ),
}))

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

describe("mobile creator stats API", () => {
  beforeEach(() => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(getCreatorStats).mockResolvedValue({
      followerCount: 0,
      followingCount: 0,
      totalStories: 1,
      liveStories: 1,
      expiredStories: 0,
      removedStories: 0,
      totalViews: 12,
      uniqueViewers: 8,
      completedViews: 5,
      completionRate: 42,
      averageViewedSeconds: 3.5,
      totalViewedSeconds: 42,
      comments: 1,
      replies: 2,
      earnings: {
        totalCents: 0,
        pendingCents: 0,
        approvedCents: 0,
        paidCents: 0,
        reversedCents: 0,
        availableCents: 0,
        nextAvailableAt: null,
      },
      stories: [
        {
          id: "story_123",
          assetKind: "image",
          mediaUrl: "/api/story-media/stories/story.jpg",
          thumbnailUrl: "/api/story-media/stories/story-thumb.jpg",
          caption: "Story post",
          status: "live",
          createdAt: "2026-06-10T21:32:00.000Z",
          expiresAt: "2026-06-11T21:32:00.000Z",
          views: 12,
          uniqueViewers: 8,
          completedViews: 5,
          completionRate: 42,
          averageViewedSeconds: 3.5,
          comments: 1,
          replies: 2,
          earningsCents: 0,
          pendingEarningsCents: 0,
          paidEarningsCents: 0,
          commentItems: [
            {
              id: "comment_123",
              storyId: "story_123",
              actor: {
                id: "viewer_123",
                name: "Viewer",
                handle: "viewer",
                imageUrl: "/api/profile-avatar-media/avatars/viewer.jpg",
              },
              body: "Great story",
              mediaUrl: null,
              mediaThumbnailUrl: null,
              mediaAssetKind: null,
              createdAt: "2026-06-10T21:35:00.000Z",
            },
          ],
        },
      ],
    })
  })

  it("returns active story stats with story-specific comments", async () => {
    const { GET } = await import("@/app/api/mobile/creator/stats/route")
    const response = await GET(
      new Request(
        "https://app.example.com/api/mobile/creator/stats?stories=active&includeStoryComments=true",
      ),
    )

    expect(response.status).toBe(200)
    expect(getCreatorStats).toHaveBeenCalledWith("creator_123", {
      from: undefined,
      to: undefined,
      storyScope: "active",
      includeStoryComments: true,
    })
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      stats: {
        totalStories: 1,
        liveStories: 1,
        stories: [
          {
            id: "story_123",
            status: "live",
            mediaUrl:
              "https://cdn.example.com/api/story-media/stories/story.jpg?v=story_123",
            thumbnailUrl:
              "https://cdn.example.com/api/story-media/stories/story-thumb.jpg?v=story_123",
            commentItems: [
              {
                id: "comment_123",
                storyId: "story_123",
                body: "Great story",
                actor: {
                  id: "viewer_123",
                  imageUrl:
                    "https://app.example.com/api/profile-avatar-media/avatars/viewer.jpg",
                },
              },
            ],
          },
        ],
      },
    })
  })
})
