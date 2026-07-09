import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  claimMediaUploadSessionForCompletion,
  cloudflareDetailsFromUploadSession,
  isCloudflareStreamFullyReady,
  markMediaUploadSessionCompleted,
  MediaUploadSessionError,
  recordCloudflareStreamUploadStatus,
  releaseMediaUploadSessionCompletion,
} from "@/lib/media-upload-sessions"
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
  setCloudflareStreamThumbnailToLastFrame,
  StoryUploadError,
  type StoredStoryAsset,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const completeVideoSchema = z.object({
  uid: z.string().regex(/^[a-f0-9]{32}$/i),
  uploadSessionId: z.string().trim().min(1).max(100).optional(),
  contentType: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => value.toLowerCase().startsWith("video/"))
    .default("video/mp4"),
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
  let claimedUploadSession:
    | Awaited<
        ReturnType<typeof claimMediaUploadSessionForCompletion>
      >["session"]
    | undefined

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

    const uploadClaim = await claimMediaUploadSessionForCompletion({
      ownerUserId: session.id,
      uploadSessionId: parsed.data.uploadSessionId,
      storageProvider: "cloudflare-stream",
      storageKey: parsed.data.uid,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
    })
    claimedUploadSession = uploadClaim.session

    const existingCompletion = await getExistingMobileVideoStoryCompletion({
      request,
      session,
      storageProvider: "cloudflare-stream",
      storageKey: parsed.data.uid,
    })

    if (existingCompletion) {
      await markMediaUploadSessionCompleted({
        uploadSessionId: uploadClaim.session.id,
        ownerUserId: session.id,
        storyId: existingCompletion.storyId,
      })
      claimedUploadSession = undefined

      logVideoCompleteEvent("complete_reused", {
        userId: session.id,
        uid: parsed.data.uid,
        storyId: existingCompletion.storyId,
        processingStatus: existingCompletion.processingStatus,
        moderationStatus: existingCompletion.moderationStatus ?? null,
      })

      return NextResponse.json(existingCompletion)
    }

    if (uploadClaim.state === "completed") {
      throw new MediaUploadSessionError(
        "The completed upload could not be matched to its story.",
        409,
      )
    }

    const retainedCloudflareDetails = cloudflareDetailsFromUploadSession(
      uploadClaim.session,
    )
    const cloudflareDetails = await getCloudflareStreamVideoDetails(
      parsed.data.uid,
    ).catch(() => retainedCloudflareDetails)

    if (cloudflareDetails) {
      await recordCloudflareStreamUploadStatus({
        uid: parsed.data.uid,
        details: cloudflareDetails,
      }).catch(() => undefined)
    }

    if (cloudflareDetails?.state === "error") {
      throw new MediaUploadSessionError(
        cloudflareDetails.errorReason ??
          "Cloudflare Stream could not process the video.",
        410,
      )
    }

    if (parsed.data.thumbnailPathname) {
      const expectedThumbnailPathname = createCloudflareStreamClientThumbnailPathname(
        session.id,
        parsed.data.uid,
      )

      if (
        parsed.data.thumbnailPathname !== expectedThumbnailPathname ||
        !parsed.data.thumbnailContentType ||
        !isAllowedOriginalQualityVideoThumbnailContentType(
          parsed.data.thumbnailContentType,
        ) ||
        !parsed.data.thumbnailByteSize ||
        !parsed.data.thumbnailChecksum
      ) {
        throw new MediaUploadSessionError(
          "Could not verify the story video thumbnail.",
          400,
        )
      }

      uploadedThumbnailUrl = await createCloudflareStreamClientThumbnailUrl({
        pathname: parsed.data.thumbnailPathname,
        contentType: parsed.data.thumbnailContentType,
        byteSize: parsed.data.thumbnailByteSize,
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
      processingStatus:
        cloudflareDetails && isCloudflareStreamFullyReady(cloudflareDetails)
          ? "ready"
          : "processing",
      providerPctComplete:
        cloudflareDetails?.pctComplete ??
        (cloudflareDetails && isCloudflareStreamFullyReady(cloudflareDetails)
          ? 100
          : null),
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
    })

    await markMediaUploadSessionCompleted({
      uploadSessionId: uploadClaim.session.id,
      ownerUserId: session.id,
      storyId: completion.storyId,
    })
    claimedUploadSession = undefined

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
    if (claimedUploadSession) {
      await releaseMediaUploadSessionCompletion({
        uploadSessionId: claimedUploadSession.id,
        ownerUserId: claimedUploadSession.ownerUserId,
      }).catch(() => undefined)
    }

    return NextResponse.json(
      {
        error:
          error instanceof StoryUploadError || error instanceof Error
            ? error.message
            : "Could not finish the video upload.",
      },
      { status: error instanceof MediaUploadSessionError ? error.statusCode : 400 },
    )
  }
}
