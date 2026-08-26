import { del, list } from "@vercel/blob"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  removeExpiredStoryMediaFromStorage,
  type ExpiredStoryMediaCleanupCandidate,
} from "@/lib/expired-story-media"

vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
  list: vi.fn(),
}))

vi.mock("@/lib/story-storage", () => ({
  removeCloudflareStreamVideoByUid: vi.fn(),
  removeDirectBlobStoryVideoPoster: vi.fn(),
  removeStoryAsset: vi.fn(),
}))

function customVideoCandidate(
  overrides: Partial<ExpiredStoryMediaCleanupCandidate> = {},
): ExpiredStoryMediaCleanupCandidate {
  return {
    id: "media-1",
    storageProvider: "vercel-blob",
    storageKey: "media/hls-v1/opaque/master.m3u8",
    mediaUrl: "https://delivery.example/media/hls-v1/opaque/master.m3u8",
    thumbnailUrl: "https://delivery.example/media/hls-v1/opaque/poster.jpg",
    placeholderUrl: "https://delivery.example/media/hls-v1/opaque/poster.jpg",
    originalMediaUrl:
      "/api/story-media/media-originals/user/upload/source.mov",
    originalThumbnailUrl:
      "/api/story-media/stories/video-posters/poster.jpg",
    originalStorageKey: "media-originals/user/upload/source.mov",
    pipelineVersion: "hls-v1",
    byteSize: 100,
    originalByteSize: 1_000,
    durationMs: 10_000,
    ...overrides,
  }
}

describe("expired custom HLS media cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BLOB_READ_WRITE_TOKEN = "private-token"
    process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN = "delivery-token"
  })

  it("deletes every delivery object and each private upload", async () => {
    vi.mocked(list)
      .mockResolvedValueOnce({
        blobs: [
          {
            url: "https://delivery.example/media/hls-v1/opaque/master.m3u8",
          },
          {
            url: "https://delivery.example/media/hls-v1/opaque/720p/segment.m4s",
          },
        ],
        cursor: "next-page",
        hasMore: true,
      } as Awaited<ReturnType<typeof list>>)
      .mockResolvedValueOnce({
        blobs: [
          {
            url: "https://delivery.example/media/hls-v1/opaque/poster.jpg",
          },
        ],
        hasMore: false,
      } as Awaited<ReturnType<typeof list>>)

    await removeExpiredStoryMediaFromStorage(customVideoCandidate())

    expect(list).toHaveBeenNthCalledWith(1, {
      prefix: "media/hls-v1/opaque/",
      cursor: undefined,
      limit: 1_000,
      token: "delivery-token",
    })
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: "media/hls-v1/opaque/",
      cursor: "next-page",
      limit: 1_000,
      token: "delivery-token",
    })
    expect(del).toHaveBeenCalledWith(
      [
        "https://delivery.example/media/hls-v1/opaque/master.m3u8",
        "https://delivery.example/media/hls-v1/opaque/720p/segment.m4s",
        "https://delivery.example/media/hls-v1/opaque/poster.jpg",
      ],
      { token: "delivery-token" },
    )
    expect(del).toHaveBeenCalledWith(
      [
        "media-originals/user/upload/source.mov",
        "stories/video-posters/poster.jpg",
      ],
      { token: "private-token" },
    )
  })

  it("accepts an immutable versioned master playlist", async () => {
    vi.mocked(list).mockResolvedValue({
      blobs: [],
      hasMore: false,
    } as Awaited<ReturnType<typeof list>>)

    await removeExpiredStoryMediaFromStorage(
      customVideoCandidate({
        storageKey:
          "media/hls-v1/opaque/master-360p-540p-720p-1080p.m3u8",
      }),
    )

    expect(list).toHaveBeenCalledWith({
      prefix: "media/hls-v1/opaque/",
      cursor: undefined,
      limit: 1_000,
      token: "delivery-token",
    })
  })

  it("refuses a custom asset whose storage key is not its master playlist", async () => {
    await expect(
      removeExpiredStoryMediaFromStorage(
        customVideoCandidate({
          storageKey: "media/hls-v1/opaque/720p/index.m3u8",
        }),
      ),
    ).rejects.toThrow("invalid HLS delivery prefix")

    expect(list).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })
})
