import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import { userFacingModerationReason } from "@/lib/safety/user-facing"
import {
  createStory,
  getStoryTextOverlaysForOwner,
  getStoryUploadStatusForOwner,
} from "@/lib/story-store"
import {
  createCloudflareStreamClientThumbnailPathname,
  createCloudflareStreamClientThumbnailUrl,
  createCloudflareStreamStoredVideoAsset,
  getCloudflareStreamVideoDetails,
  isAllowedOriginalQualityVideoThumbnailContentType,
  maxCloudflareStreamClientThumbnailUploadBytes,
  publicStoryMediaUrl,
  removeStoryAsset,
  setCloudflareStreamThumbnailToLastFrame,
  StoryUploadError,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import {
  parseBrandTags,
  parseStoryCaption,
  parseStoryElements,
} from "@/lib/story-validators"

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

function payloadToFormData(payload: z.infer<typeof completeVideoSchema>) {
  const formData = new FormData()

  formData.set("caption", payload.caption)
  formData.set("brandTags", payload.brandTags)
  formData.set("stickers", payload.stickers)
  formData.set("textOverlays", payload.textOverlays)
  formData.set("textOverlayPositionX", payload.textOverlayPositionX ?? "50.00")
  formData.set("textOverlayPositionY", payload.textOverlayPositionY ?? "74.00")
  formData.set("linkLabel", payload.linkLabel)
  formData.set("linkUrl", payload.linkUrl)
  formData.set("linkOverlayPositionX", payload.linkOverlayPositionX ?? "50.00")
  formData.set("linkOverlayPositionY", payload.linkOverlayPositionY ?? "78.00")
  formData.set("quoteReplyId", payload.quoteReplyId)
  formData.set("quoteReplyPositionX", payload.quoteReplyPositionX ?? "50.00")
  formData.set("quoteReplyPositionY", payload.quoteReplyPositionY ?? "58.00")

  return formData
}

export async function POST(request: Request) {
  let storedAsset:
    | ReturnType<typeof createCloudflareStreamStoredVideoAsset>
    | undefined
  let uploadedThumbnailUrl: string | null = null

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

    const cloudflareDetails = await getCloudflareStreamVideoDetails(
      parsed.data.uid,
    ).catch(() => null)

    if (cloudflareDetails?.state === "error") {
      throw new StoryUploadError(
        cloudflareDetails.errorReason ??
          "Cloudflare Stream could not process the video.",
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
        return NextResponse.json(
          { error: "Could not verify the story video thumbnail." },
          { status: 400 },
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
      processingStatus: cloudflareDetails?.readyToStream ? "ready" : "processing",
    })
    storedAsset = uploadedThumbnailUrl
      ? { ...storedAsset, thumbnailUrl: uploadedThumbnailUrl }
      : storedAsset

    const formData = payloadToFormData(parsed.data)
    const moderationMediaUrl =
      publicStoryMediaUrl(storedAsset.mediaUrl, request, { signed: true }) ??
      storedAsset.mediaUrl
    const moderationThumbnailUrl = publicStoryMediaUrl(
      storedAsset.thumbnailUrl,
      request,
      { signed: true },
    )
    const storyElements = parseStoryElements(formData)
    const storyId = await createStory({
      session,
      caption: parseStoryCaption(formData.get("caption")),
      explicitBrandTags: parseBrandTags(formData.get("brandTags")),
      elements: storyElements,
      storedAsset,
      moderationMediaUrl,
      moderationThumbnailUrl,
    })
    const storyStatus = await getStoryUploadStatusForOwner(storyId, session.id)
    const textOverlays = await getStoryTextOverlaysForOwner(storyId, session.id)

    logVideoCompleteEvent("complete_succeeded", {
      userId: session.id,
      uid: parsed.data.uid,
      storyId,
      cloudflareState: cloudflareDetails?.state ?? null,
      readyToStream: cloudflareDetails?.readyToStream ?? null,
      processingStatus: storyStatus?.processingStatus ?? storedAsset.processingStatus,
      moderationStatus: storyStatus?.moderationStatus ?? null,
    })

    return NextResponse.json({
      ok: true,
      storyId,
      asset: {
        assetKind: storedAsset.assetKind,
        mediaUrl:
          publicStoryMediaUrl(storedAsset.mediaUrl, request, { signed: true }) ??
          storedAsset.mediaUrl,
        thumbnailUrl: publicStoryMediaUrl(storedAsset.thumbnailUrl, request, {
          signed: true,
        }),
      },
      processingStatus: storyStatus?.processingStatus ?? storedAsset.processingStatus,
      moderationStatus: storyStatus?.moderationStatus,
      moderationReason: userFacingModerationReason({
        moderationStatus: storyStatus?.moderationStatus,
        moderationReason: storyStatus?.moderationReason,
      }),
      textOverlays,
    })
  } catch (error) {
    logVideoCompleteEvent("complete_failed", {
      uid: storedAsset?.storageKey ?? null,
      reason:
        error instanceof StoryUploadError || error instanceof Error
          ? error.message
          : "unknown",
    })
    if (storedAsset) {
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
