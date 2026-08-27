import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { enforceRequestRateLimits } from "@/lib/request-security"
import { createServerEncodedStoryImageAsset } from "@/lib/story-image-processing"
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

function completionRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://app.example.com/api/mobile/stories/image-complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(createDirectBlobStoryImageAsset).mockResolvedValue(imageAsset)
    vi.mocked(createServerEncodedStoryImageAsset).mockResolvedValue(imageAsset)
    vi.mocked(publicStoryMediaUrl).mockImplementation((value) => value)
    vi.mocked(removeStoredStoryAsset).mockResolvedValue(undefined)
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue(null)
    vi.mocked(getStoryTextOverlaysForOwner).mockResolvedValue([])
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
      source: sourceUpload,
    })
    expect(createDirectBlobStoryImageAsset).not.toHaveBeenCalled()
  })

  it("forces fit-only server encoding when an older client requests fill", async () => {
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
      completionRequest({ sourceUpload, contentMode: "fill" }),
    )

    expect(response.status).toBe(200)
    expect(createServerEncodedStoryImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({ contentMode: "fit" }),
    )
  })
})
