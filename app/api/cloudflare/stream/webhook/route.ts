import { createHmac, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"

import { syncCloudflareStreamStoryStatus } from "@/lib/story-store"

export const runtime = "nodejs"

const webhookTimestampToleranceMs = 5 * 60 * 1000

const cloudflareStreamWebhookSchema = z
  .object({
    uid: z.string().regex(/^[a-f0-9]{32}$/i),
    readyToStream: z.boolean().default(false),
    status: z
      .object({
        state: z.string().nullable().optional(),
        errorReasonCode: z.string().nullable().optional(),
        errorReasonText: z.string().nullable().optional(),
        errReasonCode: z.string().nullable().optional(),
        errReasonText: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    duration: z.number().nullable().optional(),
    size: z.number().nullable().optional(),
    input: z
      .object({
        width: z.number().nullable().optional(),
        height: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough()

function parseWebhookSignature(value: string | null) {
  if (!value) {
    return null
  }

  const parts = Object.fromEntries(
    value.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=")

      return [key, rest.join("=")]
    }),
  )

  if (!parts.time || !parts.sig1) {
    return null
  }

  return {
    timestampSeconds: Number(parts.time),
    signature: parts.sig1,
  }
}

function signaturesMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function verifyCloudflareStreamSignature(input: {
  body: string
  signatureHeader: string | null
}) {
  const secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET

  if (!secret) {
    throw new Error("CLOUDFLARE_STREAM_WEBHOOK_SECRET is not configured.")
  }

  const parsedSignature = parseWebhookSignature(input.signatureHeader)

  if (
    !parsedSignature ||
    !Number.isFinite(parsedSignature.timestampSeconds) ||
    !parsedSignature.signature
  ) {
    return false
  }

  const timestampMs = parsedSignature.timestampSeconds * 1000

  if (Math.abs(Date.now() - timestampMs) > webhookTimestampToleranceMs) {
    return false
  }

  const signatureSource = `${parsedSignature.timestampSeconds}.${input.body}`
  const expectedSignature = createHmac("sha256", secret)
    .update(signatureSource)
    .digest("hex")

  return signaturesMatch(parsedSignature.signature, expectedSignature)
}

export async function POST(request: Request) {
  const body = await request.text()

  try {
    if (
      !verifyCloudflareStreamSignature({
        body,
        signatureHeader: request.headers.get("Webhook-Signature"),
      })
    ) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 })
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not verify webhook signature.",
      },
      { status: 500 },
    )
  }

  let payloadJson: unknown

  try {
    payloadJson = JSON.parse(body || "null") as unknown
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 })
  }

  const parsedPayload = cloudflareStreamWebhookSchema.safeParse(payloadJson)

  if (!parsedPayload.success) {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 })
  }

  const payload = parsedPayload.data
  const errorReason =
    payload.status?.errorReasonText ||
    payload.status?.errReasonText ||
    payload.status?.errorReasonCode ||
    payload.status?.errReasonCode ||
    null
  const result = await syncCloudflareStreamStoryStatus({
    uid: payload.uid,
    details: {
      readyToStream: payload.readyToStream,
      state: payload.status?.state ?? null,
      errorReason,
      byteSize:
        typeof payload.size === "number" && Number.isFinite(payload.size)
          ? Math.round(payload.size)
          : null,
      durationMs:
        typeof payload.duration === "number" &&
        Number.isFinite(payload.duration) &&
        payload.duration > 0
          ? Math.round(payload.duration * 1_000)
          : null,
      width:
        typeof payload.input?.width === "number"
          ? Math.round(payload.input.width)
          : null,
      height:
        typeof payload.input?.height === "number"
          ? Math.round(payload.input.height)
          : null,
    },
  })

  return NextResponse.json({ ok: true, result })
}
