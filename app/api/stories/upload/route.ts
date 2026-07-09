import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getSession, isProfileComplete } from "@/lib/auth"
import {
  createMediaUploadSession,
  getReusableMediaUploadSession,
  MediaUploadSessionError,
  retireMediaUploadSession,
} from "@/lib/media-upload-sessions"
import {
  createCloudflareStreamTusUpload,
  directStoryImagePathname,
  isAllowedDirectStoryImageContentType,
  removeCloudflareStreamVideoByUid,
  StoryUploadError,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const maxWebStoryImageUploadBytes = 25 * 1024 * 1024
const maxWebStoryVideoUploadBytes = 150 * 1024 * 1024
const maxWebStoryVideoDurationSeconds = 120

const uploadSchema = z.object({
  assetKind: z.enum(["image", "video"]),
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive(),
  clientUploadId: z.string().uuid().optional(),
  replaceUploadSessionId: z.string().trim().min(1).max(100).optional(),
})

function blobApiUrl() {
  return (
    process.env.VERCEL_BLOB_API_URL ??
    process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL ??
    "https://vercel.com/api/blob"
  )
}

export async function POST(request: Request) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await getSession()

  if (!session) {
    return NextResponse.json({ error: "Sign in before uploading stories." }, { status: 401 })
  }

  if (!isProfileComplete(session)) {
    return NextResponse.json({ error: "Profile setup required." }, { status: 403 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:story-upload-prepare:user",
      subject: session.id,
      options: mutationRateLimits.storyUploadUser,
    },
    {
      bucket: "web:story-upload-prepare:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.storyUploadIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = uploadSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json({ error: "Could not prepare the upload." }, { status: 400 })
  }

  try {
    if (
      process.env.STORY_STORAGE_PROVIDER !== "vercel-blob" &&
      process.env.NODE_ENV !== "production"
    ) {
      return NextResponse.json({
        ok: true,
        assetKind: parsed.data.assetKind,
        uploadProtocol: "legacy",
      })
    }

    if (parsed.data.assetKind === "image") {
      if (
        !isAllowedDirectStoryImageContentType(parsed.data.contentType) ||
        parsed.data.byteSize > maxWebStoryImageUploadBytes
      ) {
        return NextResponse.json(
          { error: "Choose a JPG, PNG, or WEBP image up to 25 MB." },
          { status: 400 },
        )
      }

      const pathname = directStoryImagePathname(session.id, parsed.data.fileName)
      const clientToken = await generateClientTokenFromReadWriteToken({
        pathname,
        allowedContentTypes: [parsed.data.contentType],
        maximumSizeInBytes: maxWebStoryImageUploadBytes,
        validUntil: Date.now() + 15 * 60 * 1000,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60 * 60 * 24 * 30,
      })

      return NextResponse.json({
        ok: true,
        assetKind: "image",
        pathname,
        uploadUrl: `${blobApiUrl()}/?pathname=${encodeURIComponent(pathname)}`,
        clientToken,
        contentType: parsed.data.contentType,
        maxSizeBytes: maxWebStoryImageUploadBytes,
      })
    }

    if (
      !parsed.data.contentType.toLowerCase().startsWith("video/") ||
      parsed.data.byteSize > maxWebStoryVideoUploadBytes
    ) {
      return NextResponse.json(
        { error: "Choose a video up to 150 MB." },
        { status: 400 },
      )
    }

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
      maxDurationSeconds: maxWebStoryVideoDurationSeconds,
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
      return NextResponse.json({
        ok: true,
        assetKind: "video",
        uploadSessionId: reusableSession.id,
        uid: reusableSession.storageKey,
        uploadUrl: reusableSession.uploadUrl,
        uploadProtocol: reusableSession.uploadProtocol,
        maxSizeBytes: maxWebStoryVideoUploadBytes,
        maxDurationSeconds: maxWebStoryVideoDurationSeconds,
      })
    }

    const upload = await createCloudflareStreamTusUpload({
      fileName: parsed.data.fileName,
      uploadLengthBytes: parsed.data.byteSize,
      maxDurationSeconds: maxWebStoryVideoDurationSeconds,
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
        maxDurationSeconds: maxWebStoryVideoDurationSeconds,
      })
    } catch (error) {
      await removeCloudflareStreamVideoByUid(upload.uid).catch(() => undefined)
      throw error
    }

    if (uploadSession.storageKey !== upload.uid) {
      await removeCloudflareStreamVideoByUid(upload.uid).catch(() => undefined)
    }

    return NextResponse.json({
      ok: true,
      assetKind: "video",
      uploadSessionId: uploadSession.id,
      uid: uploadSession.storageKey,
      uploadUrl: uploadSession.uploadUrl,
      uploadProtocol: uploadSession.uploadProtocol,
      maxSizeBytes: maxWebStoryVideoUploadBytes,
      maxDurationSeconds: maxWebStoryVideoDurationSeconds,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof StoryUploadError || error instanceof Error
            ? error.message
            : "Could not prepare the upload.",
      },
      { status: error instanceof MediaUploadSessionError ? error.statusCode : 400 },
    )
  }
}
