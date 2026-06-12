import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  createCloudflareStreamDirectUpload,
  createCloudflareStreamClientThumbnailPathname,
  createCloudflareStreamTusUpload,
  maxCloudflareStreamClientThumbnailUploadBytes,
  maxStoryVideoUploadBytes,
  StoryUploadError,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const maxMobileStoryVideoDurationSeconds = 120

const videoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180).default("story-video.mp4"),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(maxStoryVideoUploadBytes)
    .optional(),
  maxDurationSeconds: z
    .number()
    .int()
    .min(1)
    .max(maxMobileStoryVideoDurationSeconds)
    .default(maxMobileStoryVideoDurationSeconds),
  maxSizeBytes: z
    .number()
    .int()
    .min(1024)
    .max(maxStoryVideoUploadBytes)
    .optional(),
})

function logVideoUploadEvent(
  event: string,
  metadata: Record<string, string | number | boolean | null | undefined>,
) {
  console.info(
    "mobile_video_upload",
    JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined),
      ),
    }),
  )
}

async function createThumbnailUploadFields(input: {
  userId: string
  uid: string
}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {}
  }

  const thumbnailPathname = createCloudflareStreamClientThumbnailPathname(
    input.userId,
    input.uid,
  )
  const thumbnailClientToken = await generateClientTokenFromReadWriteToken({
    pathname: thumbnailPathname,
    allowedContentTypes: ["image/jpeg"],
    maximumSizeInBytes: maxCloudflareStreamClientThumbnailUploadBytes,
    validUntil: Date.now() + 15 * 60 * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60 * 60 * 24 * 30,
  })
  const blobApiUrl =
    process.env.VERCEL_BLOB_API_URL ??
    process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL ??
    "https://vercel.com/api/blob"

  return {
    thumbnailPathname,
    thumbnailUploadUrl: `${blobApiUrl}/?pathname=${encodeURIComponent(
      thumbnailPathname,
    )}`,
    thumbnailClientToken,
    thumbnailContentType: "image/jpeg",
    maxThumbnailSizeBytes: maxCloudflareStreamClientThumbnailUploadBytes,
  }
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
      bucket: "mobile:story-video-upload:user",
      subject: session.id,
      options: mutationRateLimits.storyUploadUser,
    },
    {
      bucket: "mobile:story-video-upload:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.storyUploadIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = videoUploadSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    logVideoUploadEvent("prepare_invalid_payload", {
      userId: session.id,
      ip: requestIpSubject(request),
    })
    return NextResponse.json(
      { error: "Could not prepare the video upload." },
      { status: 400 },
    )
  }

  try {
    logVideoUploadEvent("prepare_started", {
      userId: session.id,
      fileName: parsed.data.fileName,
      byteSize: parsed.data.byteSize ?? null,
      maxDurationSeconds: parsed.data.maxDurationSeconds,
      protocol: parsed.data.byteSize ? "tus" : "form",
    })
    const upload = parsed.data.byteSize
      ? await createCloudflareStreamTusUpload({
          fileName: parsed.data.fileName,
          uploadLengthBytes: parsed.data.byteSize,
          maxDurationSeconds: parsed.data.maxDurationSeconds,
        })
      : await createCloudflareStreamDirectUpload({
          fileName: parsed.data.fileName,
          maxDurationSeconds: parsed.data.maxDurationSeconds,
          maxSizeBytes: parsed.data.maxSizeBytes,
        })

    const thumbnailUploadFields = await createThumbnailUploadFields({
      userId: session.id,
      uid: upload.uid,
    }).catch((error) => {
      console.error("Could not prepare Cloudflare story thumbnail upload.", {
        uid: upload.uid,
        error,
      })
      return {}
    })

    logVideoUploadEvent("prepare_succeeded", {
      userId: session.id,
      uid: upload.uid,
      protocol: upload.uploadProtocol,
      thumbnailUpload: Boolean("thumbnailUploadUrl" in thumbnailUploadFields),
    })

    return NextResponse.json({
      ok: true,
      uid: upload.uid,
      uploadUrl: upload.uploadUrl,
      uploadProtocol: upload.uploadProtocol,
      ...thumbnailUploadFields,
    })
  } catch (error) {
    logVideoUploadEvent("prepare_failed", {
      userId: session.id,
      fileName: parsed.data.fileName,
      byteSize: parsed.data.byteSize ?? null,
      reason:
        error instanceof StoryUploadError || error instanceof Error
          ? error.message
          : "unknown",
    })
    return NextResponse.json(
      {
        error:
          error instanceof StoryUploadError || error instanceof Error
            ? error.message
            : "Could not prepare the video upload.",
      },
      { status: 400 },
    )
  }
}
