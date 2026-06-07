import { beforeEach, describe, expect, it, vi } from "vitest"

import { get, head, put } from "@vercel/blob"
import {
  createDirectBlobStoryImageAsset,
  StoryUploadError,
} from "@/lib/story-storage"

vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
}))

describe("direct story image storage verification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(head).mockResolvedValue({
      size: 1234,
      contentType: "image/jpeg",
    } as Awaited<ReturnType<typeof head>>)
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: new Blob(["not-real-image"], {
        type: "image/jpeg",
      }).stream() as ReadableStream<Uint8Array>,
      headers: new Headers(),
      blob: {
        url: "https://blob.example.com/story.jpg",
        downloadUrl: "https://blob.example.com/story.jpg?download=1",
        pathname: "stories/web-direct/creator_123/story.jpg",
        contentDisposition: "inline",
        cacheControl: "public, max-age=31536000",
        uploadedAt: new Date(),
        etag: "etag",
        contentType: "image/jpeg",
        size: 1234,
      },
    } as unknown as Awaited<ReturnType<typeof get>>)
    vi.mocked(put).mockResolvedValue({
      pathname: "stories/web-direct/creator_123/story-thumb.jpg",
    } as Awaited<ReturnType<typeof put>>)
  })

  it("rejects an uploaded image outside the owner path", async () => {
    await expect(
      createDirectBlobStoryImageAsset({
        pathname: "stories/web-direct/other_user/story.jpg",
        ownerUserId: "creator_123",
        contentType: "image/jpeg",
        byteSize: 1234,
        checksum: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(StoryUploadError)

    expect(head).not.toHaveBeenCalled()
  })

  it("rejects mismatched Blob metadata", async () => {
    vi.mocked(head).mockResolvedValue({
      size: 9999,
      contentType: "image/jpeg",
    } as Awaited<ReturnType<typeof head>>)

    await expect(
      createDirectBlobStoryImageAsset({
        pathname: "stories/web-direct/creator_123/story.jpg",
        ownerUserId: "creator_123",
        contentType: "image/jpeg",
        byteSize: 1234,
        checksum: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(StoryUploadError)
  })

  it("returns a verified StoredStoryAsset and falls back to original as thumbnail if variant generation fails", async () => {
    const asset = await createDirectBlobStoryImageAsset({
      pathname: "stories/web-direct/creator_123/story.jpg",
      ownerUserId: "creator_123",
      contentType: "image/jpeg",
      byteSize: 1234,
      checksum: "A".repeat(64),
      width: 1080,
      height: 1920,
    })

    expect(asset).toMatchObject({
      assetKind: "image",
      mediaUrl: "/api/story-media/stories/web-direct/creator_123/story.jpg",
      thumbnailUrl: "/api/story-media/stories/web-direct/creator_123/story.jpg",
      storageProvider: "vercel-blob",
      storageKey: "stories/web-direct/creator_123/story.jpg",
      checksum: "a".repeat(64),
      width: 1080,
      height: 1920,
      processingStatus: "ready",
    })
  })
})
