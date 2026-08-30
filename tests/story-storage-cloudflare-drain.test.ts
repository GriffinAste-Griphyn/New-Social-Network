import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createCloudflareStreamStoredVideoAsset,
  createCloudflareStreamTusUpload,
  getCloudflareStreamVideoDetails,
  setCloudflareStreamThumbnailAtDefaultTime,
} from "@/lib/story-storage"

const uid = "a".repeat(32)
const originalProcessor = process.env.STORY_VIDEO_PROCESSOR
const originalAccountId = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID
const originalApiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN
const originalCustomerSubdomain =
  process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN

describe("Cloudflare drain compatibility", () => {
  beforeEach(() => {
    process.env.STORY_VIDEO_PROCESSOR = "vercel-hls"
    process.env.CLOUDFLARE_STREAM_ACCOUNT_ID = "account-id"
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "api-token"
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN =
      "customer.example.com"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalProcessor === undefined) {
      delete process.env.STORY_VIDEO_PROCESSOR
    } else {
      process.env.STORY_VIDEO_PROCESSOR = originalProcessor
    }
    if (originalAccountId === undefined) {
      delete process.env.CLOUDFLARE_STREAM_ACCOUNT_ID
    } else {
      process.env.CLOUDFLARE_STREAM_ACCOUNT_ID = originalAccountId
    }
    if (originalApiToken === undefined) {
      delete process.env.CLOUDFLARE_STREAM_API_TOKEN
    } else {
      process.env.CLOUDFLARE_STREAM_API_TOKEN = originalApiToken
    }
    if (originalCustomerSubdomain === undefined) {
      delete process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN
    } else {
      process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN =
        originalCustomerSubdomain
    }
  })

  it("keeps existing Cloudflare assets readable after new uploads move to Vercel HLS", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          result: {
            readyToStream: true,
            status: { state: "ready", pctComplete: "100" },
            size: 4_096,
            duration: 5,
            input: { width: 1080, height: 1920 },
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ success: true }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getCloudflareStreamVideoDetails(uid)).resolves.toMatchObject({
      readyToStream: true,
      state: "ready",
      pctComplete: 100,
    })
    await expect(
      setCloudflareStreamThumbnailAtDefaultTime(uid),
    ).resolves.toBeUndefined()
    expect(
      createCloudflareStreamStoredVideoAsset({
        uid,
        contentType: "video/mp4",
        byteSize: 4_096,
        processingStatus: "ready",
      }),
    ).toMatchObject({
      storageProvider: "cloudflare-stream",
      storageKey: uid,
      processingStatus: "ready",
    })
  })

  it("still blocks creation of new Cloudflare uploads after cutover", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      createCloudflareStreamTusUpload({
        fileName: "story.mp4",
        uploadLengthBytes: 4_096,
        maxDurationSeconds: 120,
      }),
    ).rejects.toThrow(
      "Production video uploads require STORY_VIDEO_PROCESSOR=cloudflare-stream.",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
