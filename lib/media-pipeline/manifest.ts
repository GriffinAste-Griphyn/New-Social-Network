import type { MediaRenditionProfile } from "./contracts"

export type PublishedRendition = {
  profile: MediaRenditionProfile
  playlistUrl: string
  codec: string
  byteSize: number
  durationMs: number
  frameRate: number | null
}

export function buildHlsMasterPlaylist(renditions: PublishedRendition[]) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]

  for (const rendition of renditions) {
    const durationSeconds = Math.max(rendition.durationMs / 1_000, 0.001)
    const averageBandwidth = Math.max(
      1,
      Math.ceil((rendition.byteSize * 8) / durationSeconds),
    )
    const peakBandwidth = Math.max(
      averageBandwidth + 1,
      Math.ceil(averageBandwidth * 1.15),
    )
    const frameRate = Math.min(Math.max(rendition.frameRate ?? 30, 1), 30)
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${peakBandwidth},AVERAGE-BANDWIDTH=${averageBandwidth},RESOLUTION=${rendition.profile.width}x${rendition.profile.height},FRAME-RATE=${frameRate.toFixed(3)},CODECS="${rendition.codec}"`,
      rendition.playlistUrl,
    )
  }

  return `${lines.join("\n")}\n`
}
