// Checks that bounded encoder worker changes preserve the configured image quality.
// Run with: npx tsx scripts/media-image-quality-audit.mjs
import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import * as processingModule from '../lib/story-image-processing.ts'
import * as fixtureModule from '../lib/media-image-cpu-benchmark.ts'
const processing = processingModule.default ?? processingModule
const fixture = fixtureModule.default ?? fixtureModule
const source = await fixture.createMediaImageBenchmarkFixture()
const canvas = await processing.createStoryCanvasImage(source)
const reference = await canvas.clone().toColourspace('srgb').removeAlpha().raw().toBuffer()
const previous = sharp.concurrency()
const results = []
try {
  for (const delivery of ["avif", "fast-webp"]) for (const threads of [1, 2]) {
    sharp.concurrency(threads)
    const started = performance.now()
    const output = await processing.encodeStoryImageDelivery(source, "fit", delivery)
    const encodingMs = Math.round(performance.now() - started)
    const decoded = await sharp(output.display.body).toColourspace('srgb').removeAlpha().raw().toBuffer()
    if (reference.length !== decoded.length) throw new Error('Decoded dimensions or channels changed')
    let error = 0
    for (let i = 0; i < reference.length; i++) error += (reference[i] - decoded[i]) ** 2
    const psnr = 10 * Math.log10(255 ** 2 / (error / reference.length))
    results.push({ delivery, encodingMs, threads, bytes: output.display.body.length, format: output.displayContentType, psnrDb: psnr })
  }
  const regression = results[0].psnrDb - results[1].psnrDb
  if (regression > 0.1) throw new Error(`Two-thread image quality regressed by ${regression.toFixed(3)} dB`)
  const report = { synthetic: true, platform: process.platform, fixture: 'deterministic-12mp-detail', metric: 'PSNR against the same resized, sharpened sRGB canvas', results }
  await writeFile(process.argv[2] || '/tmp/ubeye-image-quality-audit.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally { sharp.concurrency(previous) }
