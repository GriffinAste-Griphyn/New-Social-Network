import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  listStoryInteractionsForActor,
  listStoryInteractionsForCreator,
} from "@/lib/story-interactions"

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

vi.mock("@/lib/story-interactions", () => ({
  createStoryInteraction: vi.fn(),
  listStoryInteractionsForActor: vi.fn(),
  listStoryInteractionsForCreator: vi.fn(),
}))

vi.mock("@/lib/story-storage", async () => {
  class StoryUploadError extends Error {}

  return {
    publicStoryMediaUrl: vi.fn((value: string | null) =>
      value ? `https://cdn.example.com${value}` : null,
    ),
    removeStoryAsset: vi.fn(),
    saveStoryAsset: vi.fn(),
    StoryUploadError,
  }
})

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

describe("mobile story interactions API", () => {
  beforeEach(() => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(listStoryInteractionsForCreator).mockResolvedValue([
      {
        id: "received_123",
        storyId: "story_123",
        creatorId: "viewer_123",
        story: {
          assetKind: "image",
          mediaUrl: "/api/story-media/stories/original.jpg",
          thumbnailUrl: "/api/story-media/stories/original-thumb.jpg",
        },
        actor: {
          id: "actor_123",
          name: "Actor",
          handle: "actor",
          imageUrl: "/api/profile-avatar-media/avatars/actor.jpg",
        },
        kind: "reply",
        body: "Nice story",
        reaction: null,
        mediaUrl: null,
        mediaThumbnailUrl: null,
        mediaAssetKind: null,
        createdAt: "2026-05-12T00:00:00.000Z",
      },
    ])
    vi.mocked(listStoryInteractionsForActor).mockResolvedValue([
      {
        id: "sent_123",
        storyId: "story_456",
        creatorId: "creator_123",
        story: {
          assetKind: "video",
          mediaUrl: "/api/story-media/stories/creator-video.mp4",
          thumbnailUrl: "/api/story-media/stories/creator-video-thumb.jpg",
        },
        actor: {
          id: "viewer_123",
          name: "Viewer",
          handle: "viewer",
          imageUrl: null,
        },
        target: {
          id: "creator_123",
          name: "Creator",
          handle: "creator",
          imageUrl: "/api/profile-avatar-media/avatars/creator.jpg",
        },
        kind: "reply",
        body: "Sick story bro",
        reaction: null,
        mediaUrl: "/api/story-media/stories/reply.jpg",
        mediaThumbnailUrl: "/api/story-media/stories/reply-thumb.jpg",
        mediaAssetKind: "image",
        createdAt: "2026-05-12T00:01:00.000Z",
      },
    ])
  })

  it("returns received and sent reply history", async () => {
    const { GET } = await import("@/app/api/mobile/stories/[id]/interactions/route")
    const response = await GET(
      new Request("https://app.example.com/api/mobile/stories/my-story/interactions"),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      interactions: [
        {
          id: "received_123",
          story: {
            mediaUrl: "https://cdn.example.com/api/story-media/stories/original.jpg",
            thumbnailUrl:
              "https://cdn.example.com/api/story-media/stories/original-thumb.jpg",
          },
          actor: {
            imageUrl:
              "https://app.example.com/api/profile-avatar-media/avatars/actor.jpg",
          },
        },
      ],
      sentInteractions: [
        {
          id: "sent_123",
          body: "Sick story bro",
          story: {
            assetKind: "video",
            mediaUrl:
              "https://cdn.example.com/api/story-media/stories/creator-video.mp4",
            thumbnailUrl:
              "https://cdn.example.com/api/story-media/stories/creator-video-thumb.jpg",
          },
          mediaUrl: "https://cdn.example.com/api/story-media/stories/reply.jpg",
          mediaThumbnailUrl:
            "https://cdn.example.com/api/story-media/stories/reply-thumb.jpg",
          target: {
            id: "creator_123",
            imageUrl:
              "https://app.example.com/api/profile-avatar-media/avatars/creator.jpg",
          },
        },
      ],
    })
  })

  it("requires a mobile session", async () => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(null)

    const { GET } = await import("@/app/api/mobile/stories/[id]/interactions/route")
    const response = await GET(
      new Request("https://app.example.com/api/mobile/stories/my-story/interactions"),
    )

    expect(response.status).toBe(401)
    expect(listStoryInteractionsForCreator).not.toHaveBeenCalled()
    expect(listStoryInteractionsForActor).not.toHaveBeenCalled()
  })
})
