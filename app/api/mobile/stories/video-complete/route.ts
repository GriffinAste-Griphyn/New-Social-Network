import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  completeMobileVideoStory,
  getExistingMobileVideoStoryCompletion,
} from "@/lib/stories/mobile-video-completion"
import {
  createCloudflareStreamClientThumbnailPathname,
  createCloudflareStreamClientThumbnailUrl,
  createCloudflareStreamStoredVideoAsset,
  getCloudflareStreamVideoDetails,
  isAllowedOriginalQualityVideoThumbnailContentType,
  maxCloudflareStreamClientThumbnailUploadBytes,
  removeStoryAsset,
  setCloudflareStreamThumbnailToLastFrame,
  StoryUploadError,
  type StoredStoryAsset,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import {
  claimStoryVideoUpload,
  completeStoryVideoUpload,
  failStoryVideoUpload,
  releaseStoryVideoUploadClaim,
  type ClaimedStoryVideoUpload,
} from "@/lib/story-video-uploads"

export const runtime = "nodejs"

const completeVideoSchema = z.object({
  uid: z.string().regex(/^[a-f0-9]{32}$/i),
  contentType: z.string().trim().min(1).max(120).default("video/mp4"),
  byteSize: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().positive().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  thumbnailPathname: z.string().trim().min(1).max(500).nullable().optional(),
  thumbnailContentType: z.string().trim().min(1).max(120).nullable().optional(),
  thumbnailByteSize: z
    .number()
    .int()
    .positive()
    .max(maxCloudflareStreamClientThumbnailUploadBytes)
    .nullable()
    .optional(),
  thumbnailChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .nullable()
    .optional(),
  caption: z.string().default(""),
  brandTags: z.string().default(""),
  stickers: z.string().default(""),
  textOverlays: z.string().default(""),
  textOverlayPositionX: z.string().optional(),
  textOverlayPositionY: z.string().optional(),
  linkLabel: z.string().default(""),
  linkUrl: z.string().default(""),
  linkOverlayPositionX: z.string().optional(),
  linkOverlayPositionY: z.string().optional(),
  quoteReplyId: z.string().default(""),
  quoteReplyPositionX: z.string().optional(),
  quoteReplyPositionY: z.string().optional(),
})

function logVideoCompleteEvent(
  event: string,
  metadata: Record<string, string | number | boolean | null | undefined>,
) {
  console.info(
    "mobile_video_complete",
    JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined),
      ),
    }),
  )
}

