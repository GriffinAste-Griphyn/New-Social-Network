import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  claimMediaUploadSessionForCompletion,
  markMediaUploadSessionCompleted,
} from "@/lib/media-upload-sessions"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  completeMobileVideoStory,
  getExistingMobileVideoStoryCompletion,
} from "@/lib/stories/mobile-video-completion"
import {
  createCloudflareStreamStoredVideoAsset,
  createDirectBlobStoryVideoPosterUrl,
  getCloudflareStreamVideoDetails,
  setCloudflareStreamThumbnailAtDefaultTime,
} from "@/lib/story-storage"

vi.mock("@/lib/auth", () => ({
  getCompleteMobileSession: vi.fn(),
}))

vi.mock("@/lib/request-security", () => ({
  enforceRequestRateLimits: vi.fn(),
  mutationRateLimits: {
    storyUploadUser: {},
    storyUploadIp: {},
  },
  requestIpSubject: vi.fn(() => "127.0.0.1"),
}))

vi.mock("@/lib/media-upload-sessions", () => ({
  claimMediaUploadSessionForCompletion: vi.fn(),
  cloudflareDetailsFromUploadSession: vi.fn(() => null),
  isCloudflareStreamFullyReady: vi.fn(() => false),
  markMediaUploadSessionCompleted: vi.fn(),
  MediaUploadSessionError: class MediaUploadSessionError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message)
    }
  },
  mergeCloudflareStreamProviderDetails: vi.fn(
    (_retained: unknown, observed: unknown) => observed,
  ),
  recordCloudflareStreamUploadStatus: vi.fn(),
  releaseMediaUploadSessionCompletion: vi.fn(),
}))

vi.mock("@/lib/stories/mobile-video-completion", () => ({
  completeMobileVideoStory: vi.fn(),
  getExistingMobileVideoStoryCompletion: vi.fn(),
}))

vi.mock("@/lib/story-storage", () => ({
  createCloudflareStreamStoredVideoAsset: vi.fn(),
  createDirectBlobStoryVideoPosterUrl: vi.fn(),
  getCloudflareStreamVideoDetails: vi.fn(),
  maxStoryVideoPosterUploadBytes: 2 * 1024 * 1024,
  setCloudflareStreamThumbnailAtDefaultTime: vi.fn(),
  StoryUploadError: class StoryUploadError extends Error {},
}))

const uid = "a".repeat(32)
const posterPathname = `stories/video-posters/${uid}-poster.jpg`
const posterUrl = `/api/story-media/${posterPathname}`

function completionRequest(input: { build: number; includePoster: boolean }) {
  return new Request("https://app.example.com/api/mobile/stories/video-complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ubeye-app-build": String(input.build),
    },
    body: JSON.stringify({
      uid,
      uploadSessionId: "upload-123",
      contentType: "video/mp4",
      byteSize: 4_096,
      durationMs: 5_000,
      ...(input.includePoster
        ? {
            poster: {
              pathname: posterPathname,
              contentType: "image/jpeg",
              byteSize: 12_345,
              checksum: "b".repeat(64),
              width: 1080,
              height: 1920,
            },
          }
        : {}),
    }),
  })
}

describe("mobile video poster completion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCompleteMobileSession).mockResolvedValue({ id: "creator-1" } as never)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(claimMediaUploadSessionForCompletion).mockResolvedValue({
      state: "claimed",
      session: { id: "upload-123", ownerUserId: "creator-1" },
    } as never)
    vi.mocked(getExistingMobileVideoStoryCompletion).mockResolvedValue(null)
    vi.mocked(getCloudflareStreamVideoDetails).mockRejectedValue(
      new Error("Provider status is not available yet"),
    )
    vi.mocked(createDirectBlobStoryVideoPosterUrl).mockResolvedValue(posterUrl)
    vi.mocked(createCloudflareStreamStoredVideoAsset).mockImplementation(
      (input) =>
        ({
          assetKind: "video",
          mediaUrl: `/api/story-media/cloudflare-stream/${input.uid}/manifest/video.m3u8`,
          thumbnailUrl: input.thumbnailUrl ?? null,
          placeholderUrl: input.thumbnailUrl ?? null,
          storageProvider: "cloudflare-stream",
          storageKey: input.uid,
          contentType: input.contentType,
          byteSize: input.byteSize,
          checksum: input.uid,
          width: null,
          height: null,
          durationMs: input.durationMs ?? null,
          processingStatus: "processing",
        }) as never,
    )
    vi.mocked(completeMobileVideoStory).mockResolvedValue({
      ok: true,
      storyId: "story-123",
      processingStatus: "processing",
      moderationStatus: "approved",
    } as never)
    vi.mocked(markMediaUploadSessionCompleted).mockResolvedValue(undefined)
    vi.mocked(setCloudflareStreamThumbnailAtDefaultTime).mockResolvedValue(undefined)
  })

  it("requires a poster from builds that implement the poster contract", async () => {
    const { POST } = await import("@/app/api/mobile/stories/video-complete/route")
    const response = await POST(
      completionRequest({ build: 306, includePoster: false }),
    )

    expect(response.status).toBe(400)
    expect(claimMediaUploadSessionForCompletion).not.toHaveBeenCalled()
  })

  it("persists the verified client poster even if Cloudflare thumbnail configuration fails", async () => {
    vi.mocked(setCloudflareStreamThumbnailAtDefaultTime).mockRejectedValueOnce(
      new Error("Cloudflare unavailable"),
    )
    const { POST } = await import("@/app/api/mobile/stories/video-complete/route")
    const response = await POST(
      completionRequest({ build: 306, includePoster: true }),
    )

    expect(response.status).toBe(200)
    expect(createDirectBlobStoryVideoPosterUrl).toHaveBeenCalledWith({
      uid,
      poster: expect.objectContaining({ pathname: posterPathname }),
    })
    expect(createCloudflareStreamStoredVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnailUrl: posterUrl }),
    )
  })

  it("keeps the Cloudflare fallback for an older installed build", async () => {
    const { POST } = await import("@/app/api/mobile/stories/video-complete/route")
    const response = await POST(
      completionRequest({ build: 305, includePoster: false }),
    )

    expect(response.status).toBe(200)
    expect(createDirectBlobStoryVideoPosterUrl).not.toHaveBeenCalled()
    expect(createCloudflareStreamStoredVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnailUrl: null }),
    )
  })
})
