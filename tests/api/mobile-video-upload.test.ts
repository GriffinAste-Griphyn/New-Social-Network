import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  createStory,
  getStoryByStoredAssetForOwner,
  getStoryTextOverlaysForOwner,
  getStoryUploadStatusForOwner,
} from "@/lib/story-store"
import {
  createCloudflareStreamClientThumbnailPathname,
  createCloudflareStreamClientThumbnailUrl,
  createCloudflareStreamDirectUpload,
  createCloudflareStreamStoredVideoAsset,
  createCloudflareStreamTusUpload,
  createOriginalQualityVideoStoryAsset,
  getCloudflareStreamVideoDetails,
  publicStoryMediaUrl,
  removeStoryAsset,
  setCloudflareStreamThumbnailToLastFrame,
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
  getStoryByStoredAssetForOwner: vi.fn(),
  getStoryTextOverlaysForOwner: vi.fn(),
  getStoryUploadStatusForOwner: vi.fn(),
}))

vi.mock("@/lib/story-storage", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/story-storage")>(
      "@/lib/story-storage",
    )

  return {
    ...actual,
    createCloudflareStreamClientThumbnailPathname: vi.fn(),
    createCloudflareStreamClientThumbnailUrl: vi.fn(),
    createCloudflareStreamDirectUpload: vi.fn(),
    createCloudflareStreamStoredVideoAsset: vi.fn(),
    createCloudflareStreamTusUpload: vi.fn(),
    createOriginalQualityVideoStoryAsset: vi.fn(),
    getCloudflareStreamVideoDetails: vi.fn(),
    publicStoryMediaUrl: vi.fn(),
    removeStoryAsset: vi.fn(),
    setCloudflareStreamThumbnailToLastFrame: vi.fn(),
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

function jsonRequest(body: unknown) {
  return new Request("https://app.example.com/api/mobile/stories/video-upload", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.30",
    },
    body: JSON.stringify(body),
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("mobile Cloudflare video upload API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(createStory).mockResolvedValue(
      "22222222-2222-4222-8222-222222222222",
    )
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      status: "processing",
      processingStatus: "processing",
      providerStatus: "processing",
      providerError: null,
      lastCheckedAt: "2026-06-08T16:00:00.000Z",
      readyAt: null,
      moderationStatus: "approved",
      moderationReason: null,
      isLive: false,
    })
    vi.mocked(getStoryByStoredAssetForOwner).mockResolvedValue(null)
    vi.mocked(getStoryTextOverlaysForOwner).mockResolvedValue([])
    vi.mocked(createCloudflareStreamClientThumbnailPathname).mockImplementation(
      (userId, uid) =>
        `stories/mobile-cloudflare-thumbnails/${userId}/${uid}-thumb.jpg`,
    )
    vi.mocked(createCloudflareStreamClientThumbnailUrl).mockResolvedValue(
      "/api/story-media/stories/mobile-cloudflare-thumbnails/creator_123/11111111111111111111111111111111-thumb.jpg",
    )
    vi.mocked(createCloudflareStreamDirectUpload).mockReset()
    vi.mocked(createCloudflareStreamStoredVideoAsset).mockImplementation(
      (input) => ({
        assetKind: "video",
        mediaUrl: `/api/story-media/cloudflare-stream/${input.uid}/manifest/video.m3u8`,
        thumbnailUrl: `/api/story-media/cloudflare-stream/${input.uid}/thumbnails/thumbnail.jpg`,
        storageProvider: "cloudflare-stream",
        storageKey: input.uid,
        contentType: input.contentType,
        byteSize: input.byteSize,
        checksum: input.uid,
        width: input.width ?? null,
        height: input.height ?? null,
        durationMs: input.durationMs ?? null,
        processingStatus: input.processingStatus ?? "processing",
      }),
    )
    vi.mocked(createCloudflareStreamTusUpload).mockReset()
    vi.mocked(createOriginalQualityVideoStoryAsset).mockResolvedValue({
      assetKind: "video",
      mediaUrl:
        "/api/story-media/stories/mobile-playback/creator_123/story-playback.mp4",
      thumbnailUrl:
        "/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      storageProvider: "vercel-blob",
      storageKey: "stories/mobile-playback/creator_123/story-playback.mp4",
      contentType: "video/mp4",
      byteSize: 4 * 1024 * 1024,
      checksum: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      width: 1080,
      height: 1920,
      durationMs: 6_500,
      processingStatus: "ready",
      originalMediaUrl:
        "/api/story-media/stories/mobile-original/creator_123/story.mov",
      originalThumbnailUrl:
        "/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      originalStorageProvider: "vercel-blob",
      originalStorageKey: "stories/mobile-original/creator_123/story.mov",
      originalContentType: "video/quicktime",
      originalByteSize: 8 * 1024 * 1024,
      originalChecksum:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      originalWidth: 2160,
      originalHeight: 3840,
      originalDurationMs: 6_500,
      playbackRenditions: [
        {
          quality: "1080p",
          mediaUrl:
            "/api/story-media/stories/mobile-playback/creator_123/story-playback.mp4",
          thumbnailUrl: null,
          storageProvider: "vercel-blob",
          storageKey: "stories/mobile-playback/creator_123/story-playback.mp4",
          contentType: "video/mp4",
          byteSize: 4 * 1024 * 1024,
          checksum:
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          width: 1080,
          height: 1920,
          durationMs: 6_500,
        },
        {
          quality: "720p",
          mediaUrl:
            "/api/story-media/stories/mobile-playback/creator_123/story-playback-720p.mp4",
          thumbnailUrl: null,
          storageProvider: "vercel-blob",
          storageKey:
            "stories/mobile-playback/creator_123/story-playback-720p.mp4",
          contentType: "video/mp4",
          byteSize: 3 * 1024 * 1024,
          checksum:
            "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          width: 720,
          height: 1280,
          durationMs: 6_500,
        },
      ],
    })
    vi.mocked(getCloudflareStreamVideoDetails).mockResolvedValue({
      readyToStream: false,
      state: "processing",
      errorReason: null,
      byteSize: null,
      durationMs: null,
      width: null,
      height: null,
    })
    vi.mocked(publicStoryMediaUrl).mockImplementation((value, request) =>
      value && request ? new URL(value, request.url).toString() : value,
    )
    vi.mocked(removeStoryAsset).mockResolvedValue(undefined)
    vi.mocked(setCloudflareStreamThumbnailToLastFrame).mockResolvedValue(undefined)
  })

  it("rejects oversized mobile video uploads before creating a provider upload", async () => {
    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(
      jsonRequest({
        fileName: "large.mov",
        byteSize: 513 * 1024 * 1024,
        maxDurationSeconds: 120,
      }),
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: "Could not prepare the video upload.",
    })
    expect(createCloudflareStreamTusUpload).not.toHaveBeenCalled()
    expect(createCloudflareStreamDirectUpload).not.toHaveBeenCalled()
  })

  it("creates a Cloudflare TUS upload with the mobile duration cap", async () => {
    vi.mocked(createCloudflareStreamTusUpload).mockResolvedValue({
      uid: "11111111111111111111111111111111",
      uploadUrl: "https://upload.cloudflarestream.com/tus/abc",
      uploadProtocol: "tus",
    })

    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(
      jsonRequest({
        fileName: "story.mov",
        byteSize: 12 * 1024 * 1024,
        maxDurationSeconds: 120,
      }),
    )

    expect(response.status).toBe(200)
    expect(createCloudflareStreamTusUpload).toHaveBeenCalledWith({
      fileName: "story.mov",
      uploadLengthBytes: 12 * 1024 * 1024,
      maxDurationSeconds: 120,
    })
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      uid: "11111111111111111111111111111111",
      uploadProtocol: "tus",
    })
  })

  it("stores an uploaded client thumbnail when completing a Cloudflare video story", async () => {
    const { POST } = await import("@/app/api/mobile/stories/video-complete/route")
    vi.mocked(getStoryTextOverlaysForOwner).mockResolvedValue([
      {
        id: "overlay_1",
        label: "This is a test",
        kind: "text",
        href: null,
        sourceInteractionId: null,
        sourceActorName: null,
        sourceActorHandle: null,
        sourceActorAvatarUrl: null,
        positionX: 51.25,
        positionY: 62.5,
      },
    ])
    const response = await POST(
      new Request("https://app.example.com/api/mobile/stories/video-complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.30",
        },
        body: JSON.stringify({
          uid: "11111111111111111111111111111111",
          contentType: "video/mp4",
          byteSize: 12 * 1024 * 1024,
          durationMs: 7_200,
          thumbnailPathname:
            "stories/mobile-cloudflare-thumbnails/creator_123/11111111111111111111111111111111-thumb.jpg",
          thumbnailContentType: "image/jpeg",
          thumbnailByteSize: 42_000,
          thumbnailChecksum:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          caption: "Cloudflare test",
          brandTags: "CoffeeCo, UBEYE",
          textOverlays: "This is a test",
          textOverlayPositionX: "51.25",
          textOverlayPositionY: "62.50",
          linkLabel: "Open",
          linkUrl: "https://example.com/story",
          linkOverlayPositionX: "45.00",
          linkOverlayPositionY: "80.00",
        }),
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(createCloudflareStreamClientThumbnailUrl).toHaveBeenCalledWith({
      pathname:
        "stories/mobile-cloudflare-thumbnails/creator_123/11111111111111111111111111111111-thumb.jpg",
      contentType: "image/jpeg",
      byteSize: 42_000,
    })
    expect(createStory).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: "Cloudflare test",
        explicitBrandTags: ["coffeeco", "ubeye"],
        moderationMediaUrl:
          "https://app.example.com/api/story-media/cloudflare-stream/11111111111111111111111111111111/manifest/video.m3u8",
        moderationThumbnailUrl:
          "https://app.example.com/api/story-media/stories/mobile-cloudflare-thumbnails/creator_123/11111111111111111111111111111111-thumb.jpg",
        elements: expect.arrayContaining([
          expect.objectContaining({
            kind: "text",
            label: "This is a test",
            positionX: "51.25",
            positionY: "62.50",
          }),
          expect.objectContaining({
            kind: "link",
            label: "Open",
            href: "https://example.com/story",
            positionX: "45.00",
            positionY: "80.00",
          }),
        ]),
        storedAsset: expect.objectContaining({
          thumbnailUrl:
            "/api/story-media/stories/mobile-cloudflare-thumbnails/creator_123/11111111111111111111111111111111-thumb.jpg",
        }),
      }),
    )
    expect(payload).toMatchObject({
      ok: true,
      asset: {
        thumbnailUrl:
          "https://app.example.com/api/story-media/stories/mobile-cloudflare-thumbnails/creator_123/11111111111111111111111111111111-thumb.jpg",
      },
      processingStatus: "processing",
      providerStatus: "processing",
      providerError: null,
      lastCheckedAt: "2026-06-08T16:00:00.000Z",
      readyAt: null,
      textOverlays: [
        expect.objectContaining({
          label: "This is a test",
          kind: "text",
          positionX: 51.25,
          positionY: 62.5,
        }),
      ],
    })
  })

  it("completes a Cloudflare video story without a client thumbnail", async () => {
    const { POST } = await import("@/app/api/mobile/stories/video-complete/route")
    const response = await POST(
      new Request("https://app.example.com/api/mobile/stories/video-complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.30",
        },
        body: JSON.stringify({
          uid: "11111111111111111111111111111111",
          contentType: "video/mp4",
          byteSize: 12 * 1024 * 1024,
          durationMs: 7_200,
          caption: "Cloudflare test",
        }),
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(createCloudflareStreamClientThumbnailUrl).not.toHaveBeenCalled()
    expect(createStory).toHaveBeenCalledWith(
      expect.objectContaining({
        storedAsset: expect.objectContaining({
          thumbnailUrl:
            "/api/story-media/cloudflare-stream/11111111111111111111111111111111/thumbnails/thumbnail.jpg",
        }),
      }),
    )
    expect(payload).toMatchObject({
      ok: true,
      processingStatus: "processing",
      providerStatus: "processing",
      providerError: null,
      lastCheckedAt: "2026-06-08T16:00:00.000Z",
      readyAt: null,
    })
  })

  it("reuses an existing Cloudflare video story when completion is retried", async () => {
    vi.mocked(getStoryByStoredAssetForOwner).mockResolvedValueOnce({
      id: "existing-cloudflare-story",
      assetKind: "video",
      mediaUrl:
        "/api/story-media/cloudflare-stream/11111111111111111111111111111111/manifest/video.m3u8",
      thumbnailUrl:
        "/api/story-media/cloudflare-stream/11111111111111111111111111111111/thumbnails/thumbnail.jpg",
      processingStatus: "processing",
    })
    const { POST } = await import("@/app/api/mobile/stories/video-complete/route")
    const response = await POST(
      new Request("https://app.example.com/api/mobile/stories/video-complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.30",
        },
        body: JSON.stringify({
          uid: "11111111111111111111111111111111",
          contentType: "video/mp4",
          byteSize: 12 * 1024 * 1024,
          durationMs: 7_200,
          caption: "Retry should reuse",
        }),
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(getStoryByStoredAssetForOwner).toHaveBeenCalledWith({
      ownerId: "creator_123",
      storageProvider: "cloudflare-stream",
      storageKey: "11111111111111111111111111111111",
    })
    expect(getCloudflareStreamVideoDetails).not.toHaveBeenCalled()
    expect(createCloudflareStreamClientThumbnailUrl).not.toHaveBeenCalled()
    expect(createStory).not.toHaveBeenCalled()
    expect(payload).toMatchObject({
      ok: true,
      storyId: "existing-cloudflare-story",
      completionState: "reused",
      asset: {
        mediaUrl:
          "https://app.example.com/api/story-media/cloudflare-stream/11111111111111111111111111111111/manifest/video.m3u8",
        thumbnailUrl:
          "https://app.example.com/api/story-media/cloudflare-stream/11111111111111111111111111111111/thumbnails/thumbnail.jpg",
      },
      processingStatus: "processing",
      providerStatus: "processing",
    })
  })

  it("passes absolute signed moderation URLs for original-quality video completion", async () => {
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      status: "live",
      processingStatus: "ready",
      providerStatus: null,
      providerError: null,
      lastCheckedAt: null,
      readyAt: "2026-06-08T16:00:00.000Z",
      moderationStatus: "approved",
      moderationReason: null,
      isLive: true,
    })
    const { POST } = await import(
      "@/app/api/mobile/stories/video-original-complete/route"
    )
    const response = await POST(
      new Request(
        "https://app.example.com/api/mobile/stories/video-original-complete",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.30",
          },
          body: JSON.stringify({
            pathname: "stories/mobile-original/creator_123/story.mov",
            contentType: "video/quicktime",
            byteSize: 8 * 1024 * 1024,
            checksum:
              "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            playbackPathname:
              "stories/mobile-playback/creator_123/story-playback.mp4",
            playbackContentType: "video/mp4",
            playbackByteSize: 4 * 1024 * 1024,
            playbackChecksum:
              "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            playbackDurationMs: 6_500,
            playbackWidth: 1080,
            playbackHeight: 1920,
            playbackRenditions: [
              {
                quality: "1080p",
                pathname: "stories/mobile-playback/creator_123/story-playback.mp4",
                contentType: "video/mp4",
                byteSize: 4 * 1024 * 1024,
                checksum:
                  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                durationMs: 6_500,
                width: 1080,
                height: 1920,
              },
              {
                quality: "720p",
                pathname:
                  "stories/mobile-playback/creator_123/story-playback-720p.mp4",
                contentType: "video/mp4",
                byteSize: 3 * 1024 * 1024,
                checksum:
                  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                durationMs: 6_500,
                width: 720,
                height: 1280,
              },
            ],
            thumbnailPathname:
              "stories/mobile-original/creator_123/story-thumb.jpg",
            thumbnailContentType: "image/jpeg",
            thumbnailByteSize: 42_000,
            thumbnailChecksum:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            durationMs: 6_500,
            width: 1080,
            height: 1920,
            caption: "Original quality",
            brandTags: "OriginalCo",
            textOverlays: "Uploaded raw",
            textOverlayPositionX: "49.00",
            textOverlayPositionY: "65.00",
          }),
        },
      ),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(createOriginalQualityVideoStoryAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "stories/mobile-original/creator_123/story.mov",
        contentType: "video/quicktime",
        playbackPathname: "stories/mobile-playback/creator_123/story-playback.mp4",
        playbackContentType: "video/mp4",
        playbackRenditions: expect.arrayContaining([
          expect.objectContaining({
            quality: "720p",
            pathname:
              "stories/mobile-playback/creator_123/story-playback-720p.mp4",
            checksum:
              "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          }),
        ]),
      }),
    )
    expect(createStory).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: "Original quality",
        explicitBrandTags: ["originalco"],
        moderationMediaUrl:
          "https://app.example.com/api/story-media/stories/mobile-playback/creator_123/story-playback.mp4",
        moderationThumbnailUrl:
          "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
        elements: expect.arrayContaining([
          expect.objectContaining({
            kind: "text",
            label: "Uploaded raw",
            positionX: "49.00",
            positionY: "65.00",
          }),
        ]),
      }),
    )
    expect(payload).toMatchObject({
      ok: true,
      storyId: "22222222-2222-4222-8222-222222222222",
      asset: {
        mediaUrl:
          "https://app.example.com/api/story-media/stories/mobile-playback/creator_123/story-playback.mp4",
        thumbnailUrl:
          "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
        renditions: {
          playbackLadder: [
            expect.objectContaining({
              quality: "1080p",
              mediaUrl:
                "https://app.example.com/api/story-media/stories/mobile-playback/creator_123/story-playback.mp4",
            }),
            expect.objectContaining({
              quality: "720p",
              mediaUrl:
                "https://app.example.com/api/story-media/stories/mobile-playback/creator_123/story-playback-720p.mp4",
            }),
          ],
        },
      },
      processingStatus: "ready",
      providerStatus: null,
      providerError: null,
      readyAt: "2026-06-08T16:00:00.000Z",
    })
  })

  it("reuses an existing original-quality video story when completion is retried", async () => {
    vi.mocked(getStoryByStoredAssetForOwner).mockResolvedValueOnce({
      id: "existing-original-story",
      assetKind: "video",
      mediaUrl:
        "/api/story-media/stories/mobile-playback/creator_123/story-playback.mp4",
      thumbnailUrl:
        "/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      originalMediaUrl:
        "/api/story-media/stories/mobile-original/creator_123/story.mov",
      originalThumbnailUrl:
        "/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      processingStatus: "ready",
    })
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValueOnce({
      id: "existing-original-story",
      status: "live",
      processingStatus: "ready",
      providerStatus: null,
      providerError: null,
      lastCheckedAt: null,
      readyAt: "2026-06-08T16:00:00.000Z",
      moderationStatus: "approved",
      moderationReason: null,
      isLive: true,
    })
    const { POST } = await import(
      "@/app/api/mobile/stories/video-original-complete/route"
    )
    const response = await POST(
      new Request(
        "https://app.example.com/api/mobile/stories/video-original-complete",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.30",
          },
          body: JSON.stringify({
            pathname: "stories/mobile-original/creator_123/story.mov",
            contentType: "video/quicktime",
            byteSize: 8 * 1024 * 1024,
            checksum:
              "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            playbackPathname:
              "stories/mobile-playback/creator_123/story-playback.mp4",
            playbackContentType: "video/mp4",
            playbackByteSize: 4 * 1024 * 1024,
            playbackChecksum:
              "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            playbackDurationMs: 6_500,
            playbackWidth: 1080,
            playbackHeight: 1920,
            thumbnailPathname:
              "stories/mobile-original/creator_123/story-thumb.jpg",
            thumbnailContentType: "image/jpeg",
            thumbnailByteSize: 42_000,
            thumbnailChecksum:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            durationMs: 6_500,
            width: 1080,
            height: 1920,
            caption: "Retry should reuse",
          }),
        },
      ),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(getStoryByStoredAssetForOwner).toHaveBeenCalledWith({
      ownerId: "creator_123",
      storageProvider: "vercel-blob",
      storageKey: "stories/mobile-original/creator_123/story.mov",
    })
    expect(createOriginalQualityVideoStoryAsset).not.toHaveBeenCalled()
    expect(createStory).not.toHaveBeenCalled()
    expect(payload).toMatchObject({
      ok: true,
      storyId: "existing-original-story",
      completionState: "reused",
      asset: {
        mediaUrl:
          "https://app.example.com/api/story-media/stories/mobile-playback/creator_123/story-playback.mp4",
        thumbnailUrl:
          "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      },
      processingStatus: "ready",
      providerStatus: null,
      providerError: null,
    })
  })
})
