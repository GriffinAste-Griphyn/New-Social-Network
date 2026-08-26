import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import {
  mediaRenditionProfiles,
  selectRenditionProfiles,
  validateSourceMetadata,
} from "@/lib/media-pipeline/contracts"
import {
  encodeMediaRendition,
  generateMediaPoster,
  inspectMediaFile,
  inspectMediaStream,
  mediaBinaryPaths,
  renditionFfmpegArguments,
} from "@/lib/media-pipeline/ffmpeg"
import { buildHlsMasterPlaylist } from "@/lib/media-pipeline/manifest"

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

function sourceMetadata(height: number) {
  return {
    width: Math.round((height * 9) / 16),
    height,
    durationMs: 10_000,
    frameRate: 30,
    videoCodec: "h264",
    audioCodec: "aac",
    hasAudio: true,
    rotation: 0,
  }
}

describe("custom media pipeline contracts", () => {
  it("never upscales sources while retaining every eligible adaptive level", () => {
    expect(selectRenditionProfiles(sourceMetadata(1280)).map(({ label }) => label))
      .toEqual(["360p", "540p", "720p"])
    expect(selectRenditionProfiles(sourceMetadata(2160)).map(({ label }) => label))
      .toEqual(["360p", "540p", "720p", "1080p"])
  })

  it("accounts for rotation when planning renditions", () => {
    expect(
      selectRenditionProfiles({ width: 1920, height: 1080, rotation: 90 }).at(-1)
        ?.label,
    ).toBe("1080p")
  })

  it("rejects invalid duration and dimensions before encoding", () => {
    expect(validateSourceMetadata({ ...sourceMetadata(1920), durationMs: 120_001 }))
      .toBe("source_duration_exceeded")
    expect(validateSourceMetadata({ ...sourceMetadata(1920), width: 100 }))
      .toBe("source_dimensions_too_small")
  })

  it("builds an adaptive master with exact bandwidth and relative variants", () => {
    const profile = mediaRenditionProfiles[0]
    const master = buildHlsMasterPlaylist([
      {
        profile,
        playlistUrl: "360p/index.m3u8",
        codec: "avc1.640029,mp4a.40.2",
      },
    ])

    expect(master).toContain("#EXT-X-INDEPENDENT-SEGMENTS")
    expect(master).toContain("RESOLUTION=360x640")
    expect(master).toContain("360p/index.m3u8")
    expect(master).toContain("BANDWIDTH=1128000")
  })

  it("does not advertise an audio bitrate for silent sources", () => {
    const profile = mediaRenditionProfiles[0]
    const master = buildHlsMasterPlaylist([
      {
        profile,
        playlistUrl: "360p/index.m3u8",
        codec: "avc1.640029",
      },
    ])

    expect(master).toContain("BANDWIDTH=1000000")
    expect(master).toContain("AVERAGE-BANDWIDTH=850000")
    expect(master).not.toContain("mp4a")
  })

  it("pins two-second CMAF HLS packaging arguments", () => {
    const args = renditionFfmpegArguments({
      profile: mediaRenditionProfiles[0],
      outputDirectory: "/tmp/rendition",
    })
    expect(args).toContain("fmp4")
    expect(args).toContain("independent_segments+temp_file")
    expect(args).toContain("expr:gte(t,n_forced*2)")
    expect(args).toContain("yuv420p")
  })
})

describe("bundled FFmpeg smoke test", () => {
  it("inspects and packages a real vertical source", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ubeye-media-test-"))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, "source.mp4")
    const outputDirectory = path.join(directory, "hls")
    const posterPath = path.join(directory, "poster.jpg")
    const { ffmpeg } = mediaBinaryPaths()

    await execFileAsync(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=360x640:r=30:d=1.2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1.2",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      sourcePath,
    ])
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(outputDirectory, { recursive: true }),
    )
    const sourceBuffer = await readFile(sourcePath)
    const metadata = await inspectMediaStream(
      new Blob([sourceBuffer]).stream() as ReadableStream<Uint8Array>,
    )
    const encoded = await encodeMediaRendition({
      source: new Blob([sourceBuffer]).stream() as ReadableStream<Uint8Array>,
      profile: mediaRenditionProfiles[0],
      outputDirectory,
    })
    const poster = await generateMediaPoster({
      source: new Blob([sourceBuffer]).stream() as ReadableStream<Uint8Array>,
      outputPath: posterPath,
    })

    expect(metadata).toMatchObject({ width: 360, height: 640, hasAudio: true })
    expect(metadata.durationMs).toBeGreaterThan(1_000)
    expect(encoded.files.some(({ fileName }) => fileName === "index.m3u8")).toBe(true)
    expect(encoded.files.some(({ fileName }) => fileName === "init.mp4")).toBe(true)
    expect(encoded.files.some(({ fileName }) => fileName.endsWith(".m4s"))).toBe(true)
    expect(poster.body.byteLength).toBeGreaterThan(0)
    await expect(
      inspectMediaFile(path.join(outputDirectory, "index.m3u8")),
    ).resolves.toMatchObject({
      width: 360,
      height: 640,
      videoCodec: "h264",
      hasAudio: true,
    })
  }, 30_000)
})
