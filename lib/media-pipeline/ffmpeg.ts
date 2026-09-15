import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import ffmpegStaticPath from "ffmpeg-static"
import ffprobeInstaller from "@ffprobe-installer/ffprobe"
import { isAudioLoudnessNormalizationEnabled } from "./features"
import { canRepackageSourceVideo, repackageVideoArguments, hasBoundedIndependentSegments, verifyProgressiveAvcHeaders, firstAvcPacketIsIdr } from "./source-repackaging"

import {
  maximumRenditionFrameRate,
  mediaAudioProfile,
  mediaPipelineLimits,
  type MediaRenditionProfile,
  type MediaSourceMetadata,
} from "./contracts"

type ProbeStream = {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  channels?: number
  sample_rate?: string
  bit_rate?: string
  color_transfer?: string
  color_primaries?: string
  field_order?: string
  pix_fmt?: string
  profile?: string
  level?: number
  sample_aspect_ratio?: string
  tags?: { rotate?: string }
  side_data_list?: Array<{ rotation?: number }>
}

type ProbeResult = {
  streams?: ProbeStream[]
  format?: { duration?: string }
}

export type MediaAudioMetadata = {
  durationMs: number
  audioCodec: string
  audioChannels: number | null
  audioSampleRate: number | null
  audioBitrate: number | null
  hasVideo: boolean
}

function requiredBinary(value: string | null | undefined, name: string) {
  if (!value) throw new Error(`${name} binary is unavailable in this deployment.`)
  return value
}

function aspectFitCanvasFilter(input: {
  inputLabel: string
  outputLabel?: string
  width: number
  height: number
  pixelFormat?: string
}) {
  const { inputLabel, outputLabel = "", width, height, pixelFormat } = input
  const format = pixelFormat ? `,format=${pixelFormat}` : ""
  return `${inputLabel}scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1${format}${outputLabel}`
}

export function mediaBinaryPaths() {
  return {
    ffmpeg: requiredBinary(process.env.FFMPEG_PATH ?? ffmpegStaticPath, "FFmpeg"),
    ffprobe: requiredBinary(
      process.env.FFPROBE_PATH ?? ffprobeInstaller.path,
      "FFprobe",
    ),
  }
}

function frameRate(value?: string) {
  if (!value) return null
  const parts = value.split("/")
  const numerator = Number(parts[0])
  const denominator = Number(parts[1] ?? "1")
  const parsed = numerator / denominator
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function* webStreamChunks(input: ReadableStream<Uint8Array>) {
  const reader = input.getReader()
  let completed = false
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        completed = true
        return
      }
      yield Buffer.from(result.value)
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined)
    }
    reader.releaseLock()
  }
}

function runWithInput(
  command: string,
  args: string[],
  input: ReadableStream<Uint8Array>,
) {
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })
    const source = Readable.from(webStreamChunks(input))
    const stdout: Buffer[] = []
    let stderr = ""
    let sourceError: Error | null = null
    let settled = false

    const settle = (
      callback: () => void,
    ) => {
      if (settled) return
      settled = true
      callback()
    }

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-64_000)
    })
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      // FFmpeg/FFprobe may intentionally close stdin after reading enough
      // bytes (for example, once a poster frame is decoded). In that case the
      // source pipe receives EPIPE even though the child process succeeds.
      // The child exit code remains the authoritative result.
      if (error.code !== "EPIPE") {
        sourceError = error
        child.kill()
      }
    })
    source.on("error", (error) => {
      sourceError = error instanceof Error ? error : new Error(String(error))
      child.stdin.destroy()
      child.kill()
    })
    child.on("error", (error) => settle(() => reject(error)))
    child.on("close", (code) => {
      source.destroy()
      if (code === 0) {
        if (sourceError) settle(() => reject(sourceError))
        else settle(() => resolve({ stdout: Buffer.concat(stdout), stderr }))
      } else {
        settle(() =>
          reject(new Error(`${path.basename(command)} exited ${code}: ${stderr}`)),
        )
      }
    })

    source.pipe(child.stdin)
  })
}

function runCommand(command: string, args: string[]) {
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    let stderr = ""

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-64_000)
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(stdout), stderr })
      else reject(new Error(`${path.basename(command)} exited ${code}: ${stderr}`))
    })
  })
}

