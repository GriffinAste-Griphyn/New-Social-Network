import { beforeEach, describe, expect, it, vi } from "vitest"

import { head } from "@vercel/blob"
import {
  createDirectBlobStoryImageAsset,
  createDirectBlobStoryVideoPosterUrl,
  directStoryVideoPosterPathname,
} from "@/lib/story-storage"
import { storyMediaContract } from "@/lib/story-media-contract"

vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
}))

const basePathname = "stories/web-direct/creator_123/upload_123"
const displayPathname = `${basePathname}-display.avif`
const thumbnailPathname = `${basePathname}-fit-thumb.webp`

function blobMetadata(pathname: string, contentType: string, size: number) {
  return {
    url: `https://blob.example.com/${pathname}`,
    downloadUrl: `https://blob.example.com/${pathname}?download=1`,
    pathname,
    contentType,
    contentDisposition: "inline",
    size,
    uploadedAt: new Date(),
    cacheControl: "public, max-age=0",
  }
}

describe("direct story image verification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retries Blob metadata reads that lag behind a successful client upload", async () => {
    vi.mocked(head)
      .mockRejectedValueOnce(new Error("not visible yet"))
      .mockResolvedValueOnce(
        blobMetadata(displayPathname, "image/avif", 1_234) as never,
      )
      .mockResolvedValueOnce(
        blobMetadata(thumbnailPathname, "image/webp", 456) as never,
      )

    await expect(
      createDirectBlobStoryImageAsset({
        basePathname,
        ownerUserId: "creator_123",
        displayDerivative: {
          pathname: displayPathname,
          contentType: "image/avif",
          byteSize: 1_234,
          checksum: "a".repeat(64),
          width: 1080,
          height: 1920,
        },
        thumbnailDerivative: {
          pathname: thumbnailPathname,
          contentType: "image/webp",
          byteSize: 456,
          checksum: "b".repeat(64),
          width: 360,
          height: 640,
        },
        thumbHash: Buffer.alloc(25, 7).toString("base64url"),
      }),
    ).resolves.toMatchObject({
      storageKey: displayPathname,
      contentType: "image/avif",
    })
    expect(head).toHaveBeenCalledTimes(3)
  })

  it("accepts derivatives exactly at the canonical byte ceilings", async () => {
    const displayBytes =
      storyMediaContract.upload.maxImageDisplayDerivativeBytes
    const thumbnailBytes =
      storyMediaContract.upload.maxImageThumbnailDerivativeBytes
    vi.mocked(head)
      .mockResolvedValueOnce(
        blobMetadata(displayPathname, "image/avif", displayBytes) as never,
      )
      .mockResolvedValueOnce(
        blobMetadata(thumbnailPathname, "image/webp", thumbnailBytes) as never,
      )

    await expect(
      createDirectBlobStoryImageAsset({
        basePathname,
        ownerUserId: "creator_123",
        displayDerivative: {
          pathname: displayPathname,
          contentType: "image/avif",
          byteSize: displayBytes,
          checksum: "a".repeat(64),
          width: 1080,
          height: 1920,
        },
        thumbnailDerivative: {
          pathname: thumbnailPathname,
          contentType: "image/webp",
          byteSize: thumbnailBytes,
          checksum: "b".repeat(64),
          width: 360,
          height: 640,
        },
        thumbHash: Buffer.alloc(25, 7).toString("base64url"),
      }),
    ).resolves.toMatchObject({
      byteSize: displayBytes,
      storageKey: displayPathname,
    })
  })

  it("rejects derivatives above the canonical byte ceilings", async () => {
    await expect(
      createDirectBlobStoryImageAsset({
        basePathname,
        ownerUserId: "creator_123",
        displayDerivative: {
          pathname: displayPathname,
          contentType: "image/avif",
          byteSize:
            storyMediaContract.upload.maxImageDisplayDerivativeBytes + 1,
          checksum: "a".repeat(64),
          width: 1080,
          height: 1920,
        },
        thumbnailDerivative: {
          pathname: thumbnailPathname,
          contentType: "image/webp",
          byteSize: 456,
          checksum: "b".repeat(64),
          width: 360,
          height: 640,
        },
        thumbHash: Buffer.alloc(25, 7).toString("base64url"),
      }),
    ).rejects.toThrow("Could not verify the uploaded story image variants.")
    expect(head).not.toHaveBeenCalled()
  })
})

describe("direct story video poster verification", () => {
  const uid = "c".repeat(32)
  const posterPathname = directStoryVideoPosterPathname(uid)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("persists a verified private poster route for the exact Stream upload", async () => {
    vi.mocked(head).mockResolvedValueOnce(
      blobMetadata(posterPathname, "image/jpeg", 12_345) as never,
    )

    await expect(
      createDirectBlobStoryVideoPosterUrl({
        uid,
        poster: {
          pathname: posterPathname,
          contentType: "image/jpeg",
          byteSize: 12_345,
          checksum: "d".repeat(64),
          width: 1080,
          height: 1920,
        },
      }),
    ).resolves.toBe(`/api/story-media/${posterPathname}`)
  })

  it("rejects a poster belonging to a different Stream upload", async () => {
    await expect(
      createDirectBlobStoryVideoPosterUrl({
        uid,
        poster: {
          pathname: directStoryVideoPosterPathname("e".repeat(32)),
          contentType: "image/jpeg",
          byteSize: 12_345,
          checksum: "f".repeat(64),
          width: 1080,
          height: 1920,
        },
      }),
    ).rejects.toThrow("Could not verify the story video poster.")
    expect(head).not.toHaveBeenCalled()
  })
})
