import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createCloudflareStreamPlaybackUrl } from "@/lib/story-storage"
import { checkCloudflareStreamPlayback } from "@/lib/video-health"

vi.mock("@/lib/story-storage", () => ({
  createCloudflareStreamPlaybackUrl: vi.fn(),
}))

describe("video playback health probe", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("validates the configured canary before generating a signed URL", async () => {
    const result = await checkCloudflareStreamPlayback("not-a-stream-uid")

    expect(result).toMatchObject({
      ok: false,
      status: null,
      error: "The playback canary UID is invalid.",
    })
    expect(createCloudflareStreamPlaybackUrl).not.toHaveBeenCalled()
  })

  it("accepts a reachable signed HLS manifest", async () => {
    vi.mocked(createCloudflareStreamPlaybackUrl).mockResolvedValue(
      "https://stream.example.com/signed/manifest/video.m3u8",
    )
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("#EXTM3U\n#EXT-X-VERSION:6", { status: 200 }),
      ),
    )

    const result = await checkCloudflareStreamPlayback(
      "0123456789abcdef0123456789abcdef",
    )

    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(fetch).toHaveBeenCalledWith(
      "https://stream.example.com/signed/manifest/video.m3u8",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("rejects an HTTP success that is not an HLS manifest", async () => {
    vi.mocked(createCloudflareStreamPlaybackUrl).mockResolvedValue(
      "https://stream.example.com/signed/manifest/video.m3u8",
    )
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not hls", { status: 200 })),
    )

    const result = await checkCloudflareStreamPlayback(
      "fedcba9876543210fedcba9876543210",
    )

    expect(result).toMatchObject({
      ok: false,
      status: 200,
      error: "The playback canary did not return an HLS manifest.",
    })
  })
})
