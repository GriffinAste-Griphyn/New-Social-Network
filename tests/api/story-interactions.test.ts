import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  deleteStoryInteractionForUser,
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

vi.mock("@/lib/story-interactions", async () => {
  class StoryInteractionNotFoundError extends Error {}
  class StoryInteractionForbiddenError extends Error {}

  return {
    createStoryInteraction: vi.fn(),
    deleteStoryInteractionForUser: vi.fn(),
    listStoryInteractionsForActor: vi.fn(),
    listStoryInteractionsForCreator: vi.fn(),
    StoryInteractionNotFoundError,
    StoryInteractionForbiddenError,
  }
})

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
    vi.mocked(deleteStoryInteractionForUser).mockResolvedValue({
      id: "received_123",
      storyId: "story_123",
    })
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
    const { GET } = await import(
      "@/app/api/mobile/stories/inbox/interactions/route"
    )
    const response = await GET(
      new Request("https://app.example.com/api/mobile/stories/inbox/interactions"),
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
    expect(listStoryInteractionsForCreator).toHaveBeenCalledWith({
      creatorId: "viewer_123",
      storyId: undefined,
      kinds: ["reply", "comment"],
      limit: 100,
    })
  })

  it("filters reply history to the requested story id", async () => {
    const { GET } = await import("@/app/api/mobile/stories/[id]/interactions/route")
    const response = await GET(
      new Request("https://app.example.com/api/mobile/stories/story_123/interactions"),
      { params: Promise.resolve({ id: "story_123" }) } as never,
    )

    expect(response.status).toBe(200)
    expect(listStoryInteractionsForCreator).toHaveBeenCalledWith({
      creatorId: "viewer_123",
      storyId: "story_123",
      kinds: ["reply", "comment"],
      limit: 100,
    })
    expect(listStoryInteractionsForActor).toHaveBeenCalledWith({
      actorId: "viewer_123",
      storyId: "story_123",
      kinds: ["reply", "comment"],
      limit: 100,
    })
  })

  it("keeps the story interactions GET as a backwards-compatible inbox alias", async () => {
    const { GET } = await import("@/app/api/mobile/stories/[id]/interactions/route")
    const response = await GET(
      new Request("https://app.example.com/api/mobile/stories/my-story/interactions"),
      { params: Promise.resolve({ id: "my-story" }) } as never,
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      interactions: [{ id: "received_123" }],
      sentInteractions: [{ id: "sent_123" }],
    })
    expect(listStoryInteractionsForCreator).toHaveBeenCalledWith({
      creatorId: session.id,
      storyId: undefined,
      kinds: ["reply", "comment"],
      limit: 100,
    })
    expect(listStoryInteractionsForActor).toHaveBeenCalledWith({
      actorId: session.id,
      storyId: undefined,
      kinds: ["reply", "comment"],
      limit: 100,
    })
  })

  it("deletes a reply for the sender or receiver", async () => {
    const { DELETE } = await import(
      "@/app/api/mobile/stories/interactions/[interactionId]/route"
    )
    const response = await DELETE(
      new Request(
        "https://app.example.com/api/mobile/stories/interactions/received_123",
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ interactionId: "received_123" }) } as never,
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      interaction: {
        id: "received_123",
        storyId: "story_123",
      },
    })
    expect(deleteStoryInteractionForUser).toHaveBeenCalledWith({
      interactionId: "received_123",
      userId: "viewer_123",
    })
  })

  it("requires a mobile session before deleting a reply", async () => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(null)

    const { DELETE } = await import(
      "@/app/api/mobile/stories/interactions/[interactionId]/route"
    )
    const response = await DELETE(
      new Request(
        "https://app.example.com/api/mobile/stories/interactions/received_123",
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ interactionId: "received_123" }) } as never,
    )

    expect(response.status).toBe(401)
    expect(deleteStoryInteractionForUser).not.toHaveBeenCalled()
  })

  it("requires a mobile session", async () => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(null)

    const { GET } = await import(
      "@/app/api/mobile/stories/inbox/interactions/route"
    )
    const response = await GET(
      new Request("https://app.example.com/api/mobile/stories/inbox/interactions"),
    )

    expect(response.status).toBe(401)
    expect(listStoryInteractionsForCreator).not.toHaveBeenCalled()
    expect(listStoryInteractionsForActor).not.toHaveBeenCalled()
  })
})
