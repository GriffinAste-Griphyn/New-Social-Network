import type { MediaRenditionProfile } from "./contracts"

export type PublishedRendition = {
  profile: MediaRenditionProfile
  playlistUrl: string
  codec: string
  averageBandwidth: number
  peakBandwidth: number
  frameRate: number | null
}

export type PublishedAudioRendition = {
  playlistUrl: string
  codec: string
  averageBandwidth: number
  peakBandwidth: number
}

type HlsPackageFile = {
  fileName: string
  body: Buffer
}

export type MeasuredHlsBandwidth = {
  averageBandwidth: number
  peakBandwidth: number
  segmentCount: number
  mediaByteSize: number
  durationSeconds: number
}

export function measureHlsPackageBandwidth(
  files: readonly HlsPackageFile[],
): MeasuredHlsBandwidth {
  const playlist = files.find((file) => file.fileName === "index.m3u8")
  if (!playlist) throw new Error("The HLS media playlist is missing.")

  const filesByName = new Map(files.map((file) => [file.fileName, file]))
  const lines = playlist.body.toString("utf8").split(/\r?\n/)
  const segments: Array<{ byteSize: number; durationSeconds: number }> = []
  let pendingDurationSeconds: number | null = null

  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      const durationSeconds = Number.parseFloat(
        line.slice("#EXTINF:".length).split(",", 1)[0] ?? "",
      )
      pendingDurationSeconds =
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? durationSeconds
          : null
      continue
    }
    if (!line || line.startsWith("#") || pendingDurationSeconds === null) {
      continue
    }

    const fileName = line.split("?", 1)[0]?.split("/").at(-1)
    const segment = fileName ? filesByName.get(fileName) : null
    if (!segment) {
      throw new Error(`The HLS segment ${line} is missing.`)
    }
    segments.push({
      byteSize: segment.body.byteLength,
      durationSeconds: pendingDurationSeconds,
    })
    pendingDurationSeconds = null
  }

  if (segments.length === 0) {
    throw new Error("The HLS media playlist has no measurable segments.")
  }

  const durationSeconds = segments.reduce(
    (total, segment) => total + segment.durationSeconds,
    0,
  )
  const mediaByteSize = segments.reduce(
    (total, segment) => total + segment.byteSize,
    0,
  )
  const peakBandwidth = Math.max(
    ...segments.map((segment) =>
      Math.ceil((segment.byteSize * 8) / segment.durationSeconds),
    ),
  )

  return {
    averageBandwidth: Math.max(
      1,
      Math.ceil((mediaByteSize * 8) / durationSeconds),
    ),
    peakBandwidth: Math.max(1, peakBandwidth),
    segmentCount: segments.length,
    mediaByteSize,
    durationSeconds,
  }
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
    const combinedAverageBandwidth =
      rendition.averageBandwidth + (audio?.averageBandwidth ?? 0)
    const combinedPeakBandwidth =
      rendition.peakBandwidth + (audio?.peakBandwidth ?? 0)
    const frameRate = Math.min(Math.max(rendition.frameRate ?? 30, 1), 60)
    const codecs = audio ? `${rendition.codec},${audio.codec}` : rendition.codec
    const audioGroup = audio ? ',AUDIO="audio"' : ""
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${combinedPeakBandwidth},AVERAGE-BANDWIDTH=${combinedAverageBandwidth},RESOLUTION=${rendition.profile.width}x${rendition.profile.height},FRAME-RATE=${frameRate.toFixed(3)},VIDEO-RANGE=SDR,CODECS="${codecs}"${audioGroup}`,
      rendition.playlistUrl,
    )
  }

  return `${lines.join("\n")}\n`
}