function parseProbeResult(result: Buffer): MediaSourceMetadata {
  const probe = JSON.parse(result.toString("utf8")) as ProbeResult
  const video = probe.streams?.find((stream) => stream.codec_type === "video")
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio")

  if (!video?.width || !video.height || !video.codec_name) {
    throw new Error("The uploaded file does not contain a readable video stream.")
  }

  const durationSeconds = Number(video.duration ?? probe.format?.duration)
  const rotation =
    video.side_data_list?.find((item) => Number.isFinite(item.rotation))
      ?.rotation ?? Number(video.tags?.rotate ?? 0)

  return {
    width: video.width,
    height: video.height,
    durationMs: Math.round(durationSeconds * 1_000),
    frameRate: frameRate(video.avg_frame_rate ?? video.r_frame_rate),
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    audioChannels: audio?.channels ?? null,
    hasAudio: Boolean(audio),
    rotation: Number.isFinite(rotation) ? rotation : 0,
    colorTransfer: video.color_transfer ?? null,
    colorPrimaries: video.color_primaries ?? null,
    fieldOrder: video.field_order ?? null,
    pixelFormat: video.pix_fmt ?? null,
    sampleAspectRatio: video.sample_aspect_ratio ?? null,
    videoBitrate: Number(video.bit_rate) > 0 ? Number(video.bit_rate) : null,
    videoProfile: video.profile ?? null,
    videoLevel: video.level ?? null,
  } satisfies MediaSourceMetadata
}

function parseAudioProbeResult(result: Buffer): MediaAudioMetadata {
  const probe = JSON.parse(result.toString("utf8")) as ProbeResult
  const video = probe.streams?.find((stream) => stream.codec_type === "video")
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio")

  if (!audio?.codec_name) {
    throw new Error("The encoded package does not contain a readable audio stream.")
  }

  const durationSeconds = Number(audio.duration ?? probe.format?.duration)
  const parsedSampleRate = Number(audio.sample_rate)
  const parsedBitrate = Number(audio.bit_rate)
  return {
    durationMs: Math.round(durationSeconds * 1_000),
    audioCodec: audio.codec_name,
    audioChannels: audio.channels ?? null,
    audioSampleRate:
      Number.isFinite(parsedSampleRate) && parsedSampleRate > 0
        ? parsedSampleRate
        : null,
    audioBitrate:
      Number.isFinite(parsedBitrate) && parsedBitrate > 0 ? parsedBitrate : null,
    hasVideo: Boolean(video),
  }
}

export async function inspectMediaStream(input: ReadableStream<Uint8Array>) {
  const { ffprobe } = mediaBinaryPaths()
  const result = await runWithInput(
    ffprobe,
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "pipe:0",
    ],
    input,
  )
  return parseProbeResult(result.stdout)
}

async function sha256ReadableStream(input: ReadableStream<Uint8Array>) {
  const hash = createHash("sha256")
  const reader = input.getReader()
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      hash.update(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  return hash.digest("hex")
}

export async function inspectAndHashMediaStream(
  input: ReadableStream<Uint8Array>,
) {
  const [probeStream, hashStream] = input.tee()
  const [metadata, checksum] = await Promise.all([
    inspectMediaStream(probeStream),
    sha256ReadableStream(hashStream),
  ])
  return { metadata, checksum }
}

export async function inspectMediaFile(inputPath: string) {
  const { ffprobe } = mediaBinaryPaths()
  const result = await runCommand(ffprobe, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    inputPath,
  ])
  return parseProbeResult(result.stdout)
}

export async function inspectAudioMediaFile(inputPath: string) {
  const { ffprobe } = mediaBinaryPaths()
  const result = await runCommand(ffprobe, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    inputPath,
  ])
  return parseAudioProbeResult(result.stdout)
}

