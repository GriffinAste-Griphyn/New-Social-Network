import { head } from "@vercel/blob"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { stories } from "@/lib/db/schema"
import {
  claimMediaUploadSessionForCompletion,
  cloudflareDetailsFromUploadSession,
  isCloudflareStreamFullyReady,
  markMediaUploadSessionCompleted,
  MediaUploadSessionError,
  mergeCloudflareStreamProviderDetails,
  recordCloudflareStreamUploadStatus,
  releaseMediaUploadSessionCompletion,
} from "@/lib/media-upload-sessions"
import { enqueueMediaProcessing } from "@/lib/media-pipeline/jobs"
import {
  completeMobileVideoStory,
  getExistingMobileVideoStoryCompletion,
} from "@/lib/stories/mobile-video-completion"
import {
  createDirectBlobStoryVideoPosterUrl,
  createCloudflareStreamStoredVideoAsset,
  createVercelHlsProcessingStoredVideoAsset,
  getCloudflareStreamVideoDetails,
  maxStoryVideoPosterUploadBytes,
  setCloudflareStreamThumbnailAtDefaultTime,
  StoryUploadError,
  type StoredStoryAsset,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { isSupportedStoryVideoInputContentType } from "@/lib/story-media-contract"

export const runtime = "nodejs"

const minimumRequiredVideoPosterBuild = 306

const videoPosterSchema = z.object({
  pathname: z.string().trim().min(1).max(500),
  contentType: z.literal("image/jpeg"),
  byteSize: z.number().int().positive().max(maxStoryVideoPosterUploadBytes),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

const completeVideoSchema = z.object({
  uid: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine(
      (value) =>
        /^[a-f0-9]{32}$/i.test(value) ||
        (value.startsWith("media-originals/") && !value.includes("..")),
    ),
  uploadSessionId: z.string().trim().min(1).max(100).optional(),
  contentType: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(isSupportedStoryVideoInputContentType)
    .default("video/mp4"),
  byteSize: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().positive().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  poster: videoPosterSchema.nullable().optional(),
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
    JSON.stringify({
      level: event.endsWith("failed") ? "error" : "info",
      message: event,
      service: "mobile_video_complete",
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

    const clientBuild = Number.parseInt(
      request.headers.get("x-ubeye-app-build") ?? "",
      10,
    )
    if (
      Number.isFinite(clientBuild) &&
      clientBuild >= minimumRequiredVideoPosterBuild &&
      !parsed.data.poster
    ) {
      logVideoCompleteEvent("complete_missing_poster", {
        userId: session.id,
        uid: parsed.data.uid,
        clientBuild,
      })
      return NextResponse.json(
        { error: "Could not finish the video poster upload." },
        { status: 400 },
      )
    }

    logVideoCompleteEvent("complete_started", {
      userId: session.id,
      uid: parsed.data.uid,
      byteSize: parsed.data.byteSize,
      durationMs: parsed.data.durationMs ?? null,
      hasClientPoster: Boolean(parsed.data.poster),
    })

    // In-flight custom uploads must remain completable after a feature-flag
    // rollback, so completion follows the owner-bound upload id, not the flag.
    const useVercelHls = parsed.data.uid.startsWith("media-originals/")
    const storageProvider = useVercelHls
      ? ("vercel-blob" as const)
      : ("cloudflare-stream" as const)

    const uploadClaim = await claimMediaUploadSessionForCompletion({
      ownerUserId: session.id,
      uploadSessionId: parsed.data.uploadSessionId,
      storageProvider,
      storageKey: parsed.data.uid,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
    })
    claimedUploadSession = uploadClaim.session

    const existingCompletion = await getExistingMobileVideoStoryCompletion({
      request,
      session,
      storageProvider,
      storageKey: parsed.data.uid,
    })

    if (existingCompletion) {
      await markMediaUploadSessionCompleted({
        uploadSessionId: uploadClaim.session.id,
        ownerUserId: session.id,
        storyId: existingCompletion.storyId,
      })
      claimedUploadSession = undefined

      if (useVercelHls && existingCompletion.processingStatus !== "ready") {
        const [existingStory] = await getDb()
          .select({ mediaAssetId: stories.mediaAssetId })
          .from(stories)
          .where(eq(stories.id, existingCompletion.storyId))
          .limit(1)
        if (existingStory) {
          await enqueueMediaProcessing(existingStory.mediaAssetId).catch(
            (error) => {
              console.error("media_processing_reenqueue_failed", {
                storyId: existingCompletion.storyId,
                mediaAssetId: existingStory.mediaAssetId,
                error,
              })
            },
          )
        }
      }

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

    const posterUrl = parsed.data.poster
      ? await createDirectBlobStoryVideoPosterUrl({
          uid: parsed.data.uid,
          poster: parsed.data.poster,
        })
      : null

    if (useVercelHls) {
      const sourceMetadata = await head(parsed.data.uid, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }).catch(() => null)
      if (
        !sourceMetadata ||
        sourceMetadata.size !== parsed.data.byteSize ||
        sourceMetadata.contentType.toLowerCase() !==
          parsed.data.contentType.toLowerCase()
      ) {
        throw new MediaUploadSessionError(
          "The private source video is still being verified. Retry in a moment.",
          409,
        )
      }

      storedAsset = createVercelHlsProcessingStoredVideoAsset({
        pathname: sourceMetadata.pathname,
        contentType: parsed.data.contentType,
        byteSize: parsed.data.byteSize,
        checksum: sourceMetadata.etag,
        thumbnailUrl: posterUrl,
        durationMs: parsed.data.durationMs ?? null,
        width: parsed.data.width ?? null,
        height: parsed.data.height ?? null,
      })
      const completion = await completeMobileVideoStory({
        request,
        session,
        fields: parsed.data,
        storedAsset,
        createdAt: uploadClaim.session.createdAt,
        providerStatusFallback: "queued",
      })
      await markMediaUploadSessionCompleted({
        uploadSessionId: uploadClaim.session.id,
        ownerUserId: session.id,
        storyId: completion.storyId,
      })
      claimedUploadSession = undefined

      const [createdStory] = await getDb()
        .select({ mediaAssetId: stories.mediaAssetId })
        .from(stories)
        .where(eq(stories.id, completion.storyId))
        .limit(1)
      if (createdStory) {
        await enqueueMediaProcessing(createdStory.mediaAssetId).catch((error) => {
          console.error("media_processing_enqueue_failed", {
            storyId: completion.storyId,
            mediaAssetId: createdStory.mediaAssetId,
            error,
          })
        })
      }

      logVideoCompleteEvent("complete_succeeded", {
        userId: session.id,
        uid: parsed.data.uid,
        storyId: completion.storyId,
        processingStatus: completion.processingStatus,
        moderationStatus: completion.moderationStatus ?? null,
      })
      return NextResponse.json(completion)
    }

    const retainedCloudflareDetails = cloudflareDetailsFromUploadSession(
      uploadClaim.session,
    )
    const observedCloudflareDetails = await getCloudflareStreamVideoDetails(
      parsed.data.uid,
    ).catch(() => retainedCloudflareDetails)
    const cloudflareDetails = observedCloudflareDetails
      ? mergeCloudflareStreamProviderDetails(
          retainedCloudflareDetails,
          observedCloudflareDetails,
        )
      : retainedCloudflareDetails

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

    try {
      await setCloudflareStreamThumbnailAtDefaultTime(parsed.data.uid)
    } catch (error) {
      logVideoCompleteEvent("cloudflare_thumbnail_configuration_failed", {
        userId: session.id,
        uid: parsed.data.uid,
        reason: error instanceof Error ? error.message : "unknown",
      })
    }

    storedAsset = createCloudflareStreamStoredVideoAsset({
      uid: parsed.data.uid,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
      thumbnailUrl: posterUrl,
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
    const completion = await completeMobileVideoStory({
      request,
      session,
      fields: parsed.data,
      storedAsset,
      createdAt: uploadClaim.session.createdAt,
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
