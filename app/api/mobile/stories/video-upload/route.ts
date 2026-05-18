import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  createCloudflareStreamDirectUpload,
  createCloudflareStreamClientThumbnailPathname,
  createCloudflareStreamTusUpload,
  maxCloudflareStreamClientThumbnailUploadBytes,
  StoryUploadError,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const maxMobileStoryVideoUploadBytes = 150 * 1024 * 1024
const maxMobileStoryVideoDurationSeconds = 120

const videoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180).default("story-video.mp4"),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(maxMobileStoryVideoUploadBytes)
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
    .max(maxMobileStoryVideoUploadBytes)
    .optional(),
})

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
    return NextResponse.json(
      { error: "Could not prepare the video upload." },
      { status: 400 },
    )
  }

  try {
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

    return NextResponse.json({
      ok: true,
      uid: upload.uid,
      uploadUrl: upload.uploadUrl,
      uploadProtocol: upload.uploadProtocol,
      ...thumbnailUploadFields,
    })
  } catch (error) {
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
