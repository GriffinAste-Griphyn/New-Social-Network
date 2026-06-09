import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { getSession } from "@/lib/auth"
import { enforceRequestRateLimits } from "@/lib/request-security"
import { createStory, getStoryUploadStatusForOwner } from "@/lib/story-store"
import {
  createCloudflareStreamStoredVideoAsset,
  createCloudflareStreamTusUpload,
  createDirectBlobStoryImageAsset,
  getCloudflareStreamVideoDetails,
  publicStoryMediaUrl,
  removeStoryAsset,
  setCloudflareStreamThumbnailToLastFrame,
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

vi.mock("@/lib/story-store", () => ({
  createStory: vi.fn(),
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

const imageAsset = {
  assetKind: "image" as const,
  mediaUrl: "/api/story-media/stories/web-direct/creator_123/story.jpg",
  thumbnailUrl: "/api/story-media/stories/web-direct/creator_123/story-thumb.jpg",
  storageProvider: "vercel-blob" as const,
  storageKey: "stories/web-direct/creator_123/story.jpg",
  contentType: "image/jpeg",
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
      errorReason: null,
      byteSize: null,
      durationMs: null,
      width: null,
      height: null,
    })
    vi.mocked(setCloudflareStreamThumbnailToLastFrame).mockResolvedValue(undefined)
    vi.mocked(createStory).mockResolvedValue(
      "33333333-3333-4333-8333-333333333333",
    )
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      status: "live",
      processingStatus: "ready",
      moderationStatus: "approved",
      moderationReason: null,
      providerStatus: "ready",
      providerError: null,
      lastCheckedAt: null,
      readyAt: null,
      isLive: true,
    })
    vi.mocked(publicStoryMediaUrl).mockImplementation((value, request) =>
      value && request ? new URL(value, request.url).toString() : value,
    )
    vi.mocked(removeStoryAsset).mockResolvedValue(undefined)
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
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedContentTypes: ["image/jpeg"],
        maximumSizeInBytes: 25 * 1024 * 1024,
        allowOverwrite: false,
      }),
    )
    expect(payload).toMatchObject({
      ok: true,
      assetKind: "image",
      clientToken: "blob_client_token",
      contentType: "image/jpeg",
    })
    expect(String(payload.pathname)).toMatch(
      /^stories\/web-direct\/creator_123\/.+\.jpg$/,
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
      uid: "11111111111111111111111111111111",
      uploadProtocol: "tus",
    })
  })

  it("falls back to the legacy multipart path for local storage", async () => {
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

    expect(response.status, JSON.stringify(payload)).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      assetKind: "image",
      uploadProtocol: "legacy",
    })
  })

  it("completes a direct Blob image story", async () => {
    const { POST } = await import("@/app/api/stories/complete/route")
    const response = await POST(
      jsonRequest("/api/stories/complete", {
        assetKind: "image",
        pathname: "stories/web-direct/creator_123/story.jpg",
        contentType: "image/jpeg",
        byteSize: 1234,
        checksum: "a".repeat(64),
        width: 1080,
        height: 1920,
        caption: "Direct image",
        brandTags: "CoffeeCo",
      }),
    )

    const completedPayload = await responseJson(response)

    expect(response.status, JSON.stringify(completedPayload)).toBe(200)
    expect(createDirectBlobStoryImageAsset).toHaveBeenCalledWith({
      pathname: "stories/web-direct/creator_123/story.jpg",
      ownerUserId: "creator_123",
      contentType: "image/jpeg",
      byteSize: 1234,
      checksum: "a".repeat(64),
      width: 1080,
      height: 1920,
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
          "https://app.example.com/api/story-media/stories/web-direct/creator_123/story-thumb.jpg",
      },
    })
  })

  it("cleans up uploaded media if direct image completion fails", async () => {
    vi.mocked(createStory).mockRejectedValue(new Error("database unavailable"))
    const { POST } = await import("@/app/api/stories/complete/route")
    const response = await POST(
      jsonRequest("/api/stories/complete", {
        assetKind: "image",
        pathname: "stories/web-direct/creator_123/story.jpg",
        contentType: "image/jpeg",
        byteSize: 1234,
        checksum: "a".repeat(64),
      }),
    )

    expect(response.status).toBe(400)
    expect(removeStoryAsset).toHaveBeenCalledWith(imageAsset.mediaUrl)
  })
})
