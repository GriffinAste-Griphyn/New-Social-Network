import { afterEach, describe, expect, it, vi } from "vitest"

import { moderateUserContent } from "@/lib/safety/moderate-content"
import { userFacingModerationReason } from "@/lib/safety/user-facing"

const originalEnv = { ...process.env }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
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

  it("allows profanity when it is not a threat or sexual abuse", async () => {
    vi.stubEnv("CONTENT_MODERATION_PROVIDER", "openai")
    vi.stubEnv("OPENAI_API_KEY", "test-key")
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        id: "modr_test",
        model: "omni-moderation-latest",
        results: [
          {
            flagged: true,
            categories: {
              harassment: true,
            },
            category_scores: {
              harassment: 0.88,
            },
            category_applied_input_types: {
              harassment: ["text"],
            },
          },
        ],
      }),
    )

    const result = await moderateUserContent({
      textParts: ["fuck you"],
    })

    expect(result.action).toBe("approve")
    expect(result.categories).toEqual([])
  })

  it("holds threatening harassment even when profanity is allowed", async () => {
    vi.stubEnv("CONTENT_MODERATION_PROVIDER", "openai")
    vi.stubEnv("OPENAI_API_KEY", "test-key")
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        id: "modr_test",
        model: "omni-moderation-latest",
        results: [
          {
            flagged: true,
            categories: {
              harassment: true,
              "harassment/threatening": true,
            },
            category_scores: {
              harassment: 0.9,
              "harassment/threatening": 0.95,
            },
            category_applied_input_types: {
              harassment: ["text"],
              "harassment/threatening": ["text"],
            },
          },
        ],
      }),
    )

    const result = await moderateUserContent({
      textParts: ["fuck you, I will hurt you"],
    })

    expect(result.action).toBe("hold")
    expect(result.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "harassment",
          source: "openai",
        }),
      ]),
    )
  })

  it("does not hold harmless words that contain violence terms", async () => {
    const result = await moderateUserContent({
      textParts: ["photo shoot tomorrow"],
    })

    expect(result.action).toBe("approve")
  })

  it("holds direct violent threats", async () => {
    const result = await moderateUserContent({
      textParts: ["I will kill you"],
    })

    expect(result.action).toBe("hold")
    expect(result.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "violence",
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

  it("retries transient OpenAI media download failures before holding", async () => {
    vi.useFakeTimers()
    vi.stubEnv("CONTENT_MODERATION_PROVIDER", "openai")
    vi.stubEnv("OPENAI_API_KEY", "test-key")

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              message:
                "Failed to download image from file_url: https://www.ubeye.ai/api/story-media/story.jpg",
              code: "image_url_unavailable",
            },
          },
          { status: 400 },
        ),
      )
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

    const resultPromise = moderateUserContent({
      textParts: [],
      media: {
        assetKind: "image",
        contentType: "image/jpeg",
        byteSize: 12_000,
        mediaUrl: "https://www.ubeye.ai/api/story-media/story.jpg?token=test",
      },
    })

    await vi.advanceTimersByTimeAsync(1_000)
    const result = await resultPromise

    expect(result.action).toBe("approve")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("hides provider details from user-facing moderation reasons", () => {
    expect(
      userFacingModerationReason({
        moderationStatus: "flagged",
        moderationReason: "OpenAI moderation flagged harassment in text.",
      }),
    ).toBe("This story needs a safety review before it can go live.")
  })
})
