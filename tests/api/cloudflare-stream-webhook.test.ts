import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { syncCloudflareStreamStoryStatus } from "@/lib/story-store"

vi.mock("@/lib/story-store", () => ({
  syncCloudflareStreamStoryStatus: vi.fn(),
}))

const originalEnv = { ...process.env }

function signedRequest(body: string, secret: string, timestampSeconds: number) {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${body}`)
    .digest("hex")

  return new Request("https://app.example.com/api/cloudflare/stream/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Webhook-Signature": `time=${timestampSeconds},sig1=${signature}`,
    },
    body,
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("Cloudflare Stream webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET = "webhook_secret"
    vi.mocked(syncCloudflareStreamStoryStatus).mockResolvedValue({
      status: "live",
      storyId: "story_123",
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("rejects requests with an invalid webhook signature", async () => {
    const { POST } = await import("@/app/api/cloudflare/stream/webhook/route")
    const response = await POST(
      new Request("https://app.example.com/api/cloudflare/stream/webhook", {
        method: "POST",
        headers: {
          "Webhook-Signature": "time=1,sig1=bad",
        },
        body: "{}",
      }),
    )

    expect(response.status).toBe(401)
    expect(syncCloudflareStreamStoryStatus).not.toHaveBeenCalled()
  })

  it("syncs a ready Cloudflare video into story status", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({
      uid: "11111111111111111111111111111111",
      readyToStream: true,
      status: { state: "ready" },
      duration: 7.2,
      size: 123456,
      input: { width: 1080, height: 1920 },
    })

    const { POST } = await import("@/app/api/cloudflare/stream/webhook/route")
    const response = await POST(
      signedRequest(body, "webhook_secret", nowSeconds),
    )

    expect(response.status).toBe(200)
    expect(syncCloudflareStreamStoryStatus).toHaveBeenCalledWith({
      uid: "11111111111111111111111111111111",
      details: {
        readyToStream: true,
        state: "ready",
        pctComplete: null,
        errorReason: null,
        byteSize: 123456,
        durationMs: 7200,
        width: 1080,
        height: 1920,
      },
    })
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      result: {
        status: "live",
        storyId: "story_123",
      },
    })
  })
})
