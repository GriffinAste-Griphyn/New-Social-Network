import { afterEach, describe, expect, it, vi } from "vitest"

import { moderateUserContent } from "@/lib/safety/moderate-content"

const originalEnv = { ...process.env }

afterEach(() => {
  vi.restoreAllMocks()
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

  it("resolves video thumbnail redirects before OpenAI scans media", async () => {
    vi.stubEnv("CONTENT_MODERATION_PROVIDER", "openai")
    vi.stubEnv("OPENAI_API_KEY", "test-key")

    const thumbnailResponse = new Response("", {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    })
    Object.defineProperty(thumbnailResponse, "url", {
      value: "https://customer.cloudflarestream.com/video/thumbnails/thumbnail.jpg",
    })

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(thumbnailResponse)
      .mockResolvedValueOnce(
        Response.json({
          id: "modr_test",
          model: "omni-moderation-latest",
          results: [
            {
              flagged: false,
              categories: {},
              category_scores: {},
            },
          ],
        }),
      )

    const result = await moderateUserContent({
      textParts: [],
      media: {
        assetKind: "video",
        contentType: "video/mp4",
        byteSize: 12_000,
        mediaUrl: "https://www.ubeye.ai/api/story-media/cloudflare-stream/id/manifest/video.m3u8",
        thumbnailUrl:
          "https://www.ubeye.ai/api/story-media/cloudflare-stream/id/thumbnails/thumbnail.jpg?token=test",
      },
    })

    const openAiRequest = JSON.parse(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).body as string,
    )

    expect(result.action).toBe("approve")
    expect(openAiRequest.input[0].image_url.url).toBe(
      "https://customer.cloudflarestream.com/video/thumbnails/thumbnail.jpg",
    )
  })
})
