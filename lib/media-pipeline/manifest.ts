import type { MediaRenditionProfile } from "./contracts"

export type PublishedRendition = {
  profile: MediaRenditionProfile
  playlistUrl: string
  codec: string
  byteSize: number
  durationMs: number
  frameRate: number | null
}

export type PublishedAudioRendition = {
  playlistUrl: string
  codec: string
  bitrate: number
}

export function buildHlsMasterPlaylist(
  renditions: PublishedRendition[],
  audio?: PublishedAudioRendition | null,
) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]

  if (audio) {
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Original",DEFAULT=YES,AUTOSELECT=YES,URI="${audio.playlistUrl}"`,
    )
  }

  for (const rendition of renditions) {
    const durationSeconds = Math.max(rendition.durationMs / 1_000, 0.001)
    const averageBandwidth = Math.max(
      1,
      Math.ceil((rendition.byteSize * 8) / durationSeconds),
    )
    const combinedAverageBandwidth = averageBandwidth + (audio?.bitrate ?? 0)
    const peakBandwidth = Math.max(
      combinedAverageBandwidth + 1,
      Math.ceil(combinedAverageBandwidth * 1.15),
    )
    const frameRate = Math.min(Math.max(rendition.frameRate ?? 30, 1), 30)
    const codecs = audio ? `${rendition.codec},${audio.codec}` : rendition.codec
    const audioGroup = audio ? ',AUDIO="audio"' : ""
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${peakBandwidth},AVERAGE-BANDWIDTH=${combinedAverageBandwidth},RESOLUTION=${rendition.profile.width}x${rendition.profile.height},FRAME-RATE=${frameRate.toFixed(3)},CODECS="${codecs}"${audioGroup}`,
      rendition.playlistUrl,
    )
  }

  return `${lines.join("\n")}\n`
}