export async function POST(request: Request) {
  let storedAsset: StoredStoryAsset | undefined
  let uploadedThumbnailUrl: string | null = null
  let claimedVideoUpload: ClaimedStoryVideoUpload | null = null
  let createdStoryId: string | null = null
  let shouldFailClaim = false
  let verifiedThumbnail:
    | {
        pathname: string
        contentType: string
        byteSize: number
      }
    | null = null

  try {
    const session = await getCompleteMobileSession(request)

    if (!session) {
      return NextResponse.json(
        { error: "Sign in before uploading stories." },
        { status: 401 },
      )
    }

    const rateLimitResponse = await enforceRequestRateLimits(request, [
      {
        bucket: "mobile:story-video-complete:user",
        subject: session.id,
        options: mutationRateLimits.storyUploadUser,
      },
      {
        bucket: "mobile:story-video-complete:ip",
        subject: requestIpSubject(request),
        options: mutationRateLimits.storyUploadIp,
      },
    ])
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    const parsed = completeVideoSchema.safeParse(
      await request.json().catch(() => null),
    )

    if (!parsed.success) {
      logVideoCompleteEvent("complete_invalid_payload", {
        userId: session.id,
        ip: requestIpSubject(request),
      })
      return NextResponse.json(
        { error: "Could not finish the video upload." },
        { status: 400 },
      )
    }

    logVideoCompleteEvent("complete_started", {
      userId: session.id,
      uid: parsed.data.uid,
      byteSize: parsed.data.byteSize,
      durationMs: parsed.data.durationMs ?? null,
      hasClientThumbnail: Boolean(parsed.data.thumbnailPathname),
    })

    const existingCompletion = await getExistingMobileVideoStoryCompletion({
      request,
      session,
      storageProvider: "cloudflare-stream",
      storageKey: parsed.data.uid,
    })

    if (existingCompletion) {
      logVideoCompleteEvent("complete_reused", {
        userId: session.id,
        uid: parsed.data.uid,
        storyId: existingCompletion.storyId,
        processingStatus: existingCompletion.processingStatus,
        moderationStatus: existingCompletion.moderationStatus ?? null,
      })

      return NextResponse.json(existingCompletion)
    }

    const thumbnailPathname = parsed.data.thumbnailPathname ?? null
    if (thumbnailPathname) {
      const expectedThumbnailPathname = createCloudflareStreamClientThumbnailPathname(
        session.id,
        parsed.data.uid,
      )
      const thumbnailContentType = parsed.data.thumbnailContentType ?? null
      const thumbnailByteSize = parsed.data.thumbnailByteSize ?? null

      if (
        thumbnailPathname !== expectedThumbnailPathname ||
        !thumbnailContentType ||
        !isAllowedOriginalQualityVideoThumbnailContentType(
          thumbnailContentType,
        ) ||
        !thumbnailByteSize ||
        !parsed.data.thumbnailChecksum
      ) {
        return NextResponse.json(
          { error: "Could not verify the story video thumbnail." },
          { status: 400 },
        )
      }

      verifiedThumbnail = {
        pathname: thumbnailPathname,
        contentType: thumbnailContentType,
        byteSize: thumbnailByteSize,
      }
    }

    claimedVideoUpload = await claimStoryVideoUpload({
      ownerUserId: session.id,
      uid: parsed.data.uid,
      surface: "mobile",
    })

    if (!claimedVideoUpload) {
      logVideoCompleteEvent("complete_unowned_upload", {
        userId: session.id,
        uid: parsed.data.uid,
      })
      return NextResponse.json(
        { error: "Could not verify the video upload." },
        { status: 400 },
      )
    }

    if (
      parsed.data.byteSize > claimedVideoUpload.maxSizeBytes ||
      (parsed.data.durationMs &&
        parsed.data.durationMs > claimedVideoUpload.maxDurationSeconds * 1000)
    ) {
      logVideoCompleteEvent("complete_upload_limits_mismatch", {
        userId: session.id,
        uid: parsed.data.uid,
        byteSize: parsed.data.byteSize,
        maxSizeBytes: claimedVideoUpload.maxSizeBytes,
        durationMs: parsed.data.durationMs ?? null,
        maxDurationMs: claimedVideoUpload.maxDurationSeconds * 1000,
      })
      await failStoryVideoUpload(claimedVideoUpload.id).catch(() => undefined)
      return NextResponse.json(
        { error: "Could not verify the video upload." },
        { status: 400 },
      )
    }

    const cloudflareDetails = await getCloudflareStreamVideoDetails(
      parsed.data.uid,
    ).catch(() => null)

    if (cloudflareDetails?.state === "error") {
      shouldFailClaim = true
      throw new StoryUploadError(
        cloudflareDetails.errorReason ??
          "Cloudflare Stream could not process the video.",
      )
    }

    if (verifiedThumbnail) {
      uploadedThumbnailUrl = await createCloudflareStreamClientThumbnailUrl({
        pathname: verifiedThumbnail.pathname,
        contentType: verifiedThumbnail.contentType,
        byteSize: verifiedThumbnail.byteSize,
      })
    }

    await setCloudflareStreamThumbnailToLastFrame(parsed.data.uid).catch(
      () => undefined,
    )

    storedAsset = createCloudflareStreamStoredVideoAsset({
      uid: parsed.data.uid,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
      durationMs: parsed.data.durationMs ?? cloudflareDetails?.durationMs ?? null,
      width: parsed.data.width ?? cloudflareDetails?.width ?? null,
      height: parsed.data.height ?? cloudflareDetails?.height ?? null,
      processingStatus: cloudflareDetails?.readyToStream ? "ready" : "processing",
    })
    storedAsset = uploadedThumbnailUrl
      ? { ...storedAsset, thumbnailUrl: uploadedThumbnailUrl }
      : storedAsset

    const completion = await completeMobileVideoStory({
      request,
      session,
      fields: parsed.data,
      storedAsset,
      providerStatusFallback: cloudflareDetails?.state ?? null,
      providerErrorFallback: cloudflareDetails?.errorReason ?? null,
      onStoryCreated: (storyId) => {
        createdStoryId = storyId
      },
    })
    if (claimedVideoUpload) {
      await completeStoryVideoUpload({
        id: claimedVideoUpload.id,
        storyId: completion.storyId,
      }).catch((error) => {
        console.error("Could not mark mobile story video upload completed.", {
          uploadId: claimedVideoUpload?.id,
          storyId: completion.storyId,
          error,
        })
      })
    }

    logVideoCompleteEvent("complete_succeeded", {
      userId: session.id,
      uid: parsed.data.uid,
      storyId: completion.storyId,
      cloudflareState: cloudflareDetails?.state ?? null,
      readyToStream: cloudflareDetails?.readyToStream ?? null,
      processingStatus: completion.processingStatus,
      moderationStatus: completion.moderationStatus ?? null,
    })

    return NextResponse.json(completion)
  } catch (error) {
    logVideoCompleteEvent("complete_failed", {
      uid: storedAsset?.storageKey ?? null,
      reason:
        error instanceof StoryUploadError || error instanceof Error
          ? error.message
          : "unknown",
    })
    if (claimedVideoUpload && createdStoryId) {
      await completeStoryVideoUpload({
        id: claimedVideoUpload.id,
        storyId: createdStoryId,
      }).catch(() => undefined)
    } else if (claimedVideoUpload && shouldFailClaim) {
      await failStoryVideoUpload(claimedVideoUpload.id).catch(() => undefined)
    } else if (claimedVideoUpload) {
      await releaseStoryVideoUploadClaim(claimedVideoUpload.id).catch(
        () => undefined,
      )
    }
    if (storedAsset && !createdStoryId) {
      await removeStoryAsset(storedAsset.mediaUrl)
    }
    if (uploadedThumbnailUrl) {
      await removeStoryAsset(uploadedThumbnailUrl).catch(() => undefined)
    }

    return NextResponse.json(
      {
        error:
          error instanceof StoryUploadError || error instanceof Error
            ? error.message
            : "Could not finish the video upload.",
      },
      { status: 400 },
    )
  }
}
