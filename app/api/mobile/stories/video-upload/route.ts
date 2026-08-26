import { randomUUID } from "node:crypto"

import { del } from "@vercel/blob"
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
import { isVercelHlsPipelineEnabled } from "@/lib/media-pipeline/contracts"
import { originalVideoPathname } from "@/lib/media-pipeline/paths"
import {
  createCloudflareStreamTusUpload,
  directStoryVideoPosterPathname,
  maxStoryVideoPosterUploadBytes,
  maxStoryVideoUploadBytes,
  removeDirectBlobStoryVideoPoster,
  removeCloudflareStreamVideoByUid,
  StoryUploadError,
} from "@/lib/story-storage"
import {
  isSupportedStoryVideoInputContentType,
  storyMediaContract,
} from "@/lib/story-media-contract"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const maxMobileStoryVideoDurationSeconds =
  storyMediaContract.upload.maxVideoDurationSeconds

const videoUploadSchema = z.object({
  clientUploadId: z.string().uuid().optional(),
  replaceUploadSessionId: z.string().trim().min(1).max(100).optional(),
  fileName: z.string().trim().min(1).max(180).default("story-video.mp4"),
  contentType: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(isSupportedStoryVideoInputContentType),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(maxStoryVideoUploadBytes),
  maxDurationSeconds: z
    .number()
    .int()
    .min(1)
    .max(maxMobileStoryVideoDurationSeconds)
    .default(maxMobileStoryVideoDurationSeconds),
})

function logVideoUploadEvent(
  event: string,
  metadata: Record<string, string | number | boolean | null | undefined>,
) {
  console.info(
    JSON.stringify({
      level: event.endsWith("failed") ? "error" : "info",
      message: event,
      service: "mobile_video_upload",
      event,
      at: new Date().toISOString(),
      ...Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined),
      ),
    }),
  )
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

function assertVideoPosterUploadsConfigured() {
  if (
    process.env.STORY_STORAGE_PROVIDER !== "vercel-blob" ||
    !process.env.BLOB_READ_WRITE_TOKEN
  ) {
    throw new MediaUploadSessionError(
      "Video poster uploads are not configured.",
      503,
    )
  }
}

async function createVideoPosterUploadPart(uid: string) {
  assertVideoPosterUploadsConfigured()

  const pathname = directStoryVideoPosterPathname(uid)
  let clientToken: string

  try {
    clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      allowedContentTypes: ["image/jpeg"],
      maximumSizeInBytes: maxStoryVideoPosterUploadBytes,
      validUntil: Date.now() + 60 * 60 * 1000,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  } catch {
    throw new MediaUploadSessionError(
      "Could not prepare the video poster upload.",
      503,
    )
  }

  return {
    pathname,
    uploadUrl: blobApiUploadUrl(pathname),
    clientToken,
    contentType: "image/jpeg",
    maxSizeBytes: maxStoryVideoPosterUploadBytes,
    access: "private" as const,
  }
}

