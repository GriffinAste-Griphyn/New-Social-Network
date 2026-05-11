import { NextResponse } from "next/server"

import { env } from "@/lib/env"
import { syncCloudflareStreamAssetByUid } from "@/lib/media-assets"

export const runtime = "nodejs"

function isAuthorized(request: Request) {
  const secret = env.CLOUDFLARE_STREAM_WEBHOOK_SECRET

  if (!secret) {
    return process.env.NODE_ENV !== "production"
  }

  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-webhook-secret") === secret
  )
}

function findUid(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>
  const candidates = [
    record.uid,
    record.videoUID,
    record.videoUid,
    record.id,
    (record.result as Record<string, unknown> | undefined)?.uid,
    (record.data as Record<string, unknown> | undefined)?.uid,
  ]

  return (
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && /^[a-f0-9]{32}$/i.test(candidate),
    ) ?? null
  )
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const payload = await request.json().catch(() => null)
  const uid = findUid(payload)

  if (!uid) {
    return NextResponse.json(
      { error: "Cloudflare Stream UID missing from webhook payload." },
      { status: 400 },
    )
  }

  const result = await syncCloudflareStreamAssetByUid(uid)

  return NextResponse.json({ ok: true, uid, result })
}
