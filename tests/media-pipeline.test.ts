import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import {
  mediaAudioProfile,
  mediaRenditionProfiles,
  selectRenditionProfiles,
  validateSourceMetadata,
} from "@/lib/media-pipeline/contracts"
import {
  audioRenditionFfmpegArguments,
  encodeMediaAudioRenditionFile,
  encodeMediaRendition,
  generateMediaPoster,
  inspectAudioMediaFile,
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

  it("preserves a high-fidelity 1080p top rendition", () => {
    expect(mediaRenditionProfiles.at(-1)).toMatchObject({
      label: "1080p",
      width: 1080,
      height: 1920,
      videoBitrate: 6_000_000,
      maxRate: 8_000_000,
      bufferSize: 16_000_000,
    })
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
        byteSize: 1_000_000,
        durationMs: 10_000,
        frameRate: 29.97,
      },
    ])

    expect(master).toContain("#EXT-X-INDEPENDENT-SEGMENTS")
    expect(master).toContain("RESOLUTION=360x640")
    expect(master).toContain("360p/index.m3u8")
    expect(master).toContain("AVERAGE-BANDWIDTH=800000")
    expect(master).toContain("BANDWIDTH=920000")
    expect(master).toContain("FRAME-RATE=29.970")
  })

  it("uses one high-quality audio group across every adaptive video variant", () => {
    const profile = mediaRenditionProfiles[0]
    const master = buildHlsMasterPlaylist(
      [
        {
          profile,
          playlistUrl: "360p/index.m3u8",
          codec: "avc1.640029",
          byteSize: 750_000,
          durationMs: 10_000,
          frameRate: 30,
        },
      ],
      {
        playlistUrl: "audio/index.m3u8",
        codec: "mp4a.40.2",
        bitrate: mediaAudioProfile.bitrate,
      },
    )

    expect(master).toContain('TYPE=AUDIO,GROUP-ID="audio"')
    expect(master).toContain('URI="audio/index.m3u8"')
    expect(master).toContain('CODECS="avc1.640029,mp4a.40.2"')
    expect(master).toContain('AUDIO="audio"')
    expect(master).toContain("AVERAGE-BANDWIDTH=760000")
  })

  it("does not advertise an audio bitrate for silent sources", () => {
    const profile = mediaRenditionProfiles[0]
    const master = buildHlsMasterPlaylist([
      {
        profile,
        playlistUrl: "360p/index.m3u8",
        codec: "avc1.640029",
        byteSize: 750_000,
        durationMs: 10_000,
        frameRate: 30,
      },
    ])

    expect(master).toContain("BANDWIDTH=690000")
    expect(master).toContain("AVERAGE-BANDWIDTH=600000")
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
    expect(args).toContain("-an")
    expect(args).not.toContain("loudnorm=I=-16:TP=-1.5:LRA=11")
    const filter = args[args.indexOf("-filter_complex") + 1]
    expect(filter).toContain("force_original_aspect_ratio=decrease")
    expect(filter).toContain("pad=360:640:(ow-iw)/2:(oh-ih)/2:color=black")
    expect(filter).not.toContain("force_original_aspect_ratio=increase")
    expect(filter).not.toContain("boxblur")

    const audioArgs = audioRenditionFfmpegArguments({
      inputPath: "/tmp/source.mp4",
      outputDirectory: "/tmp/audio",
      audioChannels: 2,
    })
    expect(audioArgs[audioArgs.indexOf("-b:a") + 1]).toBe("160000")
    expect(audioArgs[audioArgs.indexOf("-ar") + 1]).toBe("48000")
    expect(audioArgs[audioArgs.indexOf("-ac") + 1]).toBe("2")
    expect(audioArgs).not.toContain("-af")
  })
})

describe("bundled FFmpeg smoke test", () => {
  it("inspects and packages a real vertical source", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ubeye-media-test-"))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, "source.mp4")
    const outputDirectory = path.join(directory, "hls")
    const audioOutputDirectory = path.join(directory, "audio")
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
      Promise.all([
        mkdir(outputDirectory, { recursive: true }),
        mkdir(audioOutputDirectory, { recursive: true }),
      ]),
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
    const encodedAudio = await encodeMediaAudioRenditionFile({
      inputPath: sourcePath,
      outputDirectory: audioOutputDirectory,
      audioChannels: metadata.audioChannels,
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
    expect(encodedAudio.files.some(({ fileName }) => fileName === "index.m3u8"))
      .toBe(true)
    expect(poster.body.byteLength).toBeGreaterThan(0)
    await expect(
      inspectMediaFile(path.join(outputDirectory, "index.m3u8")),
    ).resolves.toMatchObject({
      width: 360,
      height: 640,
      videoCodec: "h264",
      hasAudio: false,
    })
    await expect(
      inspectAudioMediaFile(path.join(audioOutputDirectory, "index.m3u8")),
    ).resolves.toMatchObject({
      audioCodec: "aac",
      audioChannels: 1,
      audioSampleRate: 48_000,
      hasVideo: false,
    })

    const masterPath = path.join(directory, "master.m3u8")
    await writeFile(
      masterPath,
      buildHlsMasterPlaylist(
        [
          {
            profile: mediaRenditionProfiles[0],
            playlistUrl: "hls/index.m3u8",
            codec: "avc1.640029",
            byteSize: encoded.files.reduce(
              (total, file) => total + file.body.byteLength,
              0,
            ),
            durationMs: metadata.durationMs,
            frameRate: metadata.frameRate,
          },
        ],
        {
          playlistUrl: "audio/index.m3u8",
          codec: "mp4a.40.2",
          bitrate: mediaAudioProfile.bitrate,
        },
      ),
    )
    await expect(inspectMediaFile(masterPath)).resolves.toMatchObject({
      width: 360,
      height: 640,
      videoCodec: "h264",
      audioCodec: "aac",
      hasAudio: true,
    })
  }, 30_000)
})
