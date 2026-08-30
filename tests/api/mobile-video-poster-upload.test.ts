import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { getCompleteMobileSession } from "@/lib/auth"
import {
  createMediaUploadSession,
  getReusableMediaUploadSession,
} from "@/lib/media-upload-sessions"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  createCloudflareStreamTusUpload,
  directStoryVideoPosterPathname,
} from "@/lib/story-storage"

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: vi.fn(),
}))

vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
}))

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
  createMediaUploadSession: vi.fn(),
  getReusableMediaUploadSession: vi.fn(),
  MediaUploadSessionError: class MediaUploadSessionError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message)
    }
  },
  retireMediaUploadSession: vi.fn(),
}))

vi.mock("@/lib/story-storage", () => ({
  createCloudflareStreamTusUpload: vi.fn(),
  directStoryVideoPosterPathname: vi.fn(
    (uid: string) => `stories/video-posters/${uid}-poster.jpg`,
  ),
  maxStoryVideoPosterUploadBytes: 2 * 1024 * 1024,
  maxStoryVideoUploadBytes: 512 * 1024 * 1024,
  removeCloudflareStreamVideoByUid: vi.fn(),
  removeDirectBlobStoryVideoPoster: vi.fn(),
  StoryUploadError: class StoryUploadError extends Error {},
}))

const originalEnv = { ...process.env }
const uid = "f".repeat(32)

function uploadRequest(input?: { build?: number; pipeline?: string; byteSize?: number }) {
  const headers = new Headers({ "content-type": "application/json" })
  if (input?.build !== undefined) {
    headers.set("x-ubeye-app-build", String(input.build))
  }
  if (input?.pipeline) {
    headers.set("x-ubeye-media-pipeline", input.pipeline)
  }
  return new Request("https://app.example.com/api/mobile/stories/video-upload", {
    method: "POST",
    headers,
    body: JSON.stringify({
      clientUploadId: "d8f95cd5-a079-47ef-b46b-4122f40ce766",
      fileName: "story.mp4",
      contentType: "video/mp4",
      byteSize: input?.byteSize ?? 4_096,
      maxDurationSeconds: 120,
    }),
  })
}

describe("mobile video poster upload preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STORY_STORAGE_PROVIDER = "vercel-blob"
    process.env.STORY_VIDEO_PROCESSOR = "cloudflare-stream"
    process.env.MEDIA_PIPELINE_ENABLED = "false"
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test"
    vi.mocked(getCompleteMobileSession).mockResolvedValue({ id: "creator-1" } as never)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(getReusableMediaUploadSession).mockResolvedValue(null)
    vi.mocked(createCloudflareStreamTusUpload).mockResolvedValue({
      uid,
      uploadUrl: "https://upload.cloudflare.example/tus",
      uploadProtocol: "tus",
    })
    vi.mocked(createMediaUploadSession).mockResolvedValue({
      id: "upload-123",
      storageKey: uid,
      uploadUrl: "https://upload.cloudflare.example/tus",
      uploadProtocol: "tus",
    } as never)
    vi.mocked(generateClientTokenFromReadWriteToken).mockResolvedValue(
      "poster-client-token",
    )
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("returns a private retry-safe poster target with every TUS session", async () => {
    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(uploadRequest({ build: 389, pipeline: "hls-v4" }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.poster).toMatchObject({
      pathname: `stories/video-posters/${uid}-poster.jpg`,
      contentType: "image/jpeg",
      access: "private",
      clientToken: "poster-client-token",
    })
    expect(directStoryVideoPosterPathname).toHaveBeenCalledWith(uid)
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: `stories/video-posters/${uid}-poster.jpg`,
        allowOverwrite: true,
        addRandomSuffix: false,
      }),
    )
  })

  it("fails before allocating Cloudflare media when private poster storage is unavailable", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(uploadRequest({ build: 389, pipeline: "hls-v4" }))

    expect(response.status).toBe(503)
    expect(createCloudflareStreamTusUpload).not.toHaveBeenCalled()
  })

  it("issues an owner-bound private Blob source when the custom pipeline is enabled", async () => {
    process.env.STORY_VIDEO_PROCESSOR = "vercel-hls"
    process.env.MEDIA_PIPELINE_ENABLED = "true"
    vi.mocked(createMediaUploadSession).mockImplementation(async (input) => ({
      id: "upload-custom",
      storageKey: input.storageKey,
      uploadUrl: input.uploadUrl,
      uploadProtocol: input.uploadProtocol,
    }) as never)

    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(uploadRequest({ build: 389, pipeline: "hls-v4" }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.uploadProtocol).toBe("vercel-blob")
    expect(payload.uid).toMatch(/^media-originals\/creator-1\//)
    expect(payload.source).toMatchObject({
      pathname: payload.uid,
      contentType: "video/mp4",
      access: "private",
    })
    expect(createMediaUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        storageProvider: "vercel-blob",
        uploadProtocol: "vercel-blob",
      }),
    )
    expect(createCloudflareStreamTusUpload).not.toHaveBeenCalled()
  })

  it("keeps a bounded Cloudflare fallback for installed clients without the Vercel protocol", async () => {
    process.env.STORY_VIDEO_PROCESSOR = "vercel-hls"
    process.env.MEDIA_PIPELINE_ENABLED = "true"

    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(uploadRequest({ build: 352, pipeline: "hls-v1" }))

    expect(response.status).toBe(200)
    expect(createCloudflareStreamTusUpload).toHaveBeenCalledWith(
      expect.objectContaining({ allowLegacyClientFallback: true }),
    )
    expect(createMediaUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ storageProvider: "cloudflare-stream" }),
    )
  })

  it("preserves oversized originals by falling back to Cloudflare processing", async () => {
    process.env.STORY_VIDEO_PROCESSOR = "vercel-hls"
    process.env.MEDIA_PIPELINE_ENABLED = "true"

    const { POST } = await import("@/app/api/mobile/stories/video-upload/route")
    const response = await POST(
      uploadRequest({
        build: 389,
        pipeline: "hls-v4",
        byteSize: 301 * 1024 * 1024,
      }),
    )

    expect(response.status).toBe(200)
    expect(createCloudflareStreamTusUpload).toHaveBeenCalledWith(
      expect.objectContaining({ allowLegacyClientFallback: true }),
    )
    expect(createMediaUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ storageProvider: "cloudflare-stream" }),
    )
  })
})
