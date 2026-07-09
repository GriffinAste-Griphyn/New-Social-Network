import { afterEach, describe, expect, it } from "vitest"

import { isCloudflareStreamFullyReady } from "@/lib/media-upload-sessions"
import { allowsLegacyOriginalVideoStory } from "@/lib/mobile-media-pipeline"
import { deriveCloudflareStoryStatus } from "@/lib/stories/cloudflare-status"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("media publication state", () => {
  it("does not call a partially encoded video full-quality ready", () => {
    expect(
      isCloudflareStreamFullyReady({
        readyToStream: true,
        state: "ready",
        pctComplete: 99,
      }),
    ).toBe(false)
    expect(
      isCloudflareStreamFullyReady({
        readyToStream: true,
        state: "ready",
        pctComplete: 100,
      }),
    ).toBe(true)
    expect(
      isCloudflareStreamFullyReady({
        readyToStream: true,
        state: "ready",
        pctComplete: null,
      }),
    ).toBe(true)
  })

  it("publishes only when provider readiness and moderation approval agree", () => {
    const base = {
      currentStatus: "processing" as const,
      expiresAt: new Date("2026-07-10T00:00:00.000Z"),
      now: new Date("2026-07-09T00:00:00.000Z"),
    }

    expect(
      deriveCloudflareStoryStatus({
        ...base,
        moderationStatus: "approved",
        providerReady: true,
      }),
    ).toBe("live")
    expect(
      deriveCloudflareStoryStatus({
        ...base,
        moderationStatus: "approved",
        providerReady: false,
      }),
    ).toBe("processing")
    expect(
      deriveCloudflareStoryStatus({
        ...base,
        moderationStatus: "flagged",
        providerReady: true,
      }),
    ).toBe("processing")
  })

  it("never resurrects removed or expired stories from a provider callback", () => {
    expect(
      deriveCloudflareStoryStatus({
        currentStatus: "removed",
        moderationStatus: "approved",
        providerReady: true,
        expiresAt: new Date("2026-07-10T00:00:00.000Z"),
        now: new Date("2026-07-09T00:00:00.000Z"),
      }),
    ).toBe("removed")
    expect(
      deriveCloudflareStoryStatus({
        currentStatus: "processing",
        moderationStatus: "approved",
        providerReady: true,
        expiresAt: new Date("2026-07-08T00:00:00.000Z"),
        now: new Date("2026-07-09T00:00:00.000Z"),
      }),
    ).toBe("expired")
  })
})

describe("legacy progressive video rollout", () => {
  it("rejects the legacy path for hls-v2 clients even during compatibility", () => {
    process.env.ALLOW_LEGACY_ORIGINAL_VIDEO_UPLOADS = "true"
    const request = new Request("https://app.example.com", {
      headers: { "X-UBEYE-Media-Pipeline": "hls-v2" },
    })

    expect(
      allowsLegacyOriginalVideoStory({ request, phase: "prepare" }),
    ).toBe(false)
  })

  it("keeps headerless legacy completion available only through its grace window", () => {
    delete process.env.ALLOW_LEGACY_ORIGINAL_VIDEO_UPLOADS
    delete process.env.LEGACY_ORIGINAL_VIDEO_UPLOADS_UNTIL
    const request = new Request("https://app.example.com")

    expect(
      allowsLegacyOriginalVideoStory({
        request,
        phase: "complete",
        now: Date.parse("2026-08-09T12:00:00.000Z"),
      }),
    ).toBe(true)
    expect(
      allowsLegacyOriginalVideoStory({
        request,
        phase: "complete",
        now: Date.parse("2026-08-10T00:00:00.000Z"),
      }),
    ).toBe(false)
  })
})
