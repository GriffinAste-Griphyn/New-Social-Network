import type { MediaRenditionProfile } from "./contracts"

export type PublishedRendition = {
  profile: MediaRenditionProfile
  playlistUrl: string
  codec: string
}

export function buildHlsMasterPlaylist(renditions: PublishedRendition[]) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]

  for (const rendition of renditions) {
    const audioBitrate = rendition.codec.includes("mp4a")
      ? rendition.profile.audioBitrate
      : 0
    const averageBandwidth =
      rendition.profile.videoBitrate + audioBitrate
    const peakBandwidth =
      rendition.profile.maxRate + audioBitrate
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${peakBandwidth},AVERAGE-BANDWIDTH=${averageBandwidth},RESOLUTION=${rendition.profile.width}x${rendition.profile.height},FRAME-RATE=30.000,CODECS="${rendition.codec}"`,
      rendition.playlistUrl,
    )
  }

  return `${lines.join("\n")}\n`
}
