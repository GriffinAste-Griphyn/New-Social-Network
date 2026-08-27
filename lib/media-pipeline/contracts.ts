export const mediaPipelineVersion = "hls-v4"
export const mediaEncoderVersion = "ffmpeg-static-5.3.0-h264-v4"
export const maximumMediaProcessingAttempts = 8

export type MediaSourceMetadata = {
  width: number
  height: number
  durationMs: number
  frameRate: number | null
  videoCodec: string
  audioCodec: string | null
  audioChannels?: number | null
  hasAudio: boolean
  rotation: number
  colorTransfer?: string | null
  colorPrimaries?: string | null
}

export type MediaRenditionProfile = {
  label: "360p" | "540p" | "720p" | "1080p"
  width: number
  height: number
  videoBitrate: number
  maxRate: number
  bufferSize: number
  audioBitrate: number
  crf: number
  preset: "fast" | "medium"
}

export const mediaRenditionProfiles: readonly MediaRenditionProfile[] = [
  {
    label: "360p",
    width: 360,
    height: 640,
    videoBitrate: 700_000,
    maxRate: 900_000,
    bufferSize: 1_800_000,
    audioBitrate: 64_000,
    crf: 26,
    preset: "fast",
  },
  {
    label: "540p",
    width: 540,
    height: 960,
    videoBitrate: 1_600_000,
    maxRate: 2_200_000,
    bufferSize: 4_400_000,
    audioBitrate: 96_000,
    crf: 24,
    preset: "medium",
  },
  {
    label: "720p",
    width: 720,
    height: 1280,
    videoBitrate: 2_800_000,
    maxRate: 3_800_000,
    bufferSize: 7_600_000,
    audioBitrate: 128_000,
    crf: 23,
    preset: "medium",
  },
  {
    label: "1080p",
    width: 1080,
    height: 1920,
    videoBitrate: 6_000_000,
    maxRate: 8_000_000,
    bufferSize: 16_000_000,
    audioBitrate: 128_000,
    crf: 22,
    preset: "medium",
  },
] as const

export const mediaPipelineLimits = {
  maximumDurationMs: 120_000,
  maximumSourceBytes: 512 * 1024 * 1024,
  minimumDimension: 240,
  segmentDurationSeconds: 2,
  maximumFrameRate: 30,
} as const

export function isVercelHlsPipelineEnabled() {
  return (
    process.env.MEDIA_PIPELINE_ENABLED === "true" &&
    process.env.STORY_VIDEO_PROCESSOR === "vercel-hls"
  )
}

export function selectRenditionProfiles(
  source: Pick<MediaSourceMetadata, "width" | "height" | "rotation">,
) {
  const rotated = Math.abs(source.rotation) % 180 === 90
  const displayHeight = rotated ? source.width : source.height
  const eligible = mediaRenditionProfiles.filter(
    (profile) => profile.height <= displayHeight,
  )

  // A valid source should always be at least 360p. Retaining the fallback makes
  // the planner total and lets quality control report a precise source failure.
  return eligible.length > 0 ? eligible : [mediaRenditionProfiles[0]]
}

export function validateSourceMetadata(source: MediaSourceMetadata) {
  if (!Number.isFinite(source.durationMs) || source.durationMs <= 0) {
    return "source_duration_invalid" as const
  }
  if (source.durationMs > mediaPipelineLimits.maximumDurationMs) {
    return "source_duration_exceeded" as const
  }
  if (
    source.width < mediaPipelineLimits.minimumDimension ||
    source.height < mediaPipelineLimits.minimumDimension
  ) {
    return "source_dimensions_too_small" as const
  }
  if (!source.videoCodec) {
    return "source_video_stream_missing" as const
  }

  return null
}
