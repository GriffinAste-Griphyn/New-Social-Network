import { beforeEach, describe, expect, it } from "vitest"

import {
  forwardCloudflarePlaybackOptions,
  verifyStoryMediaAccessToken,
} from "@/lib/story-media/access"
import { rewriteHlsPlaylistForStoryMedia } from "@/lib/story-media/hls"

function signedPathname(urlValue: string) {
  const url = new URL(urlValue, "https://app.example.com")
  const prefix = "/api/story-media/"
  const pathname = url.pathname
    .slice(prefix.length)
    .split("/")
    .map(decodeURIComponent)
    .join("/")
  return {
    pathname,
    valid: verifyStoryMediaAccessToken(pathname, url.searchParams.get("token")),
  }
}

describe("signed HLS media delivery", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test"
    process.env.AUTH_SECRET = "story-media-hls-test-secret-at-least-32-characters"
  })

  it("signs master variants, CMAF maps, and segments independently", () => {
    const master = rewriteHlsPlaylistForStoryMedia(
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n540p/index.m3u8\n",
      "media/hls-v2/asset/master.m3u8",
    )
    const masterVariant = signedPathname(master.split("\n")[2])
    expect(masterVariant).toEqual({
      pathname: "media/hls-v2/asset/540p/index.m3u8",
      valid: true,
    })

    const variant = rewriteHlsPlaylistForStoryMedia(
      '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nsegment-00001.m4s\n',
      "media/hls-v2/asset/540p/index.m3u8",
    )
    const mapUri = variant.match(/URI="([^"]+)"/)?.[1]
    expect(mapUri && signedPathname(mapUri)).toEqual({
      pathname: "media/hls-v2/asset/540p/init.mp4",
      valid: true,
    })
    expect(signedPathname(variant.split("\n")[2])).toEqual({
      pathname: "media/hls-v2/asset/540p/segment-00001.m4s",
      valid: true,
    })
  })

  it("does not rewrite absolute or cross-prefix paths", () => {
    const playlist = rewriteHlsPlaylistForStoryMedia(
      "https://example.com/segment.m4s\n../../../../stories/private.jpg\n",
      "media/hls-v2/asset/540p/index.m3u8",
    )
    expect(playlist).toContain("https://example.com/segment.m4s")
    expect(playlist).toContain("../../../../stories/private.jpg")
  })

  it("forwards only a bounded startup bandwidth hint to Cloudflare", () => {
    const playbackUrl =
      "https://customer.example.cloudflarestream.com/signed/manifest/video.m3u8?token=remote"

    expect(
      forwardCloudflarePlaybackOptions(
        playbackUrl,
        "https://app.example.com/api/story-media/cloudflare-stream/id/manifest/video.m3u8?token=local&clientBandwidthHint=8.000",
      ),
    ).toBe(
      "https://customer.example.cloudflarestream.com/signed/manifest/video.m3u8?token=remote&clientBandwidthHint=8",
    )
    expect(
      forwardCloudflarePlaybackOptions(
        playbackUrl,
        "https://app.example.com/media?clientBandwidthHint=200",
      ),
    ).toBe(playbackUrl)
    expect(
      forwardCloudflarePlaybackOptions(
        playbackUrl,
        "https://app.example.com/media?clientBandwidthHint=not-a-number",
      ),
    ).toBe(playbackUrl)
  })
})