export function renditionFfmpegArguments(input: {
  profile: MediaRenditionProfile
  outputDirectory: string
  sourceMetadata?: Pick<
    MediaSourceMetadata,
    | "rotation"
    | "colorTransfer"
    | "colorPrimaries"
    | "audioChannels"
    | "frameRate"
    | "fieldOrder"
  >
  inputPath?: string
}) {
  const { profile, outputDirectory } = input
  const normalizedRotation =
    ((Math.round(input.sourceMetadata?.rotation ?? 0) % 360) + 360) % 360
  const rotationFilter =
    normalizedRotation === 90
      ? "transpose=clock"
      : normalizedRotation === 270
        ? "transpose=cclock"
        : normalizedRotation === 180
          ? "hflip,vflip"
          : null
  const isHdr = ["smpte2084", "arib-std-b67"].includes(
    input.sourceMetadata?.colorTransfer?.toLowerCase() ?? "",
  )
  const fieldOrder = input.sourceMetadata?.fieldOrder?.toLowerCase() ?? ""
  const isInterlaced = ["tt", "bb", "tb", "bt", "interlaced"].includes(
    fieldOrder,
  )
  const outputFrameRate = maximumRenditionFrameRate(
    profile,
    input.sourceMetadata?.frameRate,
  )
  const gopFrames = Math.max(
    1,
    Math.round(outputFrameRate * mediaPipelineLimits.segmentDurationSeconds),
  )
  const normalizationFilter = [
    rotationFilter,
    isInterlaced ? "yadif=deint=interlaced" : null,
    isHdr
      ? "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv"
      : null,
  ]
    .filter(Boolean)
    .join(",")
  const normalizedInput = normalizationFilter
    ? `[0:v]${normalizationFilter}[normalized]`
    : null
  const videoInputLabel = normalizationFilter ? "[normalized]" : "[0:v]"
  const filter = [
    normalizedInput,
    aspectFitCanvasFilter({
      inputLabel: videoInputLabel,
      outputLabel: "[video-ready]",
      width: profile.width,
      height: profile.height,
      pixelFormat: "yuv420p",
    }),
  ]
    .filter(Boolean)
    .join(";")

  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-noautorotate",
    "-i",
    input.inputPath ?? "pipe:0",
    "-filter_complex",
    filter,
    "-map",
    "[video-ready]",
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-tune",
    "film",
    "-profile:v",
    "high",
    "-level:v",
    outputFrameRate > 30 ? "4.2" : "4.1",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    String(profile.crf),
    "-maxrate",
    String(profile.maxRate),
    "-bufsize",
    String(profile.bufferSize),
    "-fpsmax",
    String(outputFrameRate),
    "-force_key_frames",
    `expr:gte(t,n_forced*${mediaPipelineLimits.segmentDurationSeconds})`,
    "-x264-params",
    `bframes=3:scenecut=0:keyint=${gopFrames}:min-keyint=${gopFrames}:ref=4`,
    "-an",
    "-hls_time",
    String(mediaPipelineLimits.segmentDurationSeconds),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "fmp4",
    "-hls_flags",
    "independent_segments+temp_file",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    path.join(outputDirectory, "segment-%05d.m4s"),
    path.join(outputDirectory, "index.m3u8"),
  ]
}

export function audioRenditionFfmpegArguments(input: {
  outputDirectory: string
  audioChannels?: number | null
  inputPath: string
}) {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input.inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-c:a",
    "aac",
    "-profile:a",
    "aac_low",
    "-aac_coder",
    "twoloop",
    "-b:a",
    String(mediaAudioProfile.bitrate),
    "-ar",
    String(mediaAudioProfile.sampleRate),
    "-ac",
    input.audioChannels === 1 ? "1" : "2",
    ...(isAudioLoudnessNormalizationEnabled() ? ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] : []),
    "-hls_time",
    String(mediaPipelineLimits.segmentDurationSeconds),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "fmp4",
    "-hls_flags",
    "independent_segments+temp_file",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    path.join(input.outputDirectory, "segment-%05d.m4s"),
    path.join(input.outputDirectory, "index.m3u8"),
  ]
}

export async function encodeMediaRendition(input: {
  source: ReadableStream<Uint8Array>
  profile: MediaRenditionProfile
  outputDirectory: string
  sourceMetadata?: MediaSourceMetadata
}) {
  const { ffmpeg } = mediaBinaryPaths()
  const startedAt = Date.now()
  await runWithInput(
    ffmpeg,
    renditionFfmpegArguments(input),
    input.source,
  )
  const fileNames = (await readdir(input.outputDirectory)).sort()
  const files = await Promise.all(
    fileNames.map(async (fileName) => {
      const body = await readFile(path.join(input.outputDirectory, fileName))
      return {
        fileName,
        body,
        checksum: createHash("sha256").update(body).digest("hex"),
      }
    }),
  )

  return { files, encodingMs: Date.now() - startedAt }
}

