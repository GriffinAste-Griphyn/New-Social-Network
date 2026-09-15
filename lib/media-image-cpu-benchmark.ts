import { availableParallelism } from "node:os"
import { performance } from "node:perf_hooks"
import sharp from "sharp"

import { encodeStoryImageDelivery } from "@/lib/story-image-processing"

export async function createMediaImageBenchmarkFixture() {
  // Reproducible 12 MP detail fixture; no uploaded media, storage writes, or DB work.
  const width = 3024, height = 4032
  const pixels = Buffer.alloc(width * height * 3)
  let seed = 422
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    pixels[i] = seed >>> 24
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
}

export async function benchmarkMediaImageCpu() {
  const source = await createMediaImageBenchmarkFixture()
  const rounds = []
  // Warm native libraries first, then measure identical serial jobs.
  for (let i = 0; i < 4; i++) {
    const started = performance.now()
    const output = await encodeStoryImageDelivery(source)
    if (i > 0) rounds.push({ ms: Math.round(performance.now() - started), displayBytes: output.display.body.length, thumbnailBytes: output.thumbnail.body.length, format: output.displayContentType })
  }
  return { fixture: "deterministic-12mp-detail", region: process.env.VERCEL_REGION ?? "local", cpu: availableParallelism(), sharpConcurrency: sharp.concurrency(), rounds }
}
