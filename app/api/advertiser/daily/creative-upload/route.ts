import { randomUUID } from "node:crypto"
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getSession } from "@/lib/auth"
import { getAdvertiserWorkspaceForUser } from "@/lib/advertiser-store"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const maxDailyCreativeVideoBytes = 150 * 1024 * 1024
const allowedDailyVideoContentTypes = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
] as const

const uploadSchema = z.object({
  assetKind: z.literal("video"),
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive(),
})

function safeUploadFileName(fileName: string) {
  const cleaned = fileName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)

  return cleaned || "daily-creative"
}

function dailyCreativePathname(input: {
  advertiserAccountId: string
  fileName: string
}) {
  return `advertisers/daily/videos/${input.advertiserAccountId}/${randomUUID()}-${safeUploadFileName(input.fileName)}`
}

export async function POST(request: Request) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await getSession()
  if (!session) {
    return NextResponse.json(
      { error: "Sign in before uploading Daily creative." },
      { status: 401 },
    )
  }

  const workspace = await getAdvertiserWorkspaceForUser(session.id)
  if (!workspace) {
    return NextResponse.json(
      { error: "Create an advertiser account before uploading Daily creative." },
      { status: 403 },
    )
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:advertiser-daily-creative-upload:user",
      subject: session.id,
      options: mutationRateLimits.advertiserWriteUser,
    },
    {
      bucket: "web:advertiser-daily-creative-upload:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.advertiserWriteUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = uploadSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Could not prepare the Daily creative upload." },
      { status: 400 },
    )
  }

  const { byteSize, contentType, fileName } = parsed.data
  const allowedContentTypes: string[] = [...allowedDailyVideoContentTypes]
  const maxSizeBytes = maxDailyCreativeVideoBytes

  if (!allowedContentTypes.includes(contentType) || byteSize > maxSizeBytes) {
    return NextResponse.json(
      { error: "Choose an MP4, MOV, or M4V video up to 150 MB." },
      { status: 400 },
    )
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Daily creative uploads are not configured." },
      { status: 503 },
    )
  }

  const pathname = dailyCreativePathname({
    advertiserAccountId: workspace.account.id,
    fileName,
  })
  const clientToken = await generateClientTokenFromReadWriteToken({
    pathname,
    allowedContentTypes,
    maximumSizeInBytes: maxSizeBytes,
    validUntil: Date.now() + 15 * 60 * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60 * 60 * 24 * 30,
  })

  return NextResponse.json({
    ok: true,
    assetKind: "video",
    pathname,
    clientToken,
    contentType,
    maxSizeBytes,
  })
}
