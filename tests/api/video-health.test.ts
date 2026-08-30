import { del, put } from "@vercel/blob"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getDb } from "@/lib/db"
import {
  checkCloudflareStreamPlayback,
  checkVercelHlsPlayback,
  discoverCloudflareStreamPlaybackCanaries,
} from "@/lib/video-health"

vi.mock("@vercel/blob", () => ({ del: vi.fn(), put: vi.fn() }))

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))

vi.mock("@/lib/video-health", () => ({
  checkCloudflareStreamPlayback: vi.fn(),
  checkVercelHlsPlayback: vi.fn(),
  discoverCloudflareStreamPlaybackCanaries: vi.fn(),
}))

const originalEnv = { ...process.env }

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("video health API", () => {
  beforeEach(() => {
    vi.mocked(put).mockResolvedValue({} as never)
    vi.mocked(del).mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          groupBy: vi.fn().mockResolvedValue([{ status: "ready", count: 2 }]),
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  mediaUrl:
                    "https://store.public.blob.vercel-storage.com/media/canary/master-360p.m3u8",
                },
              ]),
            })),
          })),
        })),
      })),
    } as never)
    vi.mocked(checkCloudflareStreamPlayback).mockResolvedValue({
      ok: true,
      status: 200,
      latencyMs: 42,
      checkedAt: "2026-08-24T12:00:00.000Z",
    })
    vi.mocked(discoverCloudflareStreamPlaybackCanaries).mockResolvedValue({
      ok: true,
      status: 200,
      uids: [],
    })
    vi.mocked(checkVercelHlsPlayback).mockResolvedValue({
      ok: true,
      status: 200,
      latencyMs: 55,
      checkedAt: "2026-08-24T12:00:00.000Z",
      resources: {
        master: 200,
        variant: 200,
        initialization: 206,
        segment: 206,
      },
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("reports unhealthy when required Cloudflare video env is missing", async () => {
    delete process.env.STORY_VIDEO_PROCESSOR
    delete process.env.CLOUDFLARE_STREAM_ACCOUNT_ID
    delete process.env.CLOUDFLARE_STREAM_API_TOKEN
    delete process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN

    const { GET } = await import("@/app/api/health/video/route")
    const response = await GET()
    const payload = await responseJson(response)

    expect(response.status).toBe(503)
    expect(payload).toMatchObject({
      ok: false,
      service: "ubeye-video",
    })
  })

  it("reports healthy when required Cloudflare video env is configured", async () => {
    process.env.STORY_VIDEO_PROCESSOR = "cloudflare-stream"
    process.env.CLOUDFLARE_STREAM_ACCOUNT_ID = "account"
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "token"
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN = "stream.example.com"

    const { GET } = await import("@/app/api/health/video/route")
    const response = await GET()
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      service: "ubeye-video",
      checks: {
        storyVideoProcessor: true,
        cloudflareAccountId: true,
        cloudflareApiToken: true,
        cloudflareApiProbe: true,
        cloudflareCustomerSubdomain: true,
      },
    })
  })

  it("actively verifies both custom Blob stores and the processing schema", async () => {
    process.env.STORY_VIDEO_PROCESSOR = "vercel-hls"
    process.env.MEDIA_PIPELINE_ENABLED = "true"
    process.env.BLOB_READ_WRITE_TOKEN = "private-token"
    process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN = "delivery-token"
    process.env.MEDIA_DELIVERY_ACCESS = "public"

    const { GET } = await import("@/app/api/health/video/route")
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processor: "vercel-hls",
      checks: {
        customPipelineEnabled: true,
        privateOriginalStore: true,
        publicDeliveryStore: true,
        processingDatabase: true,
        vercelHlsPlaybackCanary: true,
        vercelHlsPlaybackProbe: true,
      },
      processingJobs: [{ status: "ready", count: 2 }],
    })
    expect(put).toHaveBeenCalledWith(
      "_health/private-original-write-probe.txt",
      "ubeye-video-health",
      expect.objectContaining({ access: "private", token: "private-token" }),
    )
    expect(put).toHaveBeenCalledWith(
      "_health/public-delivery-write-probe.txt",
      "ubeye-video-health",
      expect.objectContaining({ access: "public", token: "delivery-token" }),
    )
    expect(checkVercelHlsPlayback).toHaveBeenCalledWith(
      "https://store.public.blob.vercel-storage.com/media/canary/master-360p.m3u8",
    )
  })

  it("fails custom health when the public delivery token cannot access its store", async () => {
    process.env.STORY_VIDEO_PROCESSOR = "vercel-hls"
    process.env.MEDIA_PIPELINE_ENABLED = "true"
    process.env.BLOB_READ_WRITE_TOKEN = "private-token"
    process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN = "delivery-token-failing"
    process.env.MEDIA_DELIVERY_ACCESS = "public"
    vi.mocked(put).mockImplementation(async (_pathname, _body, options) => {
      if (options?.token === "delivery-token-failing") {
        throw new Error("forbidden")
      }
      return {} as never
    })

    const { GET } = await import("@/app/api/health/video/route")
    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      checks: { publicDeliveryStore: false },
    })
  })

  it("fails custom health when the public HLS playback chain is broken", async () => {
    process.env.STORY_VIDEO_PROCESSOR = "vercel-hls"
    process.env.MEDIA_PIPELINE_ENABLED = "true"
    process.env.BLOB_READ_WRITE_TOKEN = "private-token"
    process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN = "delivery-token"
    process.env.MEDIA_DELIVERY_ACCESS = "public"
    vi.mocked(checkVercelHlsPlayback).mockResolvedValue({
      ok: false,
      status: 200,
      latencyMs: 60,
      checkedAt: "2026-08-24T12:00:00.000Z",
      error: "The HLS playback canary variant is incomplete.",
    })

    const { GET } = await import("@/app/api/health/video/route")
    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      checks: { vercelHlsPlaybackProbe: false },
      playbackProbe: {
        ok: false,
        error: "The HLS playback canary variant is incomplete.",
      },
    })
  })

  it("requires the Cloudflare webhook secret in production", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      configurable: true,
    })
    process.env.STORY_VIDEO_PROCESSOR = "cloudflare-stream"
    process.env.CLOUDFLARE_STREAM_ACCOUNT_ID = "account"
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "token"
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN = "stream.example.com"
    delete process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET

    const { GET } = await import("@/app/api/health/video/route")
    const response = await GET()
    const payload = await responseJson(response)

    expect(response.status).toBe(503)
    expect(payload).toMatchObject({
      ok: false,
      checks: {
        cloudflareWebhookSecret: false,
      },
    })
  })

  it("fails production health when the signed playback canary fails", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      configurable: true,
    })
    process.env.STORY_VIDEO_PROCESSOR = "cloudflare-stream"
    process.env.CLOUDFLARE_STREAM_ACCOUNT_ID = "account"
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "token"
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN = "stream.example.com"
    process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET = "webhook"
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID = "key"
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM = "pem"
    process.env.CLOUDFLARE_STREAM_HEALTHCHECK_UID =
      "0123456789abcdef0123456789abcdef"
    vi.mocked(checkCloudflareStreamPlayback).mockResolvedValue({
      ok: false,
      status: 403,
      latencyMs: 71,
      checkedAt: "2026-08-24T12:00:00.000Z",
      error: "The playback canary returned HTTP 403.",
    })

    const { GET } = await import("@/app/api/health/video/route")
    const response = await GET()
    const payload = await responseJson(response)

    expect(response.status).toBe(503)
    expect(payload).toMatchObject({
      ok: false,
      checks: {
        cloudflarePlaybackCanary: true,
        cloudflarePlaybackProbe: false,
      },
      playbackProbe: {
        ok: false,
        status: 403,
      },
    })
  })

  it("falls back to a ready Stream asset when the configured canary is gone", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      configurable: true,
    })
    process.env.STORY_VIDEO_PROCESSOR = "cloudflare-stream"
    process.env.CLOUDFLARE_STREAM_ACCOUNT_ID = "account"
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "token"
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN = "stream.example.com"
    process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET = "webhook"
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID = "key"
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM = "pem"
    process.env.CLOUDFLARE_STREAM_HEALTHCHECK_UID =
      "0123456789abcdef0123456789abcdef"
    vi.mocked(discoverCloudflareStreamPlaybackCanaries).mockResolvedValue({
      ok: true,
      status: 200,
      uids: ["fedcba9876543210fedcba9876543210"],
    })
    vi.mocked(checkCloudflareStreamPlayback)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        latencyMs: 40,
        checkedAt: "2026-08-30T07:00:00.000Z",
        error: "The playback canary returned HTTP 404.",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        latencyMs: 45,
        checkedAt: "2026-08-30T07:00:01.000Z",
      })

    const { GET } = await import("@/app/api/health/video/route")
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      checks: {
        cloudflareApiProbe: true,
        cloudflarePlaybackProbe: true,
      },
      cloudflareCanaryDiscovery: {
        ok: true,
        candidateCount: 1,
      },
      playbackProbe: { ok: true, status: 200 },
    })
    expect(checkCloudflareStreamPlayback).toHaveBeenNthCalledWith(
      1,
      "0123456789abcdef0123456789abcdef",
    )
    expect(checkCloudflareStreamPlayback).toHaveBeenNthCalledWith(
      2,
      "fedcba9876543210fedcba9876543210",
    )
  })
})
