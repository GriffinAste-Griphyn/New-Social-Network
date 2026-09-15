// Exercise provider encoding and CDN delivery without creating any public story.
// node --import tsx scripts/media-delivery-benchmark.mjs --input /clips --output /results
// Requires the existing Stream account/token. Every created private fixture is deleted.
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as encoderModule from '../lib/media-pipeline/ffmpeg.ts'
import * as qualityModule from '../lib/media-pipeline/delivery-quality.ts'
const quality = qualityModule.default ?? qualityModule
const encoder = encoderModule.default ?? encoderModule
const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
const input = option('--input', null), output = path.resolve(option('--output', '/tmp/ubeye-delivery-benchmark'))
if (!input) throw Error('Supply --input with a consented camera or synthetic fixture directory')
const account = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID, token = process.env.CLOUDFLARE_STREAM_API_TOKEN
if (!account || !token) throw Error('Stream benchmark credentials are required')
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/stream`
const analyzer = process.env.MEDIA_ANALYSIS_FFMPEG_PATH || encoder.mediaBinaryPaths().ffmpeg
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(analyzer, ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  const timeout = setTimeout(() => child.kill('SIGKILL'), 180_000)
  child.stdout.on('data', data => { stdout = (stdout + data).slice(-1_000_000) })
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-1_000_000) })
  child.once('error', error => { clearTimeout(timeout); reject(error) })
  // Keep signed playback URLs and credentials out of logs and reports.
  child.once('close', code => { clearTimeout(timeout); if (code === 0) resolve({ stdout, stderr }); else reject(Error(`Media analysis exited ${code}`)) })
})
async function api(suffix, init = {}) {
  const response = await fetch(base + suffix, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(30_000) })
  if (init.method === 'DELETE') { if (!response.ok) throw Error('Fixture cleanup failed'); return }
  const body = await response.json()
  if (!response.ok || !body.success) throw Error(`Stream request failed (${response.status})`)
  return body.result
}
await mkdir(output, { recursive: true })
const filters = await run(['-filters']), vmafAvailable = /\blibvmaf\b/.test(filters.stdout + filters.stderr)
const reports = []
const clips = (await readdir(input)).filter(name => /\.(mp4|mov|mkv)$/i.test(name)).sort()
if (!clips.length) throw Error('No video fixtures found')
for (const [index, name] of clips.entries()) {
  const original = path.resolve(input, name), bytes = (await stat(original)).size
  if (bytes > 200 * 1024 * 1024) throw Error('Benchmark fixture exceeds the 200 MiB basic-upload limit')
  const source = await encoder.inspectMediaFile(original)
  if (source.durationMs > 120_000) throw Error('Benchmark fixture exceeds two minutes')
  const ticket = await api('/direct_upload', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ maxDurationSeconds: 120, requireSignedURLs: true, meta: { name: `private-media-benchmark-${name}` } }) })
  const started = performance.now()
  const report = { clip: name, provider: 'cloudflare-stream', source, sourceBytes: bytes, renditions: [] }
  try {
    const form = new FormData(); form.set('file', new Blob([await readFile(original)]), name)
    const uploaded = await fetch(ticket.uploadURL, { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) })
    if (!uploaded.ok) throw Error('Fixture transfer failed')
    report.uploadMs = Math.round(performance.now() - started)
    let status
    for (;;) {
      status = await api(`/${ticket.uid}`)
      if (status.status?.state === 'error') throw Error('Provider rejected fixture')
      if (status.readyToStream && Number(status.status?.pctComplete ?? 100) >= 100) break
      if (performance.now() - started > 300_000) throw Error('Provider fixture readiness timed out')
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    report.uploadToReadyMs = Math.round(performance.now() - started)
    const signed = await api(`/${ticket.uid}/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 1800 }) })
    const manifestURL = new URL(status.playback.hls)
    manifestURL.pathname = manifestURL.pathname.replace(ticket.uid, signed.token)
    const response = await fetch(manifestURL, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw Error('Signed manifest unavailable')
    const manifest = await response.text()
    const variants = quality.deliveryVariants(manifest, manifestURL.toString())
    for (const [level, variant] of variants.entries()) {
      const variantPath = path.join(output, `${index}-${level}.m3u8`)
      // Local master contains exactly one video rendition and its audio group.
      await writeFile(variantPath, variant.playlist, { mode: 0o600 })
      const delivered = path.join(output, `${index}-${level}.mp4`), downloadStart = performance.now()
      try {
        await run(['-y', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-i', variantPath, '-c', 'copy', delivered])
      } finally { await (await import('node:fs/promises')).unlink(variantPath).catch(() => {}) }
      const actual = await encoder.inspectMediaFile(delivered)
      if (actual.width !== variant.width || actual.height !== variant.height) throw Error("Delivered dimensions do not match the selected rendition")
      const result = { width: variant.width, height: variant.height, bandwidth: variant.bandwidth, actualWidth: actual.width, actualHeight: actual.height,
        downloadMs: Math.round(performance.now() - downloadStart), bytes: (await stat(delivered)).size,
        durationDeltaMs: actual.durationMs - source.durationMs, audioPresent: actual.hasAudio }
      const comparable = source.rotation === 0 && !['smpte2084', 'arib-std-b67'].includes(source.colorTransfer) &&
        Math.abs(source.width / source.height - actual.width / actual.height) < 0.02 && Math.abs(result.durationDeltaMs) <= 150
      if (comparable) {
        const fps = source.frameRate || 30
        const graph = quality.deliveryComparisonGraph(source.width, source.height, fps)
        const ssim = await run(['-i', delivered, '-i', original, '-lavfi', graph + 'ssim', '-an', '-f', 'null', '-'])
        result.ssim = Number(ssim.stderr.match(/All:([0-9.]+)/)?.[1])
        if (!Number.isFinite(result.ssim)) throw Error('SSIM was not measured')
        if (vmafAvailable) {
          const vmaf = await run(['-i', delivered, '-i', original, '-lavfi', graph + 'libvmaf', '-an', '-f', 'null', '-'])
          result.vmaf = Number(vmaf.stderr.match(/VMAF score:\s*([0-9.]+)/)?.[1])
          if (!Number.isFinite(result.vmaf)) throw Error('VMAF was not measured')
        }
      } else result.objectiveSkipped = 'Needs a matched SDR reference with verified geometry and timing'
      report.renditions.push(result)
    }
    reports.push(report)
    console.log(`Verified provider delivery: ${name} (${report.renditions.length} renditions)`)
  } finally { await api(`/${ticket.uid}`, { method: 'DELETE' }) }
}
await writeFile(path.join(output, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
  synthetic: args.includes('--synthetic'), vmafAvailable, reports,
  comparison: 'Exact advertised variant, full-clip scoring at a common source-sized viewport (up to 1080p); lower renditions are upscaled, not given easier downscaled references.',
  limitations: 'Provider roundtrip; excludes iOS capture/export, physical display, battery and user-perceived first-frame latency.' }, null, 2) + '\n')
