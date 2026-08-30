import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createCloudflareStreamPlaybackUrl } from "@/lib/story-storage"
import {
  checkCloudflareStreamPlayback,
  checkVercelHlsPlayback,
  discoverCloudflareStreamPlaybackCanaries,
} from "@/lib/video-health"

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

  it("discovers ready playback canaries through the Stream account API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          result: [
            { uid: "0123456789abcdef0123456789abcdef" },
            { uid: "not-a-uid" },
          ],
        }),
      ),
    )

    const result = await discoverCloudflareStreamPlaybackCanaries({
      accountId: "account-id",
      apiToken: "api-token",
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      uids: ["0123456789abcdef0123456789abcdef"],
    })
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/client/v4/accounts/account-id/stream",
      }),
      expect.objectContaining({
        headers: { Authorization: "Bearer api-token" },
      }),
    )
  })

  it("reports Stream account API authorization failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { success: false, errors: [{ message: "Authentication error" }] },
          { status: 403 },
        ),
      ),
    )

    await expect(
      discoverCloudflareStreamPlaybackCanaries({
        accountId: "account-id",
        apiToken: "bad-token",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
      uids: [],
      error: "Cloudflare Stream API probe failed: Authentication error",
    })
  })

  it("probes a public Vercel HLS master through its first media segment", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString()
      if (url.endsWith("/master-360p.m3u8")) {
        return new Response(
          "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=700000\n360p/index.m3u8\n",
          { status: 200 },
        )
      }
      if (url.endsWith("/360p/index.m3u8")) {
        return new Response(
          '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2.0,\nsegment-00000.m4s\n',
          { status: 200 },
        )
      }
      if (url.endsWith("/360p/init.mp4")) {
        return new Response(new Uint8Array([0, 1]), { status: 206 })
      }
      if (url.endsWith("/360p/segment-00000.m4s")) {
        return new Response(new Uint8Array([2, 3]), { status: 206 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await checkVercelHlsPlayback(
      "https://store.public.blob.vercel-storage.com/media/canary/master-360p.m3u8",
    )

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      resources: {
        master: 200,
        variant: 200,
        initialization: 206,
        segment: 206,
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("rejects a Vercel HLS canary outside the public delivery store", async () => {
    const result = await checkVercelHlsPlayback(
      "https://example.com/media/master-360p.m3u8",
    )

    expect(result).toMatchObject({
      ok: false,
      status: null,
      error: "The HLS playback canary URL is not a public Vercel Blob URL.",
    })
  })
})
