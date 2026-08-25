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
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) return
      yield Buffer.from(result.value)
    }
  } finally {
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
    const stdout: Buffer[] = []
    let stderr = ""

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-64_000)
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: Buffer.concat(stdout), stderr })
      } else {
        reject(new Error(`${path.basename(command)} exited ${code}: ${stderr}`))
      }
    })

    Readable.from(webStreamChunks(input))
      .on("error", (error) => child.stdin.destroy(error))
      .pipe(child.stdin)
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

function parseProbeResult(result: Buffer) {
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
    hasAudio: Boolean(audio),
    rotation: Number.isFinite(rotation) ? rotation : 0,
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
}) {
  const { profile, outputDirectory } = input
  const filter = [
    `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black`,
    "setsar=1",
  ].join(",")

  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    String(profile.videoBitrate),
    "-maxrate",
    String(profile.maxRate),
    "-bufsize",
    String(profile.bufferSize),
    "-fpsmax",
    String(mediaPipelineLimits.maximumFrameRate),
    "-force_key_frames",
    `expr:gte(t,n_forced*${mediaPipelineLimits.segmentDurationSeconds})`,
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    String(profile.audioBitrate),
    "-ac",
    "2",
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
      "scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setsar=1",
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

export function mediaContentType(fileName: string) {
  if (fileName.endsWith(".m3u8")) return "application/vnd.apple.mpegurl"
  if (fileName.endsWith(".m4s")) return "video/iso.segment"
  if (fileName.endsWith(".mp4")) return "video/mp4"
  return "application/octet-stream"
}
