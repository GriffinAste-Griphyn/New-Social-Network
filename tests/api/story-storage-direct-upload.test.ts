import { generateKeyPairSync } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { get, head, put } from "@vercel/blob"
import sharp from "sharp"
import {
  createCloudflareStreamPlaybackUrl,
  createDirectBlobStoryImageAsset,
  StoryUploadError,
} from "@/lib/story-storage"

vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
}))

const originalEnv = { ...process.env }

describe("direct story image storage verification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(head).mockResolvedValue({
      size: 1234,
      contentType: "image/jpeg",
    } as Awaited<ReturnType<typeof head>>)
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: new Blob(["not-real-image"], {
        type: "image/jpeg",
      }).stream() as ReadableStream<Uint8Array>,
      headers: new Headers(),
      blob: {
        url: "https://blob.example.com/story.jpg",
        downloadUrl: "https://blob.example.com/story.jpg?download=1",
        pathname: "stories/web-direct/creator_123/story.jpg",
        contentDisposition: "inline",
        cacheControl: "public, max-age=31536000",
        uploadedAt: new Date(),
        etag: "etag",
        contentType: "image/jpeg",
        size: 1234,
      },
    } as unknown as Awaited<ReturnType<typeof get>>)
    vi.mocked(put).mockResolvedValue({
      pathname: "stories/web-direct/creator_123/story-thumb.jpg",
      url: "https://blob.example.com/stories/web-direct/creator_123/story-thumb.jpg",
    } as Awaited<ReturnType<typeof put>>)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
  })

  it("rejects an uploaded image outside the owner path", async () => {
    await expect(
      createDirectBlobStoryImageAsset({
        pathname: "stories/web-direct/other_user/story.jpg",
        ownerUserId: "creator_123",
        contentType: "image/jpeg",
        byteSize: 1234,
        checksum: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(StoryUploadError)

    expect(head).not.toHaveBeenCalled()
  })

  it("rejects mismatched Blob metadata", async () => {
    vi.mocked(head).mockResolvedValue({
      size: 9999,
      contentType: "image/jpeg",
    } as Awaited<ReturnType<typeof head>>)

    await expect(
      createDirectBlobStoryImageAsset({
        pathname: "stories/web-direct/creator_123/story.jpg",
        ownerUserId: "creator_123",
        contentType: "image/jpeg",
        byteSize: 1234,
        checksum: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(StoryUploadError)
  })

  it("returns a verified StoredStoryAsset and falls back to original as thumbnail if variant generation fails", async () => {
    const asset = await createDirectBlobStoryImageAsset({
      pathname: "stories/web-direct/creator_123/story.jpg",
      ownerUserId: "creator_123",
      contentType: "image/jpeg",
      byteSize: 1234,
      checksum: "A".repeat(64),
      width: 1080,
      height: 1920,
    })

    expect(asset).toMatchObject({
      assetKind: "image",
      mediaUrl: "/api/story-media/stories/web-direct/creator_123/story.jpg",
      thumbnailUrl: "/api/story-media/stories/web-direct/creator_123/story.jpg",
      storageProvider: "vercel-blob",
      storageKey: "stories/web-direct/creator_123/story.jpg",
      originalMediaUrl: "/api/story-media/stories/web-direct/creator_123/story.jpg",
      originalThumbnailUrl:
        "/api/story-media/stories/web-direct/creator_123/story.jpg",
      originalStorageProvider: "vercel-blob",
      originalStorageKey: "stories/web-direct/creator_123/story.jpg",
      originalContentType: "image/jpeg",
      originalByteSize: 1234,
      checksum: "a".repeat(64),
      width: 1080,
      height: 1920,
      processingStatus: "ready",
    })
  })

  it("publishes display and thumbnail derivatives while preserving the private original", async () => {
    const sourceBytes = await sharp({
      create: {
        width: 1440,
        height: 2560,
        channels: 3,
        background: "#f24c3d",
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer()

    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: new Blob([Uint8Array.from(sourceBytes)], {
        type: "image/jpeg",
      }).stream() as ReadableStream<Uint8Array>,
      headers: new Headers(),
      blob: {
        url: "https://blob.example.com/story.jpg",
        downloadUrl: "https://blob.example.com/story.jpg?download=1",
        pathname: "stories/web-direct/creator_123/story.jpg",
        contentDisposition: "inline",
        cacheControl: "public, max-age=31536000",
        uploadedAt: new Date(),
        etag: "etag",
        contentType: "image/jpeg",
        size: 1234,
      },
    } as unknown as Awaited<ReturnType<typeof get>>)
    vi.mocked(put).mockImplementation(async (pathname) => ({
      pathname,
      url: `https://blob.example.com/${pathname}`,
    }) as Awaited<ReturnType<typeof put>>)

    const asset = await createDirectBlobStoryImageAsset({
      pathname: "stories/web-direct/creator_123/story.jpg",
      ownerUserId: "creator_123",
      contentType: "image/jpeg",
      byteSize: 1234,
      checksum: "a".repeat(64),
      width: 1440,
      height: 2560,
    })

    expect(put).toHaveBeenCalledWith(
      "stories/web-direct/creator_123/story-display.jpg",
      expect.any(Buffer),
      expect.objectContaining({
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        cacheControlMaxAge: 60 * 60 * 24 * 30,
      }),
    )
    expect(put).toHaveBeenCalledWith(
      "stories/web-direct/creator_123/story-thumb.jpg",
      expect.any(Buffer),
      expect.objectContaining({
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: false,
      }),
    )
    expect(asset).toMatchObject({
      assetKind: "image",
      mediaUrl:
        "https://blob.example.com/stories/web-direct/creator_123/story-display.jpg",
      thumbnailUrl:
        "https://blob.example.com/stories/web-direct/creator_123/story-thumb.jpg",
      storageProvider: "vercel-blob",
      storageKey: "stories/web-direct/creator_123/story-display.jpg",
      originalMediaUrl: "/api/story-media/stories/web-direct/creator_123/story.jpg",
      originalThumbnailUrl:
        "https://blob.example.com/stories/web-direct/creator_123/story-thumb.jpg",
      originalStorageProvider: "vercel-blob",
      originalStorageKey: "stories/web-direct/creator_123/story.jpg",
      originalContentType: "image/jpeg",
      originalByteSize: 1234,
      originalWidth: 1440,
      originalHeight: 2560,
      contentType: "image/jpeg",
      width: 1080,
      height: 1920,
      processingStatus: "ready",
    })
    expect(asset.byteSize).toBeGreaterThan(0)
    expect(asset.checksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it("self-signs Cloudflare Stream playback tokens when a signing key is configured", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const uid = "11111111111111111111111111111111"

    process.env.CLOUDFLARE_STREAM_ACCOUNT_ID = "account"
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "token"
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN = "stream.example.com"
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID = "stream_key_123"
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const playbackUrl = await createCloudflareStreamPlaybackUrl(uid)
    const token = playbackUrl.match(
      /^https:\/\/stream\.example\.com\/([^/]+)\/manifest\/video\.m3u8$/,
    )?.[1]

    expect(fetchMock).not.toHaveBeenCalled()
    expect(token).toBeTruthy()

    const [encodedHeader, encodedPayload] = token!.split(".")
    const header = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString("utf8"),
    )
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    )

    expect(header).toMatchObject({ alg: "RS256", kid: "stream_key_123" })
    expect(payload).toMatchObject({
      sub: uid,
      kid: "stream_key_123",
      downloadable: false,
    })
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })
})
