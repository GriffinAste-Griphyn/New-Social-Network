import { describe, expect, it } from "vitest"
import { deliveryComparisonGraph, deliveryVariants } from "../lib/media-pipeline/delivery-quality"

const origin = "https://media.example/signed/manifest/video.m3u8"
const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Main",URI="../audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1080x1920,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio"\n../1080/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=720x1280\n../720/index.m3u8\n'

describe("delivery quality measurement", () => {
  it("isolates the exact advertised variant and preserves its separate audio", () => {
    const variants = deliveryVariants(master, origin)
    expect(variants).toHaveLength(2)
    expect(variants[0]).toMatchObject({ width: 1080, height: 1920, bandwidth: 3500000 })
    expect(variants[0].playlist).toContain('URI="https://media.example/signed/audio/index.m3u8"')
    expect(variants[0].playlist).toContain("https://media.example/signed/1080/index.m3u8")
    expect(variants[0].playlist).not.toContain("/720/")
    expect(variants[1].playlist).not.toContain("EXT-X-MEDIA")
  })
  it("fails closed for malformed masters, missing audio and foreign URLs", () => {
    expect(() => deliveryVariants("<html>denied</html>", origin)).toThrow()
    expect(() => deliveryVariants(master.replace('../1080/index.m3u8', 'https://evil.example/video'), origin)).toThrow()
    expect(() => deliveryVariants(master.replace('GROUP-ID="audio"', 'GROUP-ID="missing"'), origin)).toThrow()
    expect(() => deliveryVariants(master.replace('../audio/index.m3u8', 'http://media.example/audio'), origin)).toThrow()
  })
  it("compares lower renditions at the original display size, not a downscaled reference", () => {
    const graph = deliveryComparisonGraph(1080, 1920, 30)
    expect(graph.match(/scale=1080:1920/g)).toHaveLength(2)
    expect(deliveryComparisonGraph(3840, 2160, 60).match(/scale=1920:1080/g)).toHaveLength(2)
    expect(() => deliveryComparisonGraph(1080, 1920, Number.NaN)).toThrow()
  })
})
