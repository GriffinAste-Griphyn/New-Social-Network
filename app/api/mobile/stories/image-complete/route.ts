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
  directStoryImageUploadStartedAt,
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
  basePathname: z.string().trim().min(1).max(500),
  displayDerivative: clientDerivativeSchema,
  thumbnailDerivative: clientDerivativeSchema,
  thumbHash: z.string().trim().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/),
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

type ImageCompletionStage =
  | "verify-variants"
  | "validate-caption"
  | "validate-brand-tags"
  | "validate-elements"
  | "create-story"
  | "read-story"

function imageCompletionFailure(stage: ImageCompletionStage, error: unknown) {
  if (error instanceof z.ZodError) {
    const message =
      stage === "validate-caption"
        ? "Captions must be 220 characters or fewer."
        : stage === "validate-brand-tags"
          ? "Each brand tag must be 2–32 characters."
          : "Story text must be 220 characters or fewer, link labels 64 or fewer, and links must be valid URLs."

    return { code: "invalid_story_details", message, status: 400 }
  }

  if (error instanceof StoryUploadError) {
    return {
      code:
        stage === "verify-variants"
          ? "image_variant_verification_failed"
          : "story_completion_rejected",
      message: error.message,
      status: 400,
    }
  }

  return {
    code: "story_completion_failed",
    message: "Could not publish the story. Try again.",
    status: 500,
  }
}

export async function POST(request: Request) {
  let storedAsset: StoredStoryAsset | undefined
  let stage: ImageCompletionStage = "verify-variants"

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
      console.error("story_image_completion_failed", {
        stage: "validate-payload",
        code: "invalid_completion_payload",
        issues: parsed.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.join("."),
        })),
      })
      return NextResponse.json(
        {
          error: "The app sent incomplete image details. Update UBEYE and retry.",
          code: "invalid_completion_payload",
        },
        { status: 400 },
      )
    }

    stage = "verify-variants"
    storedAsset = await createDirectBlobStoryImageAsset({
      basePathname: parsed.data.basePathname,
      ownerUserId: session.id,
      displayDerivative: toClientDerivative(parsed.data.displayDerivative)!,
      thumbnailDerivative: toClientDerivative(parsed.data.thumbnailDerivative)!,
      thumbHash: parsed.data.thumbHash,
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

    stage = "validate-caption"
    const caption = parseStoryCaption(formData.get("caption"))
    stage = "validate-brand-tags"
    const explicitBrandTags = parseBrandTags(formData.get("brandTags"))
    stage = "validate-elements"
    const elements = parseStoryElements(formData)

    stage = "create-story"
    const storyId = await createStory({
      session,
      caption,
      explicitBrandTags,
      elements,
      storedAsset,
      moderationMediaUrl,
      moderationThumbnailUrl,
      createdAt:
        directStoryImageUploadStartedAt(parsed.data.basePathname) ?? undefined,
    })

    stage = "read-story"
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

    const failure = imageCompletionFailure(stage, error)
    console.error("story_image_completion_failed", {
      stage,
      code: failure.code,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        error: failure.message,
        code: failure.code,
      },
      { status: failure.status },
    )
  }
}
