import { beforeEach, describe, expect, it, vi } from "vitest"

import { issueSignedToken, presignUrl } from "@vercel/blob"
import { createMobileStoryMediaUrlResolver } from "@/lib/story-media/mobile-playback"

vi.mock("@vercel/blob", () => ({
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
}))

const issuedToken = {
  clientSigningToken: "client-signing-token",
  delegationToken: "delegation-token",
  validUntil: 1_799_999_999_999,
}

function request() {
  return new Request("https://app.example.com/api/mobile/stories/story_123")
}

describe("mobile story media playback URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DATABASE_URL = "postgres://user:pass@example.com/db"
    process.env.AUTH_SECRET = "x".repeat(32)
    vi.mocked(issueSignedToken).mockResolvedValue(issuedToken)
    vi.mocked(presignUrl).mockImplementation(async (_token, options) => ({
      presignedUrl: `https://store.private.blob.vercel-storage.com/${options.pathname}?vercel-blob-signature=sig`,
    }))
  })

  it("returns direct signed Blob URLs for progressive mobile story videos", async () => {
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

    expect(mediaUrl).toBe(
      "https://store.private.blob.vercel-storage.com/stories/mobile-original/creator_123/story.mov?vercel-blob-signature=sig",
    )
    expect(nextMediaUrl).toBe(
      "https://store.private.blob.vercel-storage.com/stories/mobile-original/creator_123/next.mp4?vercel-blob-signature=sig",
    )
    expect(issueSignedToken).toHaveBeenCalledTimes(1)
    expect(issueSignedToken).toHaveBeenCalledWith({
      pathname: "*",
      operations: ["get"],
      validUntil: expect.any(Number),
    })
    expect(presignUrl).toHaveBeenCalledWith(issuedToken, {
      access: "private",
      operation: "get",
      pathname: "stories/mobile-original/creator_123/story.mov",
      validUntil: expect.any(Number),
    })
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
    expect(issueSignedToken).not.toHaveBeenCalled()
    expect(presignUrl).not.toHaveBeenCalled()
  })

  it("falls back to the authenticated proxy route if Blob signing fails", async () => {
    vi.mocked(issueSignedToken).mockRejectedValueOnce(new Error("Blob unavailable"))
    const resolver = createMobileStoryMediaUrlResolver(request())
    const mediaUrl = await resolver.resolve(
      "/api/story-media/stories/mobile-original/creator_123/story.mov",
      {
        assetKind: "video",
        processingStatus: "ready",
      },
    )

    expect(mediaUrl).toContain(
      "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story.mov?token=",
    )
  })
})
