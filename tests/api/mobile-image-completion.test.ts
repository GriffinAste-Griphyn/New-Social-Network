import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  headCloudflareR2Original,
  isCloudflareR2StoryImageStorageEnabled,
} from "@/lib/cloudflare-r2"
import { getDb } from "@/lib/db"
import { enqueueImageProcessing } from "@/lib/image-processing-jobs"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  createImageProcessingStoredAsset,
  createServerEncodedStoryImageAsset,
} from "@/lib/story-image-processing"
import {
  createStory,
  getStoryTextOverlaysForOwner,
  getStoryUploadStatusForOwner,
} from "@/lib/story-store"
import {
  createDirectBlobStoryImageAsset,
  publicStoryMediaUrl,
  removeStoredStoryAsset,
} from "@/lib/story-storage"

vi.mock("@/lib/auth", () => ({ getCompleteMobileSession: vi.fn() }))
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
vi.mock("@/lib/image-processing-jobs", () => ({
  enqueueImageProcessing: vi.fn(),
}))
vi.mock("@/lib/cloudflare-r2", () => ({
  headCloudflareR2Original: vi.fn(),
  isCloudflareR2StoryImageStorageEnabled: vi.fn(),
}))
vi.mock("@/lib/request-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/request-security")>(
    "@/lib/request-security",
  )
  return { ...actual, enforceRequestRateLimits: vi.fn() }
})
vi.mock("@/lib/story-store", () => ({
  createStory: vi.fn(),
  getStoryTextOverlaysForOwner: vi.fn(),
  getStoryUploadStatusForOwner: vi.fn(),
}))
vi.mock("@/lib/story-image-processing", () => ({
  createImageProcessingStoredAsset: vi.fn(),
  createServerEncodedStoryImageAsset: vi.fn(),
}))
vi.mock("@/lib/story-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/story-storage")>(
    "@/lib/story-storage",
  )
  return {
    ...actual,
    createDirectBlobStoryImageAsset: vi.fn(),
    publicStoryMediaUrl: vi.fn(),
    removeStoredStoryAsset: vi.fn(),
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
  mediaUrl: "/api/story-media/stories/web-direct/creator_123/story-display.avif",
  thumbnailUrl:
    "/api/story-media/stories/web-direct/creator_123/story-thumb.webp",
  placeholderUrl: `thumbhash:${Buffer.alloc(25, 7).toString("base64url")}`,
  storageProvider: "vercel-blob" as const,
  storageKey: "stories/web-direct/creator_123/story-display.avif",
  contentType: "image/avif",
  byteSize: 1_234,
  checksum: "a".repeat(64),
  width: 1080,
  height: 1920,
  durationMs: null,
  processingStatus: "ready" as const,
}

const uploadStartedAt = new Date()
const reservedBasePathname = `stories/web-direct/creator_123/${uploadStartedAt.getTime()}-11111111-1111-4111-8111-111111111111`

function completionRequest(
  overrides: Record<string, unknown> = {},
  clientBuild?: number,
) {
  return new Request("https://app.example.com/api/mobile/stories/image-complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(clientBuild ? { "x-ubeye-app-build": String(clientBuild) } : {}),
    },
    body: JSON.stringify({
      basePathname: reservedBasePathname,
      displayDerivative: {
        pathname: `${reservedBasePathname}-display.avif`,
        contentType: "image/avif",
        byteSize: 1_234,
        checksum: "a".repeat(64),
        width: 1080,
        height: 1920,
      },
      thumbnailDerivative: {
        pathname: `${reservedBasePathname}-thumb.webp`,
        contentType: "image/webp",
        byteSize: 456,
        checksum: "b".repeat(64),
        width: 360,
        height: 640,
      },
      thumbHash: Buffer.alloc(25, 7).toString("base64url"),
      caption: "",
      brandTags: "",
      stickers: "",
      textOverlays: "",
      linkLabel: "",
      linkUrl: "",
      quoteReplyId: "",
      ...overrides,
    }),
  })
}

