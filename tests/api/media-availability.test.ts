import { afterEach, describe, expect, it } from "vitest"

import {
  blobMediaUnavailableResponse,
  isVercelBlobAccessDisabled,
  isVercelBlobMediaReference,
} from "@/lib/media-availability"

const originalEnv = { ...process.env }

describe("media availability recovery switch", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("recognizes Blob-backed routes without blocking Cloudflare Stream routes", () => {
    expect(isVercelBlobMediaReference("/api/story-media/stories/photo.jpg")).toBe(true)
    expect(
      isVercelBlobMediaReference(
        "/api/story-media/cloudflare-stream/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/manifest/video.m3u8",
      ),
    ).toBe(false)
    expect(
      isVercelBlobMediaReference(
        "https://store.public.blob.vercel-storage.com/stories/photo.jpg",
      ),
    ).toBe(true)
  })

  it("returns a retryable service response when enabled", async () => {
    process.env.VERCEL_BLOB_SUSPENDED_MODE = "true"
    expect(isVercelBlobAccessDisabled()).toBe(true)

    const response = blobMediaUnavailableResponse()
    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("3600")
    await expect(response.json()).resolves.toMatchObject({
      code: "vercel_blob_temporarily_unavailable",
      retryable: true,
    })
  })
})
