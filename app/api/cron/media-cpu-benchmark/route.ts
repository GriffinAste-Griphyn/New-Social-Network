import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

import { benchmarkMediaImageCpu } from "@/lib/media-image-cpu-benchmark"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: Request) {
  // This diagnostic is disabled in production and requires an explicit preview flag.
  if (process.env.VERCEL_ENV !== "preview" || process.env.MEDIA_CPU_BENCHMARK_ENABLED !== "true") {
    return new NextResponse(null, { status: 404 })
  }
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get("authorization") ?? ""
  const authorization = expected ? `Bearer ${expected}` : ""
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(authorization) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(authorization))) {
    return new NextResponse(null, { status: 401 })
  }
  return NextResponse.json(await benchmarkMediaImageCpu(), { headers: { "Cache-Control": "no-store" } })
}
