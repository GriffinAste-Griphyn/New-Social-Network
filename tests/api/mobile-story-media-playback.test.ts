import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMobileStoryMediaUrlResolver } from "@/lib/story-media/mobile-playback"

function request() {
  return new Request("https://app.example.com/api/mobile/stories/story_123")
}

describe("mobile story media playback URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DATABASE_URL = "postgres://user:pass@example.com/db"
    process.env.AUTH_SECRET = "x".repeat(32)
  })

  it("returns signed proxy URLs for progressive mobile story videos", async () => {
    const resolver = createMobileStoryMediaUrlResolver(request())
    const mediaUrl = await resolver.resolve(
      "/api/story-media/stories/mobile-original/creator_123/story.mov",
      {
        assetKind: "video",
        processingStatus: "ready",
      },
    )
    const nextMediaUrl = await resolver.resolve(
      "/api/story-media/stories/mobile-original/creator_123/next.mp4",
      {
        assetKind: "video",
      },
    )

    expect(mediaUrl).toContain(
      "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story.mov?token=",
    )
    expect(nextMediaUrl).toContain(
      "https://app.example.com/api/story-media/stories/mobile-original/creator_123/next.mp4?token=",
    )
  })

  it("keeps thumbnails, images, and playlists on the authenticated proxy route", async () => {
    const resolver = createMobileStoryMediaUrlResolver(request())
    const thumbnailUrl = await resolver.resolve(
      "/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      {
        directVideoPlayback: false,
      },
    )
    const hlsUrl = await resolver.resolve(
      "/api/story-media/stories/mobile-original/creator_123/story.m3u8",
      {
        assetKind: "video",
        processingStatus: "ready",
      },
    )

    expect(thumbnailUrl).toContain(
      "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg?token=",
    )
    expect(hlsUrl).toContain(
      "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story.m3u8?token=",
    )
  })
})
