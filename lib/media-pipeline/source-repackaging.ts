import path from "node:path"
import { spawn } from "node:child_process"
import type { MediaSourceMetadata, MediaRenditionProfile } from "./contracts"

/** No scaling, color conversion, cadence conversion or video recompression. */
export function canRepackageSourceVideo(source: MediaSourceMetadata, profile: MediaRenditionProfile) {
  return process.env.MEDIA_SOURCE_REPACKAGING_ENABLED !== "false" &&
    source.videoCodec === "h264" && source.videoProfile === "High" && source.videoLevel === 41 && source.rotation === 0 &&
    source.width === profile.width && source.height === profile.height &&
    source.pixelFormat === "yuv420p" && source.sampleAspectRatio === "1:1" &&
    source.colorTransfer === "bt709" && source.colorPrimaries === "bt709" &&
    (source.fieldOrder == null || source.fieldOrder === "progressive") && source.frameRate != null &&
    source.frameRate >= 24 && source.frameRate <= 30 &&
    source.durationMs > 0 && source.durationMs <= 120_000 &&
    source.videoBitrate != null && Number.isFinite(source.videoBitrate) &&
    source.videoBitrate > 0 && source.videoBitrate <= profile.maxRate
}

export function repackageVideoArguments(input: { inputPath: string; outputDirectory: string }) {
  return ["-hide_banner", "-nostdin", "-y", "-noautorotate", "-i", input.inputPath,
    "-map", "0:v:0", "-c:v", "copy", "-an", "-hls_time", "2", "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4", "-hls_flags", "independent_segments+temp_file",
    "-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename",
    path.join(input.outputDirectory, "segment-%05d.m4s"), path.join(input.outputDirectory, "index.m3u8")]
}

export function hasBoundedIndependentSegments(playlist: string) {
  const durations = [...playlist.matchAll(/^#EXTINF:([\d.]+),/gm)].map(match => Number(match[1]))
  return playlist.startsWith("#EXTM3U") && playlist.includes("#EXT-X-ENDLIST") &&
    playlist.includes("#EXT-X-INDEPENDENT-SEGMENTS") && durations.length > 0 &&
    durations.every(duration => Number.isFinite(duration) && duration > 0 && duration <= 3)
}

/** Check every SPS, including files whose older ffprobe omits field_order. */
export function verifyProgressiveAvcHeaders(ffmpeg: string, inputPath: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-nostdin", "-i", inputPath, "-map", "0:v:0",
      "-c:v", "copy", "-bsf:v", "trace_headers", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] })
    let remainder = "", valid = true, seen = false
    const expected: Record<string, number> = { frame_mbs_only_flag: 1, profile_idc: 100, level_idc: 41,
      bit_depth_luma_minus8: 0, bit_depth_chroma_minus8: 0, chroma_format_idc: 1, constraint_set0_flag: 0, constraint_set1_flag: 0, constraint_set2_flag: 0,
      constraint_set3_flag: 0, constraint_set4_flag: 0, constraint_set5_flag: 0 }
    const timer = setTimeout(() => { valid = false; child.kill() }, 15_000)
    child.stderr.on("data", (chunk: Buffer) => {
      const lines = (remainder + chunk.toString("utf8")).split("\n")
      remainder = (lines.pop() ?? "").slice(-4096)
      for (const line of lines) {
        const value = line.match(/\b(frame_mbs_only_flag|profile_idc|level_idc|bit_depth_luma_minus8|bit_depth_chroma_minus8|chroma_format_idc|constraint_set[0-5]_flag)\s+.*=\s*(\d+)\s*$/)
        if (!value) continue
        if (value[1] === "frame_mbs_only_flag") seen = true
        if (Number(value[2]) !== expected[value[1]]) valid = false
      }
    })
    child.once("error", () => { clearTimeout(timer); resolve(false) })
    child.once("close", code => { clearTimeout(timer); resolve(code === 0 && valid && seen) })
  })
}

export function firstAvcPacketIsIdr(packetDump: string) {
  const hex = packetDump.split("\n").map(line =>
    line.match(/^[0-9a-f]+:\s+(.+)$/i)?.[1]?.split(/\s{2,}/)[0]?.replace(/\s/g, "") ?? "").join("")
  if (!hex || !/^[a-f0-9]+$/i.test(hex) || hex.length % 2) return false
  const bytes = Buffer.from(hex, "hex")
  let offset = 0
  while (offset + 4 < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    offset += 4
    if (!length || offset + length > bytes.length) return false
    const type = bytes[offset] & 31
    if (type >= 1 && type <= 5) return type === 5
    offset += length
  }
  return false
}
