import { afterEach, describe, expect, it, vi } from "vitest"
import { canRepackageSourceVideo, hasBoundedIndependentSegments, repackageVideoArguments, firstAvcPacketIsIdr } from "@/lib/media-pipeline/source-repackaging"
import { mediaRenditionProfiles, type MediaSourceMetadata } from "@/lib/media-pipeline/contracts"
import { planNextMediaProcessingStage } from "@/lib/media-pipeline/direct-processing"

const profile = mediaRenditionProfiles[3]
const source: MediaSourceMetadata = { width:1080, height:1920, durationMs:10000, frameRate:30,
  videoCodec:"h264", videoProfile:"High", videoLevel:41, audioCodec:"aac", hasAudio:true, rotation:0,
  pixelFormat:"yuv420p", sampleAspectRatio:"1:1", colorTransfer:"bt709", colorPrimaries:"bt709",
  fieldOrder:"progressive", videoBitrate:6_000_000 }
afterEach(() => vi.unstubAllEnvs())
describe("lossless source frame reuse", () => {
  it("prioritizes an exact compatible source rendition before another encode", () => {
    expect(canRepackageSourceVideo(source, profile)).toBe(true)
    expect(planNextMediaProcessingStage({source, hasPoster:true, hasAudioRendition:true,
      readyVariantLabels:new Set()})).toEqual({kind:"rendition", profile})
    const args = repackageVideoArguments({inputPath:"/tmp/source.mp4", outputDirectory:"/tmp/output"})
    expect(args).toContain("copy")
    expect(args).not.toContain("libx264")
    expect(args).not.toContain("-filter_complex")
  })
  it.each([
    {rotation:90}, {width:1920,height:1080}, {pixelFormat:"yuv420p10le"}, {sampleAspectRatio:"4:3"},
    {colorTransfer:"smpte2084"}, {colorPrimaries:null}, {frameRate:60}, {fieldOrder:"tt"},
    {videoBitrate:null}, {videoBitrate:12_000_000}, {videoProfile:"Main"}, {videoLevel:42}, {videoCodec:"hevc"},
  ])("retains encoding for unsupported source metadata %j", changes => {
    expect(canRepackageSourceVideo({...source, ...changes}, profile)).toBe(false)
  })
  it("requires each segment to start with an IDR video packet", () => {
    expect(firstAvcPacketIsIdr("00000000: 0000 0002 65aa  .." )).toBe(true)
    expect(firstAvcPacketIsIdr("00000000: 0000 0002 61aa  .." )).toBe(false)
    expect(firstAvcPacketIsIdr("00000000: 0000 0100 65aa  .." )).toBe(false)
  })
  it("retains the rollback switch", () => {
    vi.stubEnv("MEDIA_SOURCE_REPACKAGING_ENABLED", "false")
    expect(canRepackageSourceVideo(source, profile)).toBe(false)
  })
  it("rejects long source GOPs and incomplete packages", () => {
    const playlist = "#EXTM3U\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXTINF:2.0,\nsegment.m4s\n#EXT-X-ENDLIST"
    expect(hasBoundedIndependentSegments(playlist)).toBe(true)
    expect(hasBoundedIndependentSegments(playlist.replace("2.0", "5.0"))).toBe(false)
    expect(hasBoundedIndependentSegments(playlist.replace("#EXT-X-ENDLIST", ""))).toBe(false)
  })
})
