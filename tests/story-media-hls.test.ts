import { beforeEach, describe, expect, it } from "vitest"

import {
  forwardCloudflarePlaybackOptions,
  publicStoryMediaUrl,
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

  it("advertises exact selection to new builds across feed and story URLs without changing old builds", () => {
    for (const pathname of ['cloudflare-stream/0123456789abcdef0123456789abcdef/manifest/video.m3u8', 'media/hls/asset/master.m3u8']) {
      const source = `/api/story-media/${pathname}`
      const modern = publicStoryMediaUrl(source, new Request('https://www.ubeye.ai/api/mobile/feed', { headers: { 'x-ubeye-app-build': '447' } }), { signed: true })!
      expect(new URL(modern).searchParams.get('selection')).toBe('exact-v1')
      expect(signedPathname(modern).valid).toBe(true)
      const old = publicStoryMediaUrl(source, new Request('https://www.ubeye.ai/api/mobile/feed', { headers: { 'x-ubeye-app-build': '446' } }), { signed: true })!
      expect(new URL(old).searchParams.has('selection')).toBe(false)
    }
  })

  it("signs master variants, CMAF maps, and segments independently", () => {
    const master = rewriteHlsPlaylistForStoryMedia(
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="audio"\n540p/index.m3u8\n',
      "media/hls-v2/asset/master.m3u8",
    )
    const audioUri = master.match(/TYPE=AUDIO[^\n]+URI="([^"]+)"/)?.[1]
    expect(audioUri && signedPathname(audioUri)).toEqual({
      pathname: "media/hls-v2/asset/audio/index.m3u8",
      valid: true,
    })
    const masterVariant = signedPathname(master.split("\n")[3])
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
