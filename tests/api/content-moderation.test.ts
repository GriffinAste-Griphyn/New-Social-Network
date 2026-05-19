import { afterEach, describe, expect, it, vi } from "vitest"

import { moderateUserContent } from "@/lib/safety/moderate-content"

const originalEnv = { ...process.env }

afterEach(() => {
  vi.unstubAllEnvs()
  process.env = { ...originalEnv }
})

describe("content moderation", () => {
  it("holds obvious unsafe text before publication", async () => {
    const result = await moderateUserContent({
      textParts: ["DM me for a crypto giveaway and free money"],
    })

    expect(result.action).toBe("hold")
    expect(result.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "fraud",
        }),
      ]),
    )
  })

  it("rejects possible minor sexual safety text", async () => {
    const result = await moderateUserContent({
      textParts: ["underage sex material"],
    })

    expect(result.action).toBe("reject")
    expect(result.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "minor_safety",
        }),
      ]),
    )
  })

  it("holds suspicious links", async () => {
    const result = await moderateUserContent({
      textParts: ["check this"],
      linkUrls: ["https://t.me/example"],
    })

    expect(result.action).toBe("hold")
    expect(result.reason).toContain("t.me")
  })

  it("fails closed for production media when no provider is configured", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CONTENT_MODERATION_PROVIDER", "local")

    const result = await moderateUserContent({
      textParts: [],
      media: {
        assetKind: "image",
        contentType: "image/jpeg",
        byteSize: 12_000,
        mediaUrl: "https://example.com/story.jpg",
      },
    })

    expect(result.action).toBe("hold")
    expect(result.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "scanner_unavailable",
        }),
      ]),
    )
  })

  it("allows local media checks in test mode when structural checks pass", async () => {
    vi.stubEnv("CONTENT_MODERATION_PROVIDER", "local")

    const result = await moderateUserContent({
      textParts: [],
      media: {
        assetKind: "image",
        contentType: "image/jpeg",
        byteSize: 12_000,
        mediaUrl: "https://example.com/story.jpg",
      },
    })

    expect(result.action).toBe("approve")
  })
})
