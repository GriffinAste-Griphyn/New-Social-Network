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
  directStoryImageDisplayPathname,
  directStoryImagePathname,
  directStoryImageThumbnailPathname,
  isAllowedDirectStoryImageContentType,
  maxStoryImageDisplayDerivativeBytes,
  maxStoryImageThumbnailDerivativeBytes,
  removeCloudflareStreamVideoByUid,
  StoryUploadError,
} from "@/lib/story-storage"
import {
  isSupportedStoryVideoInputContentType,
  storyMediaContract,
} from "@/lib/story-media-contract"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const maxWebStoryVideoUploadBytes = storyMediaContract.upload.maxVideoBytes
const maxWebStoryImageUploadBytes = storyMediaContract.upload.maxImageBytes
const maxWebStoryVideoDurationSeconds =
  storyMediaContract.upload.maxVideoDurationSeconds

const uploadSchema = z.object({
  assetKind: z.enum(["image", "video"]),
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive(),
  clientUploadId: z.string().uuid().optional(),
  replaceUploadSessionId: z.string().trim().min(1).max(100).optional(),
  displayContentType: z.enum(["image/avif", "image/webp"]).optional(),
})

function blobApiUrl(pathname: string) {
  const baseUrl =
    process.env.VERCEL_BLOB_API_URL ??
    process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL ??
    "https://blob.vercel-storage.com"
  const url = new URL(baseUrl)
  url.searchParams.set("pathname", pathname)
  return url.toString()
}

async function imageUploadPart(input: {
  pathname: string
  contentType: string
  maxSizeBytes: number
}) {
  const clientToken = await generateClientTokenFromReadWriteToken({
    pathname: input.pathname,
    allowedContentTypes: [input.contentType],
    maximumSizeInBytes: input.maxSizeBytes,
    validUntil: Date.now() + 15 * 60 * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
  })
  return {
    pathname: input.pathname,
    uploadUrl: blobApiUrl(input.pathname),
    clientToken,
    contentType: input.contentType,
    maxSizeBytes: input.maxSizeBytes,
  }
}

export async function POST(request: Request) {
  const uploadStartedAt = new Date()
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

  if (process.env.STORY_STORAGE_PROVIDER !== "vercel-blob") {
    return NextResponse.json(
      { error: "Story uploads require private Vercel Blob storage." },
      { status: 503 },
    )
  }

  try {
    if (parsed.data.assetKind === "image") {
      if (
        !isAllowedDirectStoryImageContentType(parsed.data.contentType) ||
        parsed.data.byteSize > maxWebStoryImageUploadBytes ||
        !parsed.data.displayContentType
      ) {
        return NextResponse.json(
          { error: "Choose a supported image up to 25 MB." },
          { status: 400 },
        )
      }
      const basePathname = directStoryImagePathname(
        session.id,
        parsed.data.fileName,
        uploadStartedAt,
      )
      const [display, thumbnail] = await Promise.all([
        imageUploadPart({
          pathname: directStoryImageDisplayPathname(
            basePathname,
            parsed.data.displayContentType,
          ),
          contentType: parsed.data.displayContentType,
          maxSizeBytes: maxStoryImageDisplayDerivativeBytes,
        }),
        imageUploadPart({
          pathname: directStoryImageThumbnailPathname(basePathname),
          contentType: "image/webp",
          maxSizeBytes: maxStoryImageThumbnailDerivativeBytes,
        }),
      ])
      return NextResponse.json({
        ok: true,
        assetKind: "image",
        basePathname,
        display,
        thumbnail,
      })
    }

    if (
      !isSupportedStoryVideoInputContentType(parsed.data.contentType) ||
      parsed.data.byteSize > maxWebStoryVideoUploadBytes
    ) {
      return NextResponse.json(
        { error: "Choose an MP4, MOV, or WEBM video up to 512 MB." },
        { status: 400 },
      )
    }

    if (parsed.data.replaceUploadSessionId && !parsed.data.clientUploadId) {
      throw new MediaUploadSessionError(
        "A client upload id is required to replace an upload session.",
        400,
      )
    }

    let uploadOrderReservedAt = uploadStartedAt
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
        uploadOrderReservedAt = retired.createdAt
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
        createdAt: uploadOrderReservedAt,
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
