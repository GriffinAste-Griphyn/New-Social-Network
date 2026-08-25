import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getSession, isProfileComplete } from "@/lib/auth"
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
import {
  createStory,
  getStoryByStoredAssetForOwner,
  getStoryUploadStatusForOwner,
} from "@/lib/story-store"
import {
  createCloudflareStreamStoredVideoAsset,
  createDirectBlobStoryImageAsset,
  directStoryImageUploadStartedAt,
  getCloudflareStreamVideoDetails,
  publicStoryMediaUrl,
  removeStoredStoryAsset,
  setCloudflareStreamThumbnailAtDefaultTime,
  StoryUploadError,
  type StoredStoryAsset,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import {
  isSupportedStoryVideoInputContentType,
  storyMediaContract,
} from "@/lib/story-media-contract"
import {
  parseBrandTags,
  parseStoryCaption,
  parseStoryElements,
} from "@/lib/story-validators"

export const runtime = "nodejs"

const completeSchema = z
  .object({
    assetKind: z.enum(["image", "video"]),
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
  .and(
    z.union([
      z.object({
        assetKind: z.literal("image"),
        basePathname: z.string().trim().min(1).max(500),
        displayDerivative: z.object({
          pathname: z.string().trim().min(1).max(500),
          contentType: z.enum(["image/avif", "image/webp"]),
          byteSize: z.number().int().positive(),
          checksum: z.string().regex(/^[a-f0-9]{64}$/i),
          width: z.literal(storyMediaContract.canvas.width),
          height: z.literal(storyMediaContract.canvas.height),
        }),
        thumbnailDerivative: z.object({
          pathname: z.string().trim().min(1).max(500),
          contentType: z.literal("image/webp"),
          byteSize: z.number().int().positive(),
          checksum: z.string().regex(/^[a-f0-9]{64}$/i),
          width: z.literal(storyMediaContract.thumbnail.width),
          height: z.literal(storyMediaContract.thumbnail.height),
        }),
        thumbHash: z.string().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/),
      }),
      z.object({
        assetKind: z.literal("video"),
        uid: z.string().regex(/^[a-f0-9]{32}$/i),
        uploadSessionId: z.string().trim().min(1).max(100).optional(),
        contentType: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .refine(isSupportedStoryVideoInputContentType)
          .default("video/mp4"),
        byteSize: z.number().int().positive(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/i),
        durationMs: z.number().int().positive().nullable().optional(),
        width: z.number().int().positive().nullable().optional(),
        height: z.number().int().positive().nullable().optional(),
      }),
    ]),
  )

function payloadToFormData(payload: z.infer<typeof completeSchema>) {
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
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  let storedAsset: StoredStoryAsset | undefined
  let storyCreatedAt: Date | undefined
  let claimedUploadSession:
    | Awaited<
        ReturnType<typeof claimMediaUploadSessionForCompletion>
      >["session"]
    | undefined

  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json(
        { error: "Sign in before uploading stories." },
        { status: 401 },
      )
    }

    if (!isProfileComplete(session)) {
      return NextResponse.json({ error: "Profile setup required." }, { status: 403 })
    }

    const rateLimitResponse = await enforceRequestRateLimits(request, [
      {
        bucket: "web:story-upload-complete:user",
        subject: session.id,
        options: mutationRateLimits.storyUploadUser,
      },
      {
        bucket: "web:story-upload-complete:ip",
        subject: requestIpSubject(request),
        options: mutationRateLimits.storyUploadIp,
      },
    ])
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    const parsed = completeSchema.safeParse(await request.json().catch(() => null))

    if (!parsed.success) {
      return NextResponse.json({ error: "Could not finish the upload." }, { status: 400 })
    }

    if (parsed.data.assetKind === "image") {
      storyCreatedAt =
        directStoryImageUploadStartedAt(parsed.data.basePathname) ?? undefined
      storedAsset = await createDirectBlobStoryImageAsset({
        basePathname: parsed.data.basePathname,
        ownerUserId: session.id,
        displayDerivative: parsed.data.displayDerivative,
        thumbnailDerivative: parsed.data.thumbnailDerivative,
        thumbHash: parsed.data.thumbHash,
      })
    } else {
      const uploadClaim = await claimMediaUploadSessionForCompletion({
        ownerUserId: session.id,
        uploadSessionId: parsed.data.uploadSessionId,
        storageProvider: "cloudflare-stream",
        storageKey: parsed.data.uid,
        contentType: parsed.data.contentType,
        byteSize: parsed.data.byteSize,
      })
      claimedUploadSession = uploadClaim.session
      storyCreatedAt = uploadClaim.session.createdAt

      const existingStory = await getStoryByStoredAssetForOwner({
        ownerId: session.id,
        storageProvider: "cloudflare-stream",
        storageKey: parsed.data.uid,
      })

      if (existingStory) {
        await markMediaUploadSessionCompleted({
          uploadSessionId: uploadClaim.session.id,
          ownerUserId: session.id,
          storyId: existingStory.id,
        })
        claimedUploadSession = undefined
        const storyStatus = await getStoryUploadStatusForOwner(
          existingStory.id,
          session.id,
        )

        return NextResponse.json({
          ok: true,
          storyId: existingStory.id,
          completionState: "reused",
          processingStatus:
            storyStatus?.processingStatus ?? existingStory.processingStatus,
          moderationStatus: storyStatus?.moderationStatus,
          asset: {
            assetKind: existingStory.assetKind,
            mediaUrl:
              publicStoryMediaUrl(existingStory.mediaUrl, request, {
                signed: true,
              }) ?? existingStory.mediaUrl,
            thumbnailUrl: publicStoryMediaUrl(
              existingStory.thumbnailUrl,
              request,
              { signed: true },
            ),
          },
        })
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

      await setCloudflareStreamThumbnailAtDefaultTime(parsed.data.uid).catch(
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
    }

    const formData = payloadToFormData(parsed.data)
    const moderationMediaUrl =
      publicStoryMediaUrl(storedAsset.mediaUrl, request, { signed: true }) ??
      storedAsset.mediaUrl
    const moderationThumbnailUrl = publicStoryMediaUrl(
      storedAsset.thumbnailUrl,
      request,
      { signed: true },
    )
    const storyId = await createStory({
      session,
      caption: parseStoryCaption(formData.get("caption")),
      explicitBrandTags: parseBrandTags(formData.get("brandTags")),
      elements: parseStoryElements(formData),
      storedAsset,
      moderationMediaUrl,
      moderationThumbnailUrl,
      createdAt: storyCreatedAt,
    })

    if (claimedUploadSession) {
      await markMediaUploadSessionCompleted({
        uploadSessionId: claimedUploadSession.id,
        ownerUserId: session.id,
        storyId,
      })
      claimedUploadSession = undefined
    }
    const storyStatus = await getStoryUploadStatusForOwner(storyId, session.id)

    revalidatePath("/feed")

    return NextResponse.json({
      ok: true,
      storyId,
      processingStatus: storyStatus?.processingStatus,
      moderationStatus: storyStatus?.moderationStatus,
      asset: {
        assetKind: storedAsset.assetKind,
        mediaUrl:
          publicStoryMediaUrl(storedAsset.mediaUrl, request, { signed: true }) ??
          storedAsset.mediaUrl,
        thumbnailUrl: publicStoryMediaUrl(storedAsset.thumbnailUrl, request, {
          signed: true,
        }),
      },
    })
  } catch (error) {
    if (claimedUploadSession) {
      await releaseMediaUploadSessionCompletion({
        uploadSessionId: claimedUploadSession.id,
        ownerUserId: claimedUploadSession.ownerUserId,
      }).catch(() => undefined)
    }

    if (storedAsset?.assetKind === "image") {
      await removeStoredStoryAsset(storedAsset).catch(() => undefined)
    }

    return NextResponse.json(
      {
        error:
          error instanceof StoryUploadError || error instanceof Error
            ? error.message
            : "Could not finish the upload.",
      },
      { status: error instanceof MediaUploadSessionError ? error.statusCode : 400 },
    )
  }
}
