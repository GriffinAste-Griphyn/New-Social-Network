// Explicit release-only probe. Normal builds perform no provider writes.
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ffmpeg from 'ffmpeg-static'
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit' })
  child.once('error', reject)
  child.once('close', code => code === 0 ? resolve() : reject(Error(`Release verification failed (${code})`)))
})
if (process.env.MEDIA_RELEASE_STORY_UID) {
  await run(process.execPath, ['--import', 'tsx', 'scripts/media-rendition-verify.mjs'])
}
if (process.env.MEDIA_RELEASE_BENCHMARK !== 'true') process.exit(0)
const input = await mkdtemp(path.join(tmpdir(), 'ubeye-delivery-fixture-'))
const output = await mkdtemp(path.join(tmpdir(), 'ubeye-delivery-report-'))
await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i',
  'testsrc2=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '2', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709',
  '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-movflags', '+faststart', path.join(input, 'synthetic-motion.mp4')])
await run(process.execPath, ['--import', 'tsx', 'scripts/media-delivery-benchmark.mjs', '--input', input, '--output', output, '--synthetic'])
console.log('MEDIA_DELIVERY_BENCHMARK_REPORT=' + (await readFile(path.join(output, 'report.json'), 'utf8')).replace(/\n\s*/g, ''))
