import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  cloudflareR2DeliveryKeyFromUrl,
  cloudflareR2PublicUrl,
  isCloudflareR2Configured,
  isCloudflareR2StoryImageStorageEnabled,
} from "@/lib/cloudflare-r2"

const originalEnv = { ...process.env }

describe("Cloudflare R2 story image storage", () => {
  beforeEach(() => {
    process.env.STORY_IMAGE_STORAGE_PROVIDER = "cloudflare-r2"
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = "account"
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "access"
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "secret"
    process.env.CLOUDFLARE_R2_ORIGINALS_BUCKET = "ubeye-media-originals"
    process.env.CLOUDFLARE_R2_DELIVERY_BUCKET = "ubeye-media-delivery"
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = "https://media.ubeye.ai"
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("recognizes a complete provider configuration", () => {
    expect(isCloudflareR2Configured()).toBe(true)
    expect(isCloudflareR2StoryImageStorageEnabled()).toBe(true)
  })

  it("rejects the uncached r2.dev delivery endpoint in production", () => {
    process.env.VERCEL_ENV = "production"
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = "https://example.r2.dev"

    expect(isCloudflareR2Configured()).toBe(false)
  })

  it("round-trips safe delivery object keys through the public domain", () => {
    const key =
      "stories/web-direct/creator_123/1234-11111111-1111-4111-8111-111111111111-display.avif"
    const url = cloudflareR2PublicUrl(key)

    expect(url).toBe(`https://media.ubeye.ai/${key}`)
    expect(cloudflareR2DeliveryKeyFromUrl(url)).toBe(key)
  })

  it("supports public avatar delivery keys", () => {
    const key = "avatars/creator_123/avatar.jpg"
    const url = cloudflareR2PublicUrl(key)

    expect(url).toBe(`https://media.ubeye.ai/${key}`)
    expect(cloudflareR2DeliveryKeyFromUrl(url)).toBe(key)
  })

  it("rejects unrelated delivery URLs and unsafe keys", () => {
    expect(
      cloudflareR2DeliveryKeyFromUrl(
        "https://attacker.example/stories/web-direct/creator/file.webp",
      ),
    ).toBeNull()
    expect(() =>
      cloudflareR2PublicUrl("stories/web-direct/creator/../secret.jpg"),
    ).toThrow("key is invalid")
  })
})
