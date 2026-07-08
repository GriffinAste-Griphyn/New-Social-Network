import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  createStory,
  getStoryTextOverlaysForOwner,
  getStoryUploadStatusForOwner,
} from "@/lib/story-store"
import { userFacingModerationReason } from "@/lib/safety/user-facing"
import {
  createDirectBlobStoryImageAsset,
  publicStoryMediaUrl,
  removeStoredStoryAsset,
  StoryUploadError,
  type DirectStoryImageClientDerivativeInput,
  type StoredStoryAsset,
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
export const maxDuration = 60

const clientDerivativeSchema = z.object({
  pathname: z.string().trim().min(1).max(500),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
})

const completeImageSchema = z.object({
  pathname: z.string().trim().min(1).max(500),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  displayDerivative: clientDerivativeSchema.nullable().optional(),
  thumbnailDerivative: clientDerivativeSchema.nullable().optional(),
  placeholderDerivative: clientDerivativeSchema.nullable().optional(),
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

function imageFieldsToFormData(fields: z.infer<typeof completeImageSchema>) {
  const formData = new FormData()

  formData.set("caption", fields.caption)
  formData.set("brandTags", fields.brandTags)
  formData.set("stickers", fields.stickers)
  formData.set("textOverlays", fields.textOverlays)
  formData.set("textOverlayPositionX", fields.textOverlayPositionX ?? "50.00")
  formData.set("textOverlayPositionY", fields.textOverlayPositionY ?? "74.00")
  formData.set("linkLabel", fields.linkLabel)
  formData.set("linkUrl", fields.linkUrl)
  formData.set("linkOverlayPositionX", fields.linkOverlayPositionX ?? "50.00")
  formData.set("linkOverlayPositionY", fields.linkOverlayPositionY ?? "78.00")
  formData.set("quoteReplyId", fields.quoteReplyId)
  formData.set("quoteReplyPositionX", fields.quoteReplyPositionX ?? "50.00")
  formData.set("quoteReplyPositionY", fields.quoteReplyPositionY ?? "58.00")

  return formData
}

function toClientDerivative(
  derivative:
    | z.infer<typeof clientDerivativeSchema>
    | null
    | undefined,
): DirectStoryImageClientDerivativeInput | null {
  if (!derivative) {
    return null
  }

  return {
    pathname: derivative.pathname,
    contentType: derivative.contentType,
    byteSize: derivative.byteSize,
    checksum: derivative.checksum,
    width: derivative.width ?? null,
    height: derivative.height ?? null,
  }
}

function publicAssetResponse(storedAsset: StoredStoryAsset, request: Request) {
  const mediaUrl =
    publicStoryMediaUrl(storedAsset.mediaUrl, request, { signed: true }) ??
    storedAsset.mediaUrl
  const thumbnailUrl = publicStoryMediaUrl(storedAsset.thumbnailUrl, request, {
    signed: true,
  })
  const placeholderUrl = publicStoryMediaUrl(storedAsset.placeholderUrl ?? null, request, {
    signed: true,
  })

  return {
    assetKind: storedAsset.assetKind,
    mediaUrl,
    thumbnailUrl,
    placeholderUrl,
    renditions: {
      playback: {
        mediaUrl,
        thumbnailUrl,
        placeholderUrl,
        storageProvider: storedAsset.storageProvider,
        storageKey: storedAsset.storageKey,
        contentType: storedAsset.contentType,
        byteSize: storedAsset.byteSize,
        checksum: storedAsset.checksum,
        width: storedAsset.width,
        height: storedAsset.height,
        durationMs: storedAsset.durationMs,
        processingStatus: storedAsset.processingStatus,
      },
      original: null,
    },
  }
}

export async function POST(request: Request) {
  let storedAsset: StoredStoryAsset | undefined

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
        bucket: "mobile:story-image-complete:user",
        subject: session.id,
        options: mutationRateLimits.storyUploadUser,
      },
      {
        bucket: "mobile:story-image-complete:ip",
        subject: requestIpSubject(request),
        options: mutationRateLimits.storyUploadIp,
      },
    ])
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    const parsed = completeImageSchema.safeParse(
      await request.json().catch(() => null),
    )

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Could not finish the image upload." },
        { status: 400 },
      )
    }

    storedAsset = await createDirectBlobStoryImageAsset({
      pathname: parsed.data.pathname,
      ownerUserId: session.id,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
      checksum: parsed.data.checksum,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
      displayDerivative: toClientDerivative(parsed.data.displayDerivative),
      thumbnailDerivative: toClientDerivative(parsed.data.thumbnailDerivative),
      placeholderDerivative: toClientDerivative(parsed.data.placeholderDerivative),
    })

    const moderationMediaUrl =
      publicStoryMediaUrl(storedAsset.mediaUrl, request, { signed: true }) ??
      storedAsset.mediaUrl
    const moderationThumbnailUrl = publicStoryMediaUrl(
      storedAsset.thumbnailUrl,
      request,
      { signed: true },
    )
    const formData = imageFieldsToFormData(parsed.data)
    const storyId = await createStory({
      session,
      caption: parseStoryCaption(formData.get("caption")),
      explicitBrandTags: parseBrandTags(formData.get("brandTags")),
      elements: parseStoryElements(formData),
      storedAsset,
      moderationMediaUrl,
      moderationThumbnailUrl,
    })
    const storyStatus = await getStoryUploadStatusForOwner(storyId, session.id)
    const textOverlays = await getStoryTextOverlaysForOwner(storyId, session.id)

    return NextResponse.json({
      ok: true,
      storyId,
      completionState: "created",
      asset: publicAssetResponse(storedAsset, request),
      processingStatus: storyStatus?.processingStatus ?? storedAsset.processingStatus,
      providerStatus: storyStatus?.providerStatus ?? storedAsset.processingStatus,
      providerPctComplete: storyStatus?.providerPctComplete ?? 100,
      fullQualityReady: storyStatus?.fullQualityReady ?? true,
      providerError: storyStatus?.providerError ?? null,
      lastCheckedAt: storyStatus?.lastCheckedAt ?? null,
      readyAt: storyStatus?.readyAt ?? null,
      moderationStatus: storyStatus?.moderationStatus,
      moderationReason: userFacingModerationReason({
        moderationStatus: storyStatus?.moderationStatus,
        moderationReason: storyStatus?.moderationReason,
      }),
      textOverlays,
    })
  } catch (error) {
    if (storedAsset) {
      await removeStoredStoryAsset(storedAsset).catch(() => undefined)
    }

    return NextResponse.json(
      {
        error:
          error instanceof StoryUploadError || error instanceof Error
            ? error.message
            : "Could not finish the image upload.",
      },
      { status: 400 },
    )
  }
}
