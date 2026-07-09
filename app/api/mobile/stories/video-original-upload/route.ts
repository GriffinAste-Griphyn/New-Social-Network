import { randomUUID } from "node:crypto"
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  allowsLegacyOriginalVideoStory,
  legacyOriginalVideoRetiredResponse,
} from "@/lib/mobile-media-pipeline"
import {
  isAllowedOriginalQualityVideoContentType,
  maxOriginalStoryVideoThumbnailUploadBytes,
  maxOriginalStoryVideoUploadBytes,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const maxMobileStoryVideoDurationSeconds = 120
const allowedOriginalQualityVideoContentTypes = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
]

const originalVideoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180).default("story-video.mov"),
  byteSize: z.number().int().positive().max(maxOriginalStoryVideoUploadBytes),
  contentType: z.string().trim().min(1).max(120),
  maxDurationSeconds: z
    .number()
    .int()
    .min(1)
    .max(maxMobileStoryVideoDurationSeconds)
    .default(maxMobileStoryVideoDurationSeconds),
})

function safeUploadFileName(fileName: string) {
  const cleaned = fileName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)

  return cleaned || "story-video.mov"
}

function thumbnailPathname(pathname: string) {
  const extensionIndex = pathname.lastIndexOf(".")

  return extensionIndex >= 0
    ? `${pathname.slice(0, extensionIndex)}-thumb.jpg`
    : `${pathname}-thumb.jpg`
}

function blobApiUploadUrl(pathname: string) {
  const baseUrl =
    process.env.VERCEL_BLOB_API_URL ||
    process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL ||
    "https://blob.vercel-storage.com"
  const url = new URL(baseUrl)

  url.searchParams.set("pathname", pathname)

  return url.toString()
}

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json(
      { error: "Sign in before uploading stories." },
      { status: 401 },
    )
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:story-video-original-upload:user",
      subject: session.id,
      options: mutationRateLimits.storyUploadUser,
    },
    {
      bucket: "mobile:story-video-original-upload:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.storyUploadIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  if (
    !allowsLegacyOriginalVideoStory({ request, phase: "prepare" })
  ) {
    return NextResponse.json(legacyOriginalVideoRetiredResponse, {
      status: 410,
    })
  }

  const parsed = originalVideoUploadSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (
    !parsed.success ||
    !isAllowedOriginalQualityVideoContentType(parsed.data.contentType)
  ) {
    return NextResponse.json(
      { error: "Could not prepare the original video upload." },
      { status: 400 },
    )
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Original video uploads are not configured." },
      { status: 503 },
    )
  }

  const pathname = `stories/mobile-original/${session.id}/${randomUUID()}-${safeUploadFileName(parsed.data.fileName)}`
  const thumbPathname = thumbnailPathname(pathname)
  const validUntil = Date.now() + 15 * 60 * 1000
  const [clientToken, thumbnailClientToken] = await Promise.all([
    generateClientTokenFromReadWriteToken({
      pathname,
      allowedContentTypes: allowedOriginalQualityVideoContentTypes,
      maximumSizeInBytes: maxOriginalStoryVideoUploadBytes,
      validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
    }),
    generateClientTokenFromReadWriteToken({
      pathname: thumbPathname,
      allowedContentTypes: ["image/jpeg"],
      maximumSizeInBytes: maxOriginalStoryVideoThumbnailUploadBytes,
      validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
    }),
  ])

  return NextResponse.json({
    ok: true,
    pathname,
    uploadUrl: blobApiUploadUrl(pathname),
    clientToken,
    contentType: parsed.data.contentType,
    maxSizeBytes: maxOriginalStoryVideoUploadBytes,
    thumbnailPathname: thumbPathname,
    thumbnailUploadUrl: blobApiUploadUrl(thumbPathname),
    thumbnailClientToken,
    thumbnailContentType: "image/jpeg",
    maxThumbnailSizeBytes: maxOriginalStoryVideoThumbnailUploadBytes,
  })
}