async function createVideoOriginalUploadPart(input: {
  pathname: string
  contentType: string
  byteSize: number
}) {
  assertVideoPosterUploadsConfigured()

  let clientToken: string
  try {
    clientToken = await generateClientTokenFromReadWriteToken({
      pathname: input.pathname,
      allowedContentTypes: [input.contentType],
      maximumSizeInBytes: input.byteSize,
      validUntil: Date.now() + 60 * 60 * 1000,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  } catch {
    throw new MediaUploadSessionError(
      "Could not prepare the private video upload.",
      503,
    )
  }

  return {
    pathname: input.pathname,
    uploadUrl: blobApiUploadUrl(input.pathname),
    clientToken,
    contentType: input.contentType,
    maxSizeBytes: input.byteSize,
    access: "private" as const,
  }
}

async function removeAbandonedVideoUpload(uid: string) {
  const removals: Promise<unknown>[] = [removeDirectBlobStoryVideoPoster(uid)]
  if (uid.startsWith("media-originals/")) {
    removals.push(del(uid))
  } else {
    removals.push(removeCloudflareStreamVideoByUid(uid))
  }
  await Promise.allSettled(removals)
}

export async function POST(request: Request) {
  const uploadStartedAt = new Date()
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
    assertVideoPosterUploadsConfigured()
    const useVercelHls = isVercelHlsPipelineEnabled()
    const storageProvider = useVercelHls
      ? ("vercel-blob" as const)
      : ("cloudflare-stream" as const)
    let uploadOrderReservedAt = uploadStartedAt

    if (parsed.data.replaceUploadSessionId && !parsed.data.clientUploadId) {
      throw new MediaUploadSessionError(
        "A client upload id is required to replace an upload session.",
        400,
      )
    }

    let reusableSession = await getReusableMediaUploadSession({
      ownerUserId: session.id,
      clientUploadId: parsed.data.clientUploadId,
      storageProvider,
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
        uploadOrderReservedAt = retired.createdAt
        await removeAbandonedVideoUpload(retired.storageKey)
      }
      reusableSession = null
    }

    if (reusableSession) {
      const poster = await createVideoPosterUploadPart(
        reusableSession.storageKey,
      )
      const source = useVercelHls
        ? await createVideoOriginalUploadPart({
            pathname: reusableSession.storageKey,
            contentType: parsed.data.contentType,
            byteSize: parsed.data.byteSize,
          })
        : null
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
        poster,
        source,
      })
    }

    if (useVercelHls) {
      const extension = parsed.data.contentType === "video/quicktime" ? "mov" : "mp4"
      const pathname = originalVideoPathname({
        ownerUserId: session.id,
        uploadSessionId: randomUUID(),
        extension,
      })
      const source = await createVideoOriginalUploadPart({
        pathname,
        contentType: parsed.data.contentType,
        byteSize: parsed.data.byteSize,
      })
      const uploadSession = await createMediaUploadSession({
        ownerUserId: session.id,
        clientUploadId: parsed.data.clientUploadId,
        assetKind: "video",
        storageProvider: "vercel-blob",
        storageKey: pathname,
        uploadUrl: source.uploadUrl,
        uploadProtocol: "vercel-blob",
        expectedContentType: parsed.data.contentType,
        expectedByteSize: parsed.data.byteSize,
        maxDurationSeconds: parsed.data.maxDurationSeconds,
        createdAt: uploadOrderReservedAt,
      })
      const resolvedSource =
        uploadSession.storageKey === pathname
          ? source
          : await createVideoOriginalUploadPart({
              pathname: uploadSession.storageKey,
              contentType: parsed.data.contentType,
              byteSize: parsed.data.byteSize,
            })
      if (uploadSession.storageKey !== pathname) {
        await del(pathname).catch(() => undefined)
      }
      const poster = await createVideoPosterUploadPart(uploadSession.storageKey)

      logVideoUploadEvent("prepare_succeeded", {
        userId: session.id,
        uid: uploadSession.storageKey,
        uploadSessionId: uploadSession.id,
        protocol: uploadSession.uploadProtocol,
      })
      return NextResponse.json({
        ok: true,
        uploadSessionId: uploadSession.id,
        uid: uploadSession.storageKey,
        uploadUrl: resolvedSource.uploadUrl,
        uploadProtocol: uploadSession.uploadProtocol,
        poster,
        source: resolvedSource,
      })
    }

    logVideoUploadEvent("prepare_started", {
      userId: session.id,
      fileName: parsed.data.fileName,
      byteSize: parsed.data.byteSize ?? null,
      maxDurationSeconds: parsed.data.maxDurationSeconds,
      protocol: "tus",
    })
    const upload = await createCloudflareStreamTusUpload({
      fileName: parsed.data.fileName,
      uploadLengthBytes: parsed.data.byteSize,
      maxDurationSeconds: parsed.data.maxDurationSeconds,
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
        createdAt: uploadOrderReservedAt,
      })
    } catch (error) {
      await removeCloudflareStreamVideoByUid(upload.uid).catch(() => undefined)
      throw error
    }

    if (uploadSession.storageKey !== upload.uid) {
      await removeAbandonedVideoUpload(upload.uid)
    }

    const poster = await createVideoPosterUploadPart(uploadSession.storageKey)

    logVideoUploadEvent("prepare_succeeded", {
      userId: session.id,
      uid: uploadSession.storageKey,
      uploadSessionId: uploadSession.id,
      protocol: uploadSession.uploadProtocol,
    })

    return NextResponse.json({
      ok: true,
      uploadSessionId: uploadSession.id,
      uid: uploadSession.storageKey,
      uploadUrl: uploadSession.uploadUrl,
      uploadProtocol: uploadSession.uploadProtocol,
      poster,
      source: null,
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
