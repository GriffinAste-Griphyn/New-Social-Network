import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { getSession } from "@/lib/auth"
import {
  claimMediaUploadSessionForCompletion,
  createMediaUploadSession,
  getReusableMediaUploadSession,
  markMediaUploadSessionCompleted,
  recordCloudflareStreamUploadStatus,
  releaseMediaUploadSessionCompletion,
  retireMediaUploadSession,
} from "@/lib/media-upload-sessions"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  createStory,
  getStoryByStoredAssetForOwner,
  getStoryUploadStatusForOwner,
} from "@/lib/story-store"
import { storyMediaContract } from "@/lib/story-media-contract"
import {
  createCloudflareStreamStoredVideoAsset,
  createCloudflareStreamTusUpload,
  createDirectBlobStoryImageAsset,
  getCloudflareStreamVideoDetails,
  publicStoryMediaUrl,
  removeCloudflareStreamVideoByUid,
  removeStoryAsset,
  removeStoredStoryAsset,
  setCloudflareStreamThumbnailAtDefaultTime,
} from "@/lib/story-storage"

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")

  return {
    ...actual,
    getSession: vi.fn(),
  }
})

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
  getStoryUploadStatusForOwner: vi.fn(),
}))

vi.mock("@/lib/story-storage", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/story-storage")>(
      "@/lib/story-storage",
    )

  return {
    ...actual,
    createCloudflareStreamStoredVideoAsset: vi.fn(),
    createCloudflareStreamTusUpload: vi.fn(),
    createDirectBlobStoryImageAsset: vi.fn(),
    getCloudflareStreamVideoDetails: vi.fn(),
    publicStoryMediaUrl: vi.fn(),
    removeCloudflareStreamVideoByUid: vi.fn(),
    removeStoryAsset: vi.fn(),
    removeStoredStoryAsset: vi.fn(),
    setCloudflareStreamThumbnailAtDefaultTime: vi.fn(),
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

const imageAsset = {
  assetKind: "image" as const,
  mediaUrl: "/api/story-media/stories/web-direct/creator_123/story-display.avif",
  thumbnailUrl: "/api/story-media/stories/web-direct/creator_123/story-thumb.webp",
  placeholderUrl: `thumbhash:${Buffer.alloc(25, 7).toString("base64url")}`,
  storageProvider: "vercel-blob" as const,
  storageKey: "stories/web-direct/creator_123/story-display.avif",
  contentType: "image/avif",
  byteSize: 1234,
  checksum: "a".repeat(64),
  width: 1080,
  height: 1920,
  durationMs: null,
  processingStatus: "ready" as const,
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
      "x-forwarded-for": "203.0.113.40",
    },
    body: JSON.stringify(body),
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("web direct story upload API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STORY_STORAGE_PROVIDER = "vercel-blob"
    vi.mocked(getSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
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
    vi.mocked(getStoryByStoredAssetForOwner).mockResolvedValue(null)
    vi.mocked(generateClientTokenFromReadWriteToken).mockResolvedValue(
      "blob_client_token",
    )
    vi.mocked(createCloudflareStreamTusUpload).mockResolvedValue({
      uid: "11111111111111111111111111111111",
      uploadUrl: "https://upload.cloudflarestream.com/tus/abc",
      uploadProtocol: "tus",
    })
    vi.mocked(createDirectBlobStoryImageAsset).mockResolvedValue(imageAsset)
    vi.mocked(createCloudflareStreamStoredVideoAsset).mockImplementation((input) => ({
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
    }))
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
    vi.mocked(setCloudflareStreamThumbnailAtDefaultTime).mockResolvedValue(undefined)
    vi.mocked(createStory).mockResolvedValue(
      "33333333-3333-4333-8333-333333333333",
    )
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      status: "live",
      processingStatus: "ready",
      hasOriginalRendition: false,
      moderationStatus: "approved",
      moderationReason: null,
      providerStatus: "ready",
      providerPctComplete: 100,
      fullQualityReady: true,
      providerError: null,
      lastCheckedAt: null,
      readyAt: null,
      isLive: true,
    })
    vi.mocked(publicStoryMediaUrl).mockImplementation((value, request) =>
      value && request ? new URL(value, request.url).toString() : value,
    )
    vi.mocked(removeStoryAsset).mockResolvedValue(undefined)
    vi.mocked(removeCloudflareStreamVideoByUid).mockResolvedValue(undefined)
    vi.mocked(removeStoredStoryAsset).mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("prepares a constrained direct Blob image upload", async () => {
    const { POST } = await import("@/app/api/stories/upload/route")
    const response = await POST(
      jsonRequest("/api/stories/upload", {
        assetKind: "image",
        fileName: "story.jpg",
        contentType: "image/jpeg",
        byteSize: 1024,
        displayContentType: "image/avif",
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledTimes(2)
    expect(generateClientTokenFromReadWriteToken).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        maximumSizeInBytes:
          storyMediaContract.upload.maxImageDisplayDerivativeBytes,
      }),
    )
    expect(generateClientTokenFromReadWriteToken).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        maximumSizeInBytes:
          storyMediaContract.upload.maxImageThumbnailDerivativeBytes,
      }),
    )
    expect(payload).toMatchObject({
      ok: true,
      assetKind: "image",
      display: { clientToken: "blob_client_token", contentType: "image/avif" },
      thumbnail: { clientToken: "blob_client_token", contentType: "image/webp" },
    })
    expect(String(payload.basePathname)).toMatch(
      /^stories\/web-direct\/creator_123\/.+$/,
    )
  })

  it("rejects unsupported web image uploads before issuing a Blob token", async () => {
    const { POST } = await import("@/app/api/stories/upload/route")
    const response = await POST(
      jsonRequest("/api/stories/upload", {
        assetKind: "image",
        fileName: "story.gif",
        contentType: "image/gif",
        byteSize: 1024,
      }),
    )

    expect(response.status).toBe(400)
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled()
  })

  it("prepares a Cloudflare TUS upload for web video", async () => {
    const { POST } = await import("@/app/api/stories/upload/route")
    const response = await POST(
      jsonRequest("/api/stories/upload", {
        assetKind: "video",
        fileName: "story.mp4",
        contentType: "video/mp4",
        byteSize: 12 * 1024 * 1024,
      }),
    )

    const payload = await responseJson(response)

    expect(response.status, JSON.stringify(payload)).toBe(200)
    expect(createCloudflareStreamTusUpload).toHaveBeenCalledWith({
      fileName: "story.mp4",
      uploadLengthBytes: 12 * 1024 * 1024,
      maxDurationSeconds: 120,
    })
    expect(payload).toMatchObject({
      ok: true,
      assetKind: "video",
      uploadSessionId: uploadSession.id,
      uid: "11111111111111111111111111111111",
      uploadProtocol: "tus",
    })
  })

  it("uses the same 512 MB video envelope for web and mobile", async () => {
    const { POST } = await import("@/app/api/stories/upload/route")
    const acceptedBytes = 400 * 1024 * 1024
    const accepted = await POST(
      jsonRequest("/api/stories/upload", {
        assetKind: "video",
        fileName: "story.mov",
        contentType: "video/quicktime",
        byteSize: acceptedBytes,
      }),
    )

    expect(accepted.status).toBe(200)
    expect(createCloudflareStreamTusUpload).toHaveBeenCalledWith({
      fileName: "story.mov",
      uploadLengthBytes: acceptedBytes,
      maxDurationSeconds: 120,
    })

    vi.clearAllMocks()
    const oversized = await POST(
      jsonRequest("/api/stories/upload", {
        assetKind: "video",
        fileName: "story.mp4",
        contentType: "video/mp4",
        byteSize: 512 * 1024 * 1024 + 1,
      }),
    )
    expect(oversized.status).toBe(400)
    expect(createCloudflareStreamTusUpload).not.toHaveBeenCalled()
  })

  it("rejects undocumented video containers before creating a provider upload", async () => {
    const { POST } = await import("@/app/api/stories/upload/route")
    const response = await POST(
      jsonRequest("/api/stories/upload", {
        assetKind: "video",
        fileName: "story.avi",
        contentType: "video/x-msvideo",
        byteSize: 12 * 1024 * 1024,
      }),
    )

    expect(response.status).toBe(400)
    expect(createCloudflareStreamTusUpload).not.toHaveBeenCalled()
  })

  it("returns an already-created web replacement when its first response was lost", async () => {
    vi.mocked(getReusableMediaUploadSession).mockResolvedValueOnce(
      replacementUploadSession,
    )
    const { POST } = await import("@/app/api/stories/upload/route")
    const response = await POST(
      jsonRequest("/api/stories/upload", {
        assetKind: "video",
        clientUploadId: replacementUploadSession.clientUploadId,
        replaceUploadSessionId: uploadSession.id,
        fileName: "story.mp4",
        contentType: "video/mp4",
        byteSize: 12 * 1024 * 1024,
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

  it("retires the old web session before issuing the first replacement", async () => {
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
    const { POST } = await import("@/app/api/stories/upload/route")
    const response = await POST(
      jsonRequest("/api/stories/upload", {
        assetKind: "video",
        clientUploadId: oldSession.clientUploadId,
        replaceUploadSessionId: oldSession.id,
        fileName: "story.mp4",
        contentType: "video/mp4",
        byteSize: 12 * 1024 * 1024,
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

  it("completes web video only through the owner-bound upload session", async () => {
    const { POST } = await import("@/app/api/stories/complete/route")
    const response = await POST(
      jsonRequest("/api/stories/complete", {
        assetKind: "video",
        uid: uploadSession.storageKey,
        uploadSessionId: uploadSession.id,
        contentType: "video/mp4",
        byteSize: 12 * 1024 * 1024,
        checksum: "b".repeat(64),
        durationMs: 7_200,
        width: 1080,
        height: 1920,
        caption: "Web video",
      }),
    )

    const payload = await responseJson(response)

    expect(response.status, JSON.stringify(payload)).toBe(200)
    expect(claimMediaUploadSessionForCompletion).toHaveBeenCalledWith({
      ownerUserId: session.id,
      uploadSessionId: uploadSession.id,
      storageProvider: "cloudflare-stream",
      storageKey: uploadSession.storageKey,
      contentType: "video/mp4",
      byteSize: 12 * 1024 * 1024,
    })
    expect(createCloudflareStreamStoredVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({ processingStatus: "processing" }),
    )
    expect(markMediaUploadSessionCompleted).toHaveBeenCalledWith({
      uploadSessionId: uploadSession.id,
      ownerUserId: session.id,
      storyId: "33333333-3333-4333-8333-333333333333",
    })
  })

  it("fails closed instead of using a local storage fallback", async () => {
    process.env.STORY_STORAGE_PROVIDER = "local"
    const { POST } = await import("@/app/api/stories/upload/route")
    const response = await POST(
      jsonRequest("/api/stories/upload", {
        assetKind: "image",
        fileName: "story.jpg",
        contentType: "image/jpeg",
        byteSize: 1024,
      }),
    )

    const payload = await responseJson(response)

    expect(response.status, JSON.stringify(payload)).toBe(503)
    expect(payload.error).toBe(
      "Story uploads require private Vercel Blob storage.",
    )
  })

  it("completes a direct Blob image story", async () => {
    const { POST } = await import("@/app/api/stories/complete/route")
    const response = await POST(
      jsonRequest("/api/stories/complete", {
        assetKind: "image",
        basePathname: "stories/web-direct/creator_123/story",
        displayDerivative: {
          pathname: "stories/web-direct/creator_123/story-display.avif",
          contentType: "image/avif",
          byteSize: 1234,
          checksum: "a".repeat(64),
          width: 1080,
          height: 1920,
        },
        thumbnailDerivative: {
          pathname: "stories/web-direct/creator_123/story-thumb.webp",
          contentType: "image/webp",
          byteSize: 456,
          checksum: "b".repeat(64),
          width: 360,
          height: 640,
        },
        thumbHash: Buffer.alloc(25, 7).toString("base64url"),
        caption: "Direct image",
        brandTags: "CoffeeCo",
      }),
    )

    const completedPayload = await responseJson(response)

    expect(response.status, JSON.stringify(completedPayload)).toBe(200)
    expect(createDirectBlobStoryImageAsset).toHaveBeenCalledWith({
      basePathname: "stories/web-direct/creator_123/story",
      ownerUserId: "creator_123",
      displayDerivative: {
        pathname: "stories/web-direct/creator_123/story-display.avif",
        contentType: "image/avif",
        byteSize: 1234,
        checksum: "a".repeat(64),
        width: 1080,
        height: 1920,
      },
      thumbnailDerivative: {
        pathname: "stories/web-direct/creator_123/story-thumb.webp",
        contentType: "image/webp",
        byteSize: 456,
        checksum: "b".repeat(64),
        width: 360,
        height: 640,
      },
      thumbHash: Buffer.alloc(25, 7).toString("base64url"),
    })
    expect(createStory).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: "Direct image",
        explicitBrandTags: ["coffeeco"],
        storedAsset: imageAsset,
      }),
    )
    expect(completedPayload).toMatchObject({
      ok: true,
      storyId: "33333333-3333-4333-8333-333333333333",
      asset: {
        assetKind: "image",
        thumbnailUrl:
          "https://app.example.com/api/story-media/stories/web-direct/creator_123/story-thumb.webp",
      },
    })
  })

  it("cleans up uploaded media if direct image completion fails", async () => {
    vi.mocked(createStory).mockRejectedValue(new Error("database unavailable"))
    const { POST } = await import("@/app/api/stories/complete/route")
    const response = await POST(
      jsonRequest("/api/stories/complete", {
        assetKind: "image",
        basePathname: "stories/web-direct/creator_123/story",
        displayDerivative: {
          pathname: "stories/web-direct/creator_123/story-display.avif",
          contentType: "image/avif",
          byteSize: 1234,
          checksum: "a".repeat(64),
          width: 1080,
          height: 1920,
        },
        thumbnailDerivative: {
          pathname: "stories/web-direct/creator_123/story-thumb.webp",
          contentType: "image/webp",
          byteSize: 456,
          checksum: "b".repeat(64),
          width: 360,
          height: 640,
        },
        thumbHash: Buffer.alloc(25, 7).toString("base64url"),
      }),
    )

    expect(response.status).toBe(400)
    expect(removeStoredStoryAsset).toHaveBeenCalledWith(imageAsset)
  })
})
