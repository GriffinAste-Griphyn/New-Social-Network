import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { getCompleteMobileSession } from "@/lib/auth"
import {
  claimMediaUploadSessionForCompletion,
  createMediaUploadSession,
  getReusableMediaUploadSession,
  markMediaUploadSessionCompleted,
  MediaUploadSessionError,
  recordCloudflareStreamUploadStatus,
  releaseMediaUploadSessionCompletion,
  retireMediaUploadSession,
} from "@/lib/media-upload-sessions"
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
  removeCloudflareStreamVideoByUid,
  setCloudflareStreamThumbnailToLastFrame,
} from "@/lib/story-storage"

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: vi.fn(),
}))

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

vi.mock("@/lib/media-upload-sessions", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/media-upload-sessions")>(
      "@/lib/media-upload-sessions",
    )

  return {
    ...actual,
    claimMediaUploadSessionForCompletion: vi.fn(),
    createMediaUploadSession: vi.fn(),
    getReusableMediaUploadSession: vi.fn(),
    markMediaUploadSessionCompleted: vi.fn(),
    recordCloudflareStreamUploadStatus: vi.fn(),
    releaseMediaUploadSessionCompletion: vi.fn(),
    retireMediaUploadSession: vi.fn(),
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
    removeCloudflareStreamVideoByUid: vi.fn(),
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
const originalEnv = { ...process.env }

const uploadSession = {
  id: "upload-11111111-1111-4111-8111-111111111111",
  ownerUserId: session.id,
  purpose: "story" as const,
  assetKind: "video" as const,
  storageProvider: "cloudflare-stream" as const,
  storageKey: "11111111111111111111111111111111",
  clientUploadId: null,
  uploadUrl: "https://upload.cloudflarestream.com/tus/abc",
  uploadProtocol: "tus",
  expectedContentType: "video/mp4",
  expectedByteSize: 12 * 1024 * 1024,
  maxDurationSeconds: 120,
  status: "prepared",
  providerStatus: null,
  providerPctComplete: null,
  providerError: null,
  providerPayload: null,
  providerEventAt: null,
  completedMediaAssetId: null,
  completedStoryId: null,
  completionClaimedAt: null,
  consumedAt: null,
  expiresAt: new Date("2026-07-10T00:00:00.000Z"),
  createdAt: new Date("2026-07-09T00:00:00.000Z"),
  updatedAt: new Date("2026-07-09T00:00:00.000Z"),
}
const replacementUploadSession = {
  ...uploadSession,
  id: "upload-22222222-2222-4222-8222-222222222222",
  storageKey: "22222222222222222222222222222222",
  clientUploadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  uploadUrl: "https://upload.cloudflarestream.com/tus/replacement",
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
    process.env.ALLOW_LEGACY_ORIGINAL_VIDEO_UPLOADS = "true"
    vi.mocked(getReusableMediaUploadSession).mockResolvedValue(null)
    vi.mocked(createMediaUploadSession).mockResolvedValue(uploadSession)
    vi.mocked(claimMediaUploadSessionForCompletion).mockResolvedValue({
      state: "claimed",
      session: uploadSession,
    })
    vi.mocked(markMediaUploadSessionCompleted).mockResolvedValue(undefined)
    vi.mocked(recordCloudflareStreamUploadStatus).mockResolvedValue(
      uploadSession,
    )
    vi.mocked(releaseMediaUploadSessionCompletion).mockResolvedValue(undefined)
    vi.mocked(retireMediaUploadSession).mockResolvedValue({
      storageKey: uploadSession.storageKey,
    })
    vi.mocked(generateClientTokenFromReadWriteToken).mockResolvedValue(
      "mobile_blob_client_token",
    )
    vi.mocked(createStory).mockResolvedValue(
      "22222222-2222-4222-8222-222222222222",
    )
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      status: "processing",
      processingStatus: "processing",
      hasOriginalRendition: false,
      providerStatus: "processing",
      providerPctComplete: null,
      fullQualityReady: false,
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
      mediaUrl: "/api/story-media/stories/mobile-original/creator_123/story.mov",
      thumbnailUrl:
        "/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      storageProvider: "vercel-blob",
      storageKey: "stories/mobile-original/creator_123/story.mov",
      contentType: "video/quicktime",
      byteSize: 8 * 1024 * 1024,
      checksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      width: 1080,
      height: 1920,
      durationMs: 6_500,
      processingStatus: "ready",
    })
    vi.mocked(getCloudflareStreamVideoDetails).mockResolvedValue({
      readyToStream: false,
      state: "processing",
      pctComplete: null,
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
    vi.mocked(removeCloudflareStreamVideoByUid).mockResolvedValue(undefined)
    vi.mocked(setCloudflareStreamThumbnailToLastFrame).mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("prepares a direct mobile Blob image upload", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob_rw_token"
    const { POST } = await import("@/app/api/mobile/stories/image-upload/route")
    const response = await POST(
      new Request("https://app.example.com/api/mobile/stories/image-upload", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.30",
        },
        body: JSON.stringify({
          fileName: "story.jpg",
          contentType: "image/jpeg",
          byteSize: 1024,
        }),
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedContentTypes: ["image/jpeg"],
        maximumSizeInBytes: 25 * 1024 * 1024,
        allowOverwrite: false,
        cacheControlMaxAge: 60 * 60 * 24 * 30,
      }),
    )
    expect(payload).toMatchObject({
      ok: true,
      clientToken: "mobile_blob_client_token",
      contentType: "image/jpeg",
      maxSizeBytes: 25 * 1024 * 1024,
    })
    expect(String(payload.pathname)).toMatch(
      /^stories\/web-direct\/creator_123\/.+\.jpg$/,
    )
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
      uploadSessionId: uploadSession.id,
      uid: "11111111111111111111111111111111",
      uploadProtocol: "tus",
    })
    expect(createMediaUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: session.id,
        storageProvider: "cloudflare-stream",
        storageKey: "11111111111111111111111111111111",
        expectedByteSize: 12 * 1024 * 1024,
      }),
    )
  })

  it("reuses a prepared provider upload after a lost prepare response", async () => {
    const clientUploadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    vi.mocked(getReusableMediaUploadSession).mockResolvedValueOnce({
      ...uploadSession,
      clientUploadId,
    })

    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(
      jsonRequest({
        clientUploadId,
        fileName: "story.mp4",
        contentType: "video/mp4",
        byteSize: 12 * 1024 * 1024,
        maxDurationSeconds: 120,
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      uploadSessionId: uploadSession.id,
      uid: uploadSession.storageKey,
      uploadUrl: uploadSession.uploadUrl,
    })
    expect(createCloudflareStreamTusUpload).not.toHaveBeenCalled()
    expect(createMediaUploadSession).not.toHaveBeenCalled()
  })

  it("returns an already-created replacement when its first prepare response was lost", async () => {
    vi.mocked(getReusableMediaUploadSession).mockResolvedValueOnce(
      replacementUploadSession,
    )
    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(
      jsonRequest({
        clientUploadId: replacementUploadSession.clientUploadId,
        replaceUploadSessionId: uploadSession.id,
        fileName: "story.mp4",
        contentType: "video/mp4",
        byteSize: 12 * 1024 * 1024,
        maxDurationSeconds: 120,
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      uploadSessionId: replacementUploadSession.id,
      uid: replacementUploadSession.storageKey,
      uploadUrl: replacementUploadSession.uploadUrl,
    })
    expect(retireMediaUploadSession).not.toHaveBeenCalled()
    expect(createCloudflareStreamTusUpload).not.toHaveBeenCalled()
    expect(createMediaUploadSession).not.toHaveBeenCalled()
    expect(removeCloudflareStreamVideoByUid).not.toHaveBeenCalled()
  })

  it("retires the old mobile session before issuing the first replacement", async () => {
    const oldSession = {
      ...uploadSession,
      clientUploadId: replacementUploadSession.clientUploadId,
    }
    vi.mocked(getReusableMediaUploadSession).mockResolvedValueOnce(oldSession)
    vi.mocked(createCloudflareStreamTusUpload).mockResolvedValueOnce({
      uid: replacementUploadSession.storageKey,
      uploadUrl: replacementUploadSession.uploadUrl,
      uploadProtocol: "tus",
    })
    vi.mocked(createMediaUploadSession).mockResolvedValueOnce(
      replacementUploadSession,
    )
    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(
      jsonRequest({
        clientUploadId: oldSession.clientUploadId,
        replaceUploadSessionId: oldSession.id,
        fileName: "story.mp4",
        contentType: "video/mp4",
        byteSize: 12 * 1024 * 1024,
        maxDurationSeconds: 120,
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      uploadSessionId: replacementUploadSession.id,
      uid: replacementUploadSession.storageKey,
    })
    expect(retireMediaUploadSession).toHaveBeenCalledWith({
      ownerUserId: session.id,
      clientUploadId: oldSession.clientUploadId,
      uploadSessionId: oldSession.id,
    })
    expect(removeCloudflareStreamVideoByUid).toHaveBeenCalledWith(
      oldSession.storageKey,
    )
    expect(createCloudflareStreamTusUpload).toHaveBeenCalledTimes(1)
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
    expect(markMediaUploadSessionCompleted).toHaveBeenCalledWith({
      uploadSessionId: uploadSession.id,
      ownerUserId: session.id,
      storyId: "22222222-2222-4222-8222-222222222222",
    })
  })

  it("rejects completion when the provider upload lease belongs to another user", async () => {
    vi.mocked(claimMediaUploadSessionForCompletion).mockRejectedValueOnce(
      new MediaUploadSessionError(
        "This video upload belongs to a different session.",
        403,
      ),
    )
    const { POST } = await import("@/app/api/mobile/stories/video-complete/route")
    const response = await POST(
      new Request("https://app.example.com/api/mobile/stories/video-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uid: uploadSession.storageKey,
          uploadSessionId: "upload-owned-by-someone-else",
          contentType: "video/mp4",
          byteSize: 12 * 1024 * 1024,
          caption: "Must not publish",
        }),
      }),
    )

    expect(response.status).toBe(403)
    expect(await responseJson(response)).toMatchObject({
      error: "This video upload belongs to a different session.",
    })
    expect(createStory).not.toHaveBeenCalled()
  })

  it("keeps a merely playable provider video processing until encoding reaches 100 percent", async () => {
    vi.mocked(getCloudflareStreamVideoDetails).mockResolvedValueOnce({
      readyToStream: true,
      state: "ready",
      pctComplete: 67,
      errorReason: null,
      byteSize: 12 * 1024 * 1024,
      durationMs: 7_200,
      width: 1080,
      height: 1920,
    })
    const { POST } = await import("@/app/api/mobile/stories/video-complete/route")
    const response = await POST(
      new Request("https://app.example.com/api/mobile/stories/video-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uid: uploadSession.storageKey,
          uploadSessionId: uploadSession.id,
          contentType: "video/mp4",
          byteSize: 12 * 1024 * 1024,
          caption: "Wait for full quality",
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(createCloudflareStreamStoredVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: "processing",
        providerPctComplete: 67,
      }),
    )
  })

  it("signals the client to replace a terminal provider upload", async () => {
    vi.mocked(getCloudflareStreamVideoDetails).mockResolvedValueOnce({
      readyToStream: false,
      state: "error",
      pctComplete: 42,
      errorReason: "Video encoding failed.",
      byteSize: null,
      durationMs: null,
      width: null,
      height: null,
    })
    const { POST } = await import("@/app/api/mobile/stories/video-complete/route")
    const response = await POST(
      new Request("https://app.example.com/api/mobile/stories/video-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uid: uploadSession.storageKey,
          uploadSessionId: uploadSession.id,
          contentType: "video/mp4",
          byteSize: 12 * 1024 * 1024,
        }),
      }),
    )

    expect(response.status).toBe(410)
    expect(await responseJson(response)).toMatchObject({
      error: "Video encoding failed.",
    })
    expect(releaseMediaUploadSessionCompletion).toHaveBeenCalledWith({
      uploadSessionId: uploadSession.id,
      ownerUserId: session.id,
    })
    expect(createStory).not.toHaveBeenCalled()
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
      hasOriginalRendition: false,
      providerStatus: null,
      providerPctComplete: null,
      fullQualityReady: true,
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
      }),
    )
    expect(createStory).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: "Original quality",
        explicitBrandTags: ["originalco"],
        moderationMediaUrl:
          "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story.mov",
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
          "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story.mov",
        thumbnailUrl:
          "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      },
      processingStatus: "ready",
      providerStatus: null,
      providerError: null,
      readyAt: "2026-06-08T16:00:00.000Z",
    })
  })

  it("retires the progressive original-video story path for hls-v2 clients", async () => {
    const { POST } = await import(
      "@/app/api/mobile/stories/video-original-upload/route"
    )
    const response = await POST(
      new Request(
        "https://app.example.com/api/mobile/stories/video-original-upload",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-UBEYE-Media-Pipeline": "hls-v2",
          },
          body: JSON.stringify({
            fileName: "story.mov",
            contentType: "video/quicktime",
            byteSize: 8 * 1024 * 1024,
            maxDurationSeconds: 120,
          }),
        },
      ),
    )

    expect(response.status).toBe(410)
    expect(await responseJson(response)).toMatchObject({
      code: "legacy_video_path_retired",
    })
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled()
  })

  it("reuses an existing original-quality video story when completion is retried", async () => {
    vi.mocked(getStoryByStoredAssetForOwner).mockResolvedValueOnce({
      id: "existing-original-story",
      assetKind: "video",
      mediaUrl: "/api/story-media/stories/mobile-original/creator_123/story.mov",
      thumbnailUrl:
        "/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      processingStatus: "ready",
    })
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValueOnce({
      id: "existing-original-story",
      status: "live",
      processingStatus: "ready",
      hasOriginalRendition: false,
      providerStatus: null,
      providerPctComplete: null,
      fullQualityReady: true,
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
          "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story.mov",
        thumbnailUrl:
          "https://app.example.com/api/story-media/stories/mobile-original/creator_123/story-thumb.jpg",
      },
      processingStatus: "ready",
      providerStatus: null,
      providerError: null,
    })
  })
})
