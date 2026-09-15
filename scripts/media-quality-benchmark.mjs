// Uses the actual encoder functions, rather than a second copy of its settings.
// npm run media:benchmark -- --input /path/to/clips --output /path/to/results
import { spawn } from "node:child_process"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import * as encoderModule from "../lib/media-pipeline/ffmpeg.ts"
import * as contractsModule from "../lib/media-pipeline/contracts.ts"

const encoder = encoderModule.default ?? encoderModule
const contracts = contractsModule.default ?? contractsModule

const args = process.argv.slice(2)
function option(name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
const output = path.resolve(option("--output", "/tmp/ubeye-media-benchmark"))
await mkdir(output, { recursive: true })
const run = (binary, arguments_) => new Promise((resolve, reject) => {
  const child = spawn(binary, arguments_, { stdio: ["ignore", "pipe", "pipe"] })
  let stdout = "", stderr = ""
  child.stdout.on("data", chunk => { stdout += chunk })
  child.stderr.on("data", chunk => { stderr += chunk })
  child.once("error", reject)
  child.once("close", code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${path.basename(binary)} exited ${code}: ${stderr.slice(-2000)}`)))
})
try {
  const { ffmpeg } = encoder.mediaBinaryPaths()
  // Quality analysis can use a VMAF-enabled binary without changing the encoder.
  const analyzer = process.env.MEDIA_ANALYSIS_FFMPEG_PATH || ffmpeg
  const filters = await run(analyzer, ["-hide_banner", "-filters"])
  const hasVmaf = /\blibvmaf\b/.test(filters.stdout + filters.stderr)
  const inputDirectory = option("--input", null)
  let clips
  if (inputDirectory) {
    clips = (await readdir(inputDirectory)).filter(name => /\.(mp4|mov|mkv)$/i.test(name)).sort().map(name => path.resolve(inputDirectory, name))
    if (!clips.length) throw new Error("No video clips found in the input directory.")
  } else {
    const fixture = path.join(output, "synthetic-motion.mp4")
    await run(ffmpeg, ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000", "-t", "4", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", fixture])
    clips = [fixture]
  }
  const reports = []
  for (const [index, clip] of clips.entries()) {
    const metadata = await encoder.inspectMediaFile(clip)
    if (contracts.validateSourceMetadata(metadata)) throw new Error(`Invalid benchmark source: ${path.basename(clip)}`)
    // HDR and rotated sources need a matching normalized reference for objective scores.
    const objectiveSupported = metadata.rotation === 0 && !["smpte2084", "arib-std-b67"].includes(metadata.colorTransfer)
    const directory = path.join(output, `${index}-${path.basename(clip, path.extname(clip))}`)
    await mkdir(directory, { recursive: true })
    const report = { clip: path.basename(clip), source: metadata, encoderVersion: contracts.mediaEncoderVersion, synthetic: !inputDirectory, renditions: [] }
    for (const profile of contracts.selectRenditionProfiles(metadata)) {
      const renditionDirectory = path.join(directory, profile.label)
      await mkdir(renditionDirectory, { recursive: true })
      const encoded = await encoder.encodeMediaRenditionFile({ inputPath: clip, profile, outputDirectory: renditionDirectory, sourceMetadata: metadata })
      const playlist = path.join(renditionDirectory, "index.m3u8")
      const fps = contracts.maximumRenditionFrameRate(profile, metadata.frameRate)
      const reference = `fps=${fps},scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,setpts=PTS-STARTPTS`
      const scores = {}
      if (objectiveSupported) {
        const ssim = await run(analyzer, ["-hide_banner", "-nostdin", "-i", playlist, "-i", clip, "-lavfi", `[0:v]setpts=PTS-STARTPTS[dist];[1:v]${reference}[ref];[dist][ref]ssim`, "-an", "-f", "null", "-"])
        scores.ssim = Number(ssim.stderr.match(/All:([0-9.]+)/)?.[1])
        if (!Number.isFinite(scores.ssim)) throw new Error("SSIM output was not readable.")
        if (hasVmaf) {
          const vmaf = await run(analyzer, ["-hide_banner", "-nostdin", "-i", playlist, "-i", clip, "-lavfi", `[0:v]setpts=PTS-STARTPTS[dist];[1:v]${reference}[ref];[dist][ref]libvmaf`, "-an", "-f", "null", "-"])
          scores.vmaf = Number(vmaf.stderr.match(/VMAF score:\s*([0-9.]+)/)?.[1])
          if (!Number.isFinite(scores.vmaf)) throw new Error("VMAF output was not readable.")
        }
      }
      report.renditions.push({ profile: profile.label, encodingMs: encoded.encodingMs, bytes: encoded.files.reduce((sum, file) => sum + file.body.length, 0), ...scores, objectiveSkipped: objectiveSupported ? null : "Provide a normalized SDR, unrotated reference before scoring." })
    }
    if (metadata.hasAudio) {
      const audioDirectory = path.join(directory, "audio")
      await mkdir(audioDirectory, { recursive: true })
      await encoder.encodeMediaAudioRenditionFile({ inputPath: clip, outputDirectory: audioDirectory, audioChannels: metadata.audioChannels })
      const measurement = await run(analyzer, ["-hide_banner", "-nostdin", "-i", path.join(audioDirectory, "index.m3u8"), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"])
      const match = measurement.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)
      if (!match) throw new Error("Loudness analysis output was not readable.")
      const measured = JSON.parse(match[0])
      report.audio = { integratedLufs: measured.input_i, truePeakDb: measured.input_tp, loudnessRangeLu: measured.input_lra, normalized: process.env.MEDIA_AUDIO_LOUDNESS_NORMALIZATION_ENABLED === "true" }
    }
    reports.push(report)
    console.log(`Benchmarked ${report.clip}: ${report.renditions.length} renditions`)
  }
  const result = { generatedAt: new Date().toISOString(), vmafAvailable: hasVmaf, reports }
  await writeFile(path.join(output, "report.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(`Report: ${path.join(output, "report.json")}`)
} catch (error) { console.error(error); process.exitCode = 1 }
