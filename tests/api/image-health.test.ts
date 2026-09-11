import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  isCloudflareR2Configured,
  probeCloudflareR2Buckets,
} from "@/lib/cloudflare-r2"

vi.mock("@/lib/cloudflare-r2", () => ({
  isCloudflareR2Configured: vi.fn(),
  probeCloudflareR2Buckets: vi.fn(),
}))

const originalEnv = { ...process.env }

describe("image health API", () => {
  beforeEach(() => {
    vi.mocked(isCloudflareR2Configured).mockReturnValue(true)
    vi.mocked(probeCloudflareR2Buckets).mockResolvedValue(true)
    process.env.STORY_IMAGE_STORAGE_PROVIDER = "cloudflare-r2"
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = "https://media.ubeye.ai"
    process.env.VERCEL_BLOB_SUSPENDED_MODE = "true"
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("reports healthy when both R2 buckets and public delivery are configured", async () => {
    const { GET } = await import("@/app/api/health/image/route")
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: "cloudflare-r2",
      checks: {
        profileAvatarStorageProvider: true,
        cloudflareR2Selected: true,
        cloudflareR2Configured: true,
        cloudflareR2ApiProbe: true,
        publicDeliveryUrl: true,
      },
    })
  })

  it("reports unhealthy when R2 credentials cannot access the buckets", async () => {
    vi.mocked(probeCloudflareR2Buckets).mockRejectedValue(
      new Error("forbidden"),
    )
    const { GET } = await import("@/app/api/health/image/route")
    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      checks: { cloudflareR2ApiProbe: false },
    })
  })
})
