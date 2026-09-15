// Explicit offline experiments: no public posts, production flags or manifests change.
// node --import tsx scripts/media-encoding-experiments.mjs --input /fixtures --output /report
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import * as encoderModule from '../lib/media-pipeline/ffmpeg.ts'
import * as experimentModule from '../lib/media-pipeline/encoding-experiments.ts'
import * as contractModule from '../lib/media-pipeline/contracts.ts'
const encoder = encoderModule.default ?? encoderModule, experiment = experimentModule.default ?? experimentModule, contracts = contractModule.default ?? contractModule
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const input = option('--input', null), output = path.resolve(option('--output', '/tmp/ubeye-encoding-experiments'))
if (!input) throw Error('Supply a consented or synthetic fixture directory with --input')
const binary = process.env.MEDIA_ANALYSIS_FFMPEG_PATH || encoder.mediaBinaryPaths().ffmpeg
const run = args => new Promise((resolve, reject) => {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
  child.stdout.on('data', chunk => { text = (text + chunk).slice(-2_000_000) })
  child.stderr.on('data', chunk => { text = (text + chunk).slice(-2_000_000) })
  child.on('error', error => { clearTimeout(timer); reject(error) })
  child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(text) : reject(Error(`Experiment failed (${code}): ${text.slice(-500)}`)) })
})
await mkdir(output, { recursive: true })
const encoders = await run(['-encoders']), filters = await run(['-filters']), vmaf = /\blibvmaf\b/.test(filters)
const manifest = await readFile(path.join(input, 'manifest.json'), 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return null
  throw error
})
const names = manifest ? manifest.fixtures.map(fixture => fixture.file) : await readdir(input)
const clips = names.filter(name => typeof name === 'string' && path.basename(name) === name && /\.(mp4|mov)$/i.test(name) && !name.startsWith('encoded-')).sort()
if (!clips.length) throw Error('No fixtures found')
const reports = []
for (const name of clips) {
  const sourcePath = path.resolve(input, name), source = await encoder.inspectMediaFile(sourcePath)
  if (source.durationMs > 120_000) throw Error('Fixture exceeds 120 seconds')
  if (['smpte2084', 'arib-std-b67'].includes(source.colorTransfer) || source.rotation !== 0) {
    reports.push({ clip: name, selected: null, reason: 'HDR/rotation requires a separately approved normalized reference; retain existing delivery' }); continue
  }
  const base = contracts.selectRenditionProfiles(source).find(p => p.label === '540p') ?? contracts.selectRenditionProfiles(source)[0]
  const candidates = []
  for (const config of experiment.deliveryExperimentProfiles) {
    if (config.codec === 'hevc' && !/\blibx265\b/.test(encoders)) continue
    const dir = path.join(output, name, config.name); await mkdir(dir, { recursive: true })
    const profile = experiment.experimentProfile(base, config.crf), started = performance.now()
    await run(experiment.experimentalRenditionArguments({ profile, inputPath: sourcePath, outputDirectory: dir, sourceMetadata: source }, config.codec))
    const encodingMs = Math.round(performance.now() - started), playlist = path.join(dir, 'index.m3u8')
    const actual = await encoder.inspectMediaFile(playlist)
    const fps = contracts.maximumRenditionFrameRate(profile, source.frameRate)
    const reference = `fps=${fps},scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,setpts=PTS-STARTPTS`
    const graph = `[0:v]setpts=PTS-STARTPTS[dist];[1:v]${reference}[ref];[dist][ref]`
    const score = await run(['-i', playlist, '-i', sourcePath, '-lavfi', graph + 'ssim', '-an', '-f', 'null', '-'])
    const ssim = Number(score.match(/All:([0-9.]+)/)?.[1])
    const vmafScore = vmaf ? Number((await run(['-i', playlist, '-i', sourcePath, '-lavfi', graph + 'libvmaf', '-an', '-f', 'null', '-'])).match(/VMAF score:\s*([0-9.]+)/)?.[1]) : null
    const bytes = (await Promise.all((await readdir(dir)).map(async file => (await stat(path.join(dir, file))).size))).reduce((a, b) => a + b, 0)
    candidates.push({ name: config.name, codec: config.codec, bytes, encodingMs, ssim, vmaf: vmafScore,
      valid: Number.isFinite(ssim) && Math.abs(actual.durationMs - source.durationMs) < 150 && actual.width === profile.width && actual.height === profile.height })
  }
  const selected = experiment.selectVerifiedDeliveryCandidate(candidates[0], candidates.slice(1))
  reports.push({ clip: name, source, candidates, selected: selected.name })
  console.log(`Measured ${name}: ${selected.name}`)
}
await writeFile(path.join(output, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), vmaf,
  productionChanged: false, limitations: 'Offline matched-reference experiments. Device playback, energy, startup and real camera acceptance are required before rollout. Audio uses the unchanged separate rendition pipeline.', reports }, null, 2))