export async function encodeMediaRenditionFile(input: {
  inputPath: string
  profile: MediaRenditionProfile
  outputDirectory: string
  sourceMetadata?: MediaSourceMetadata
}) {
  const { ffmpeg, ffprobe } = mediaBinaryPaths()
  const startedAt = Date.now()
  let repackaged = false
  if (input.sourceMetadata && canRepackageSourceVideo(input.sourceMetadata, input.profile) &&
      await verifyProgressiveAvcHeaders(ffmpeg, input.inputPath)) {
    try {
      await runCommand(ffmpeg, repackageVideoArguments(input))
      const playlist = await readFile(path.join(input.outputDirectory, "index.m3u8"), "utf8")
      const output = await inspectMediaFile(path.join(input.outputDirectory, "index.m3u8"))
      const segments = playlist.split(/\r?\n/).filter(line => line && !line.startsWith("#"))
      const init = await readFile(path.join(input.outputDirectory, "init.mp4"))
      let independent = true
      const validationPath = path.join(input.outputDirectory, "validate-fragment.mp4")
      try {
        for (const segment of segments) {
          await writeFile(validationPath, Buffer.concat([init, await readFile(path.join(input.outputDirectory, segment))]))
          const packet = await runCommand(ffprobe, ["-v", "error", "-read_intervals", "%+#1", "-select_streams", "v:0",
            "-show_packets", "-show_entries", "packet=data", "-show_data", "-of", "json", validationPath])
          const data = JSON.parse(packet.stdout.toString("utf8")) as { packets?: { data?: string }[] }
          if (!firstAvcPacketIsIdr(data.packets?.[0]?.data ?? "")) { independent = false; break }
        }
      } finally { await rm(validationPath, { force: true }) }
      repackaged = independent && hasBoundedIndependentSegments(playlist) &&
        output.width === input.profile.width && output.height === input.profile.height &&
        output.videoCodec === "h264" && !output.hasAudio &&
        Math.abs(output.durationMs - input.sourceMetadata.durationMs) <= 100 &&
        output.frameRate != null && input.sourceMetadata.frameRate != null &&
        Math.abs(output.frameRate - input.sourceMetadata.frameRate) <= 0.01
    } catch { /* Unsupported bitstream packaging retains the ordinary encode path. */ }
    if (!repackaged) {
      const names = await readdir(input.outputDirectory)
      await Promise.all(names.map(name => rm(path.join(input.outputDirectory, name), { force: true })))
    }
  }
  if (!repackaged) {
    await runCommand(ffmpeg, renditionFfmpegArguments({ ...input, inputPath: input.inputPath }))
  }
  const fileNames = (await readdir(input.outputDirectory)).sort()
  const files = await Promise.all(
    fileNames.map(async (fileName) => {
      const body = await readFile(path.join(input.outputDirectory, fileName))
      return {
        fileName,
        body,
        checksum: createHash("sha256").update(body).digest("hex"),
      }
    }),
  )
  return { files, encodingMs: Date.now() - startedAt, repackaged }
}

export async function encodeMediaAudioRenditionFile(input: {
  inputPath: string
  outputDirectory: string
  audioChannels?: number | null
}) {
  const { ffmpeg } = mediaBinaryPaths()
  const startedAt = Date.now()
  await runCommand(ffmpeg, audioRenditionFfmpegArguments(input))
  const fileNames = (await readdir(input.outputDirectory)).sort()
  const files = await Promise.all(
    fileNames.map(async (fileName) => {
      const body = await readFile(path.join(input.outputDirectory, fileName))
      return {
        fileName,
        body,
        checksum: createHash("sha256").update(body).digest("hex"),
      }
    }),
  )
  return { files, encodingMs: Date.now() - startedAt }
}

export async function generateMediaPoster(input: {
  source: ReadableStream<Uint8Array>
  outputPath: string
}) {
  const { ffmpeg } = mediaBinaryPaths()
  await runWithInput(
    ffmpeg,
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      "pipe:0",
      "-ss",
      "0.1",
      "-frames:v",
      "1",
      "-vf",
      aspectFitCanvasFilter({
        inputLabel: "",
        width: 1080,
        height: 1920,
      }),
      "-c:v",
      "libwebp",
      "-quality",
      "80",
      "-compression_level",
      "4",
      input.outputPath,
    ],
    input.source,
  )

  const body = await readFile(input.outputPath)
  if (body.byteLength === 0) throw new Error("FFmpeg produced an empty poster.")
  return {
    body,
    checksum: createHash("sha256").update(body).digest("hex"),
  }
}

export async function generateMediaPosterFile(input: {
  inputPath: string
  outputPath: string
}) {
  const { ffmpeg } = mediaBinaryPaths()
  await runCommand(ffmpeg, [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input.inputPath,
    "-ss",
    "0.1",
    "-frames:v",
    "1",
    "-vf",
    aspectFitCanvasFilter({
      inputLabel: "",
      width: 1080,
      height: 1920,
    }),
    "-c:v",
    "libwebp",
    "-quality",
    "80",
    "-compression_level",
    "4",
    input.outputPath,
  ])
  const body = await readFile(input.outputPath)
  if (body.byteLength === 0) throw new Error("FFmpeg produced an empty poster.")
  return {
    body,
    checksum: createHash("sha256").update(body).digest("hex"),
  }
}

export function mediaContentType(fileName: string) {
  if (fileName.endsWith(".m3u8")) return "application/vnd.apple.mpegurl"
  if (fileName.endsWith(".m4s")) return "video/iso.segment"
  if (fileName.endsWith(".mp4")) return "video/mp4"
  if (fileName.endsWith(".webp")) return "image/webp"
  return "application/octet-stream"
}
