import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchStoryMaster, renditionResponse, requestedRendition, selectStoryRendition } from "../lib/story-media/renditions"

const base = "https://customer.example.cloudflarestream.com/signed/manifest/video.m3u8"
const master = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Main",URI="../audio/index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",URI="../subs/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=240x426,CODECS="avc1.640028,mp4a.40.2",AUDIO="a"
../240/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1080x1920,CODECS="avc1.640028,mp4a.40.2",AUDIO="a",SUBTITLES="s"
../1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=720x1280,CODECS="avc1.640028,mp4a.40.2",AUDIO="a"
../720/index.m3u8
`

describe("exact story playback", () => {
  afterEach(() => vi.unstubAllGlobals())
  it("chooses by resolution even when bandwidth ordering contradicts it", () => {
    const result = selectStoryRendition(master, base, 1080)
    expect(result).toMatchObject({ width: 1080, height: 1920, bandwidth: 1000000 })
    expect(result.playlist.match(/#EXT-X-STREAM-INF/g)).toHaveLength(1)
    expect(result.playlist).toContain('/signed/1080/index.m3u8')
    expect(result.playlist).toContain('/signed/audio/index.m3u8')
    expect(result.playlist).toContain('/signed/subs/index.m3u8')
    expect(result.playlist).toContain('CODECS="avc1.640028,mp4a.40.2"')
    expect(result.playlist).toContain('#EXT-X-INDEPENDENT-SEGMENTS')
    expect(result.playlist).not.toContain('/240/')
  })
  it("selects 720 independently and drops unrelated subtitle groups", () => {
    const result = selectStoryRendition(master, base, 720)
    expect(result).toMatchObject({ width: 720, height: 1280 })
    expect(result.playlist).not.toContain('/1080/')
    expect(result.playlist).not.toContain('SUBTITLES')
  })
  it("handles landscape and smaller sources without inventing HD", () => {
    expect(selectStoryRendition(master.replace('1080x1920', '1920x1080'), base, 1080).width).toBe(1920)
    const small = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=480x852\n480.m3u8\n'
    expect(selectStoryRendition(small, base, 1080)).toMatchObject({ width: 480, height: 852 })
  })
  it("rejects malformed manifests, missing groups, credentials and foreign resources", () => {
    for (const invalid of ["<html>login</html>", master.replace('GROUP-ID="a"', 'GROUP-ID="missing"'),
      master.replace('../1080/index.m3u8', 'https://evil.example/stream'),
      master.replace('../audio/index.m3u8', 'https://user:pass@customer.example.cloudflarestream.com/audio'),
      master.replace('1080x1920', '0x1920'), master + '#EXT-X-SESSION-KEY:METHOD=AES-128\n',
      master + ' '.repeat(65536)]) {
      expect(() => selectStoryRendition(invalid, base, 1080)).toThrow()
    }
  })
  it("does not cache signed manifests and reports the actual selected dimensions", async () => {
    const response = renditionResponse(master, base, 1080)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('x-ubeye-rendition')).toBe('1080x1920')
    expect(await response.text()).toContain('/signed/1080/index.m3u8')
    expect(requestedRendition(base + '?rendition=720')).toBe(720)
    expect(requestedRendition(base + '?rendition=2160')).toBeNull()
    expect(requestedRendition(base)).toBeNull()
  })
  it("bounds provider responses and refuses redirects and HTTP errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(master))
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchStoryMaster(base)).toBe(master)
    expect(fetcher).toHaveBeenCalledWith(base, expect.objectContaining({ redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal) }))
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(65537)))
    await expect(fetchStoryMaster(base)).rejects.toThrow('too large')
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(fetchStoryMaster(base)).rejects.toThrow('unavailable')
  })
})
