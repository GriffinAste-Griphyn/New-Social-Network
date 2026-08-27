import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import ffmpegStaticPath from "ffmpeg-static"
import ffprobeInstaller from "@ffprobe-installer/ffprobe"

import {
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
  color_transfer?: string
  color_primaries?: string
  tags?: { rotate?: string }
  side_data_list?: Array<{ rotation?: number }>
}

type ProbeResult = {
  streams?: ProbeStream[]
  format?: { duration?: string }
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
  } satisfies MediaSourceMetadata
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

export function renditionFfmpegArguments(input: {
  profile: MediaRenditionProfile
  outputDirectory: string
  sourceMetadata?: Pick<
    MediaSourceMetadata,
    "rotation" | "colorTransfer" | "colorPrimaries" | "audioChannels"
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
  const normalizationFilter = [
    rotationFilter,
    "yadif=deint=interlaced",
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
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-tune",
    "film",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    String(profile.crf),
    "-maxrate",
    String(profile.maxRate),
    "-bufsize",
    String(profile.bufferSize),
    "-fpsmax",
    String(mediaPipelineLimits.maximumFrameRate),
    "-force_key_frames",
    `expr:gte(t,n_forced*${mediaPipelineLimits.segmentDurationSeconds})`,
    "-x264-params",
    "bframes=3:scenecut=0:keyint=60:min-keyint=60:ref=4",
    "-c:a",
    "aac",
    "-b:a",
    String(profile.audioBitrate),
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ac",
    input.sourceMetadata?.audioChannels === 1 ? "1" : "2",
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
  const { ffmpeg } = mediaBinaryPaths()
  const startedAt = Date.now()
  await runCommand(
    ffmpeg,
    renditionFfmpegArguments({
      ...input,
      inputPath: input.inputPath,
    }),
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
        width: 540,
        height: 960,
      }),
      "-q:v",
      "2",
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
      width: 540,
      height: 960,
    }),
    "-q:v",
    "2",
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
  return "application/octet-stream"
}