describe("mobile image completion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MEDIA_ASYNC_COMPLETION_ENABLED = "false"
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(isCloudflareR2StoryImageStorageEnabled).mockReturnValue(false)
    vi.mocked(headCloudflareR2Original).mockResolvedValue({
      ContentLength: 2_048,
      ContentType: "image/jpeg",
    } as never)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(createDirectBlobStoryImageAsset).mockResolvedValue(imageAsset)
    vi.mocked(createImageProcessingStoredAsset).mockReturnValue(imageAsset)
    vi.mocked(createServerEncodedStoryImageAsset).mockResolvedValue(imageAsset)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ mediaAssetId: "media-image-1" }],
          }),
        }),
      }),
      update: () => ({
        set: () => ({ where: async () => undefined }),
      }),
    } as never)
    vi.mocked(enqueueImageProcessing).mockResolvedValue({
      jobId: "image-job-1",
      runId: "run-1",
    } as never)
    vi.mocked(publicStoryMediaUrl).mockImplementation((value) => value)
    vi.mocked(removeStoredStoryAsset).mockResolvedValue(undefined)
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue(null)
    vi.mocked(getStoryTextOverlaysForOwner).mockResolvedValue([])
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("returns an actionable validation error and cleans up uploaded variants", async () => {
    const { POST } = await import(
      "@/app/api/mobile/stories/image-complete/route"
    )
    const response = await POST(
      completionRequest({ textOverlays: "x".repeat(221) }),
    )
    const payload = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(payload.code).toBe("invalid_story_details")
    expect(payload.error).toContain("220 characters")
    expect(createStory).not.toHaveBeenCalled()
    expect(removeStoredStoryAsset).toHaveBeenCalledWith(imageAsset)
  })

  it("reports unexpected publication failures as server errors", async () => {
    vi.mocked(createStory).mockRejectedValue(new Error("database unavailable"))
    const { POST } = await import(
      "@/app/api/mobile/stories/image-complete/route"
    )
    const response = await POST(completionRequest())
    const payload = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(payload.code).toBe("story_completion_failed")
    expect(payload.error).toBe("Could not publish the story. Try again.")
    expect(removeStoredStoryAsset).toHaveBeenCalledWith(imageAsset)
  })

  it("creates the story with the time reserved when its upload started", async () => {
    vi.mocked(createStory).mockResolvedValue(
      "22222222-2222-4222-8222-222222222222",
    )
    const { POST } = await import(
      "@/app/api/mobile/stories/image-complete/route"
    )

    const response = await POST(completionRequest())

    expect(response.status).toBe(200)
    expect(createStory).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: uploadStartedAt }),
    )
  })

  it("uses the server encoder when the client uploads one raw source", async () => {
    vi.mocked(createStory).mockResolvedValue(
      "22222222-2222-4222-8222-222222222222",
    )
    const sourceUpload = {
      pathname: `${reservedBasePathname}-source.jpg`,
      contentType: "image/jpeg",
      byteSize: 2_048,
      checksum: "c".repeat(64),
      width: 1200,
      height: 2000,
    }
    const { POST } = await import(
      "@/app/api/mobile/stories/image-complete/route"
    )

    const response = await POST(completionRequest({ sourceUpload }))

    expect(response.status).toBe(200)
    expect(createServerEncodedStoryImageAsset).toHaveBeenCalledWith({
      basePathname: reservedBasePathname,
      ownerUserId: session.id,
      contentMode: "fit",
      storageProvider: "vercel-blob",
      source: sourceUpload,
    })
    expect(createDirectBlobStoryImageAsset).not.toHaveBeenCalled()
  })

  it("queues Cloudflare R2 originals without blocking on image encoding", async () => {
    process.env.VERCEL_BLOB_SUSPENDED_MODE = "true"
    process.env.MEDIA_ASYNC_COMPLETION_ENABLED = "true"
    vi.mocked(isCloudflareR2StoryImageStorageEnabled).mockReturnValue(true)
    vi.mocked(createStory).mockResolvedValue(
      "22222222-2222-4222-8222-222222222222",
    )
    const sourceUpload = {
      pathname: `${reservedBasePathname}-source.jpg`,
      contentType: "image/jpeg",
      byteSize: 2_048,
      checksum: "c".repeat(64),
      width: 1200,
      height: 2000,
    }
    const { POST } = await import(
      "@/app/api/mobile/stories/image-complete/route"
    )

    const response = await POST(
      completionRequest({
        storageProvider: "cloudflare-r2",
        sourceUpload,
        contentMode: "fit",
      }, 400),
    )

    expect(response.status).toBe(200)
    expect(createServerEncodedStoryImageAsset).not.toHaveBeenCalled()
    expect(createImageProcessingStoredAsset).toHaveBeenCalledWith({
      storageProvider: "cloudflare-r2",
      source: sourceUpload,
      width: sourceUpload.width,
      height: sourceUpload.height,
    })
    expect(enqueueImageProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaAssetId: "media-image-1",
        contentMode: "fit",
      }),
    )
  })

  it("preserves fit requests during server encoding", async () => {
    vi.mocked(createStory).mockResolvedValue(
      "22222222-2222-4222-8222-222222222222",
    )
    const sourceUpload = {
      pathname: `${reservedBasePathname}-source.jpg`,
      contentType: "image/jpeg",
      byteSize: 2_048,
      checksum: "c".repeat(64),
      width: 1200,
      height: 2000,
    }
    const { POST } = await import(
      "@/app/api/mobile/stories/image-complete/route"
    )

    const response = await POST(
      completionRequest({ sourceUpload, contentMode: "fit" }),
    )

    expect(response.status).toBe(200)
    expect(createServerEncodedStoryImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({ contentMode: "fit" }),
    )
  })
})
