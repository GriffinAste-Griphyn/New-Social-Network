import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  createCloudflareStreamDirectUpload,
  createCloudflareStreamTusUpload,
  StoryUploadError,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const videoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180).default("story-video.mp4"),
  byteSize: z.number().int().positive().optional(),
  maxDurationSeconds: z.number().int().min(1).max(24 * 60 * 60).default(60 * 60),
  maxSizeBytes: z
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024 * 1024)
    .optional(),
})

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

    return NextResponse.json({
      ok: true,
      uid: upload.uid,
      uploadUrl: upload.uploadUrl,
      uploadProtocol: upload.uploadProtocol,
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
