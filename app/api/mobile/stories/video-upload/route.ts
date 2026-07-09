import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  createMediaUploadSession,
  getReusableMediaUploadSession,
  MediaUploadSessionError,
  retireMediaUploadSession,
} from "@/lib/media-upload-sessions"
import {
  createCloudflareStreamDirectUpload,
  createCloudflareStreamClientThumbnailPathname,
  createCloudflareStreamTusUpload,
  maxCloudflareStreamClientThumbnailUploadBytes,
  maxStoryVideoUploadBytes,
  removeCloudflareStreamVideoByUid,
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
  clientUploadId: z.string().uuid().optional(),
  replaceUploadSessionId: z.string().trim().min(1).max(100).optional(),
  fileName: z.string().trim().min(1).max(180).default("story-video.mp4"),
  contentType: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => value.toLowerCase().startsWith("video/"))
    .optional(),
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
    if (parsed.data.replaceUploadSessionId && !parsed.data.clientUploadId) {
      throw new MediaUploadSessionError(
        "A client upload id is required to replace an upload session.",
        400,
      )
    }

    let reusableSession = await getReusableMediaUploadSession({
      ownerUserId: session.id,
      clientUploadId: parsed.data.clientUploadId,
      storageProvider: "cloudflare-stream",
      expectedContentType: parsed.data.contentType,
      expectedByteSize: parsed.data.byteSize,
      maxDurationSeconds: parsed.data.maxDurationSeconds,
    })

    if (
      parsed.data.replaceUploadSessionId &&
      parsed.data.clientUploadId &&
      (!reusableSession ||
        reusableSession.id === parsed.data.replaceUploadSessionId)
    ) {
      const retired = await retireMediaUploadSession({
        ownerUserId: session.id,
        clientUploadId: parsed.data.clientUploadId,
        uploadSessionId: parsed.data.replaceUploadSessionId,
      })

      if (retired) {
        await removeCloudflareStreamVideoByUid(retired.storageKey).catch(
          () => undefined,
        )
      }
      reusableSession = null
    }

    if (reusableSession) {
      const thumbnailUploadFields = await createThumbnailUploadFields({
        userId: session.id,
        uid: reusableSession.storageKey,
      }).catch(() => ({}))

      logVideoUploadEvent("prepare_reused", {
        userId: session.id,
        uid: reusableSession.storageKey,
        uploadSessionId: reusableSession.id,
        protocol: reusableSession.uploadProtocol,
      })

      return NextResponse.json({
        ok: true,
        uploadSessionId: reusableSession.id,
        uid: reusableSession.storageKey,
        uploadUrl: reusableSession.uploadUrl,
        uploadProtocol: reusableSession.uploadProtocol,
        ...thumbnailUploadFields,
      })
    }

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

    let uploadSession

    try {
      uploadSession = await createMediaUploadSession({
        ownerUserId: session.id,
        clientUploadId: parsed.data.clientUploadId,
        assetKind: "video",
        storageProvider: "cloudflare-stream",
        storageKey: upload.uid,
        uploadUrl: upload.uploadUrl,
        uploadProtocol: upload.uploadProtocol,
        expectedContentType: parsed.data.contentType,
        expectedByteSize: parsed.data.byteSize,
        maxDurationSeconds: parsed.data.maxDurationSeconds,
      })
    } catch (error) {
      await removeCloudflareStreamVideoByUid(upload.uid).catch(() => undefined)
      throw error
    }

    if (uploadSession.storageKey !== upload.uid) {
      await removeCloudflareStreamVideoByUid(upload.uid).catch(() => undefined)
    }

    const thumbnailUploadFields = await createThumbnailUploadFields({
      userId: session.id,
      uid: uploadSession.storageKey,
    }).catch((error) => {
      console.error("Could not prepare Cloudflare story thumbnail upload.", {
        uid: upload.uid,
        error,
      })
      return {}
    })

    logVideoUploadEvent("prepare_succeeded", {
      userId: session.id,
      uid: uploadSession.storageKey,
      uploadSessionId: uploadSession.id,
      protocol: uploadSession.uploadProtocol,
      thumbnailUpload: Boolean("thumbnailUploadUrl" in thumbnailUploadFields),
    })

    return NextResponse.json({
      ok: true,
      uploadSessionId: uploadSession.id,
      uid: uploadSession.storageKey,
      uploadUrl: uploadSession.uploadUrl,
      uploadProtocol: uploadSession.uploadProtocol,
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
      { status: error instanceof MediaUploadSessionError ? error.statusCode : 400 },
    )
  }
}
