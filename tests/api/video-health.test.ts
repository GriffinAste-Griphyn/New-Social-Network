import { afterEach, describe, expect, it } from "vitest"

const originalEnv = { ...process.env }

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("video health API", () => {
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
})
