import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { checkCloudflareStreamPlayback } from "@/lib/video-health"

vi.mock("@/lib/video-health", () => ({
  checkCloudflareStreamPlayback: vi.fn(),
}))

const originalEnv = { ...process.env }

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("video health API", () => {
  beforeEach(() => {
    vi.mocked(checkCloudflareStreamPlayback).mockResolvedValue({
      ok: true,
      status: 200,
      latencyMs: 42,
      checkedAt: "2026-08-24T12:00:00.000Z",
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
        cloudflareCustomerSubdomain: true,
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
})
