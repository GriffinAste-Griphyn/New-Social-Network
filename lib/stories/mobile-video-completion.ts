import type { CompleteAuthSession } from "@/lib/auth"
import { userFacingModerationReason } from "@/lib/safety/user-facing"
import {
  createStory,
  getStoryByStoredAssetForOwner,
  getStoryTextOverlaysForOwner,
  getStoryUploadStatusForOwner,
} from "@/lib/story-store"
import {
  publicStoryMediaUrl,
  type StoredStoryAsset,
} from "@/lib/story-storage"
import {
  parseBrandTags,
  parseStoryCaption,
  parseStoryElements,
} from "@/lib/story-validators"

export type MobileVideoStoryCompletionFields = {
  caption: string
  brandTags: string
  stickers: string
  textOverlays: string
  textOverlayPositionX?: string
  textOverlayPositionY?: string
  linkLabel: string
  linkUrl: string
  linkOverlayPositionX?: string
  linkOverlayPositionY?: string
  quoteReplyId: string
  quoteReplyPositionX?: string
  quoteReplyPositionY?: string
}

type CompleteMobileVideoStoryInput = {
  request: Request
  session: CompleteAuthSession
  storedAsset: StoredStoryAsset
  fields: MobileVideoStoryCompletionFields
  providerStatusFallback?: string | null
  providerErrorFallback?: string | null
  onStoryCreated?: (storyId: string) => void | Promise<void>
}

type MobileVideoStoryResponseInput = {
  request: Request
  session: CompleteAuthSession
  storyId: string
  asset: {
    assetKind: "image" | "video"
    mediaUrl: string
    thumbnailUrl: string | null
    storageProvider?: string | null
    storageKey?: string | null
    contentType?: string | null
    byteSize?: number | null
    checksum?: string | null
    width?: number | null
    height?: number | null
    durationMs?: number | null
    originalMediaUrl?: string | null
    originalThumbnailUrl?: string | null
    originalStorageProvider?: string | null
    originalStorageKey?: string | null
    originalContentType?: string | null
    originalByteSize?: number | null
    originalChecksum?: string | null
    originalWidth?: number | null
    originalHeight?: number | null
    originalDurationMs?: number | null
    processingStatus: string
  }
  providerStatusFallback?: string | null
  providerErrorFallback?: string | null
  completionState: "created" | "reused"
}

function mobileVideoFieldsToFormData(fields: MobileVideoStoryCompletionFields) {
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

async function mobileVideoStoryResponse(input: MobileVideoStoryResponseInput) {
  const storyStatus = await getStoryUploadStatusForOwner(
    input.storyId,
    input.session.id,
  )
  const textOverlays = await getStoryTextOverlaysForOwner(
    input.storyId,
    input.session.id,
  )

  return {
    ok: true,
    storyId: input.storyId,
    completionState: input.completionState,
    asset: {
      assetKind: input.asset.assetKind,
      mediaUrl:
        publicStoryMediaUrl(input.asset.mediaUrl, input.request, {
          signed: true,
        }) ?? input.asset.mediaUrl,
      thumbnailUrl: publicStoryMediaUrl(input.asset.thumbnailUrl, input.request, {
        signed: true,
      }),
      renditions: {
        playback: {
          mediaUrl:
            publicStoryMediaUrl(input.asset.mediaUrl, input.request, {
              signed: true,
            }) ?? input.asset.mediaUrl,
          thumbnailUrl: publicStoryMediaUrl(
            input.asset.thumbnailUrl,
            input.request,
            { signed: true },
          ),
          storageProvider: input.asset.storageProvider ?? null,
          storageKey: input.asset.storageKey ?? null,
          contentType: input.asset.contentType ?? null,
          byteSize: input.asset.byteSize ?? null,
          checksum: input.asset.checksum ?? null,
          width: input.asset.width ?? null,
          height: input.asset.height ?? null,
          durationMs: input.asset.durationMs ?? null,
          processingStatus:
            storyStatus?.processingStatus ?? input.asset.processingStatus,
        },
        original: input.asset.originalMediaUrl
          ? {
              mediaUrl:
                publicStoryMediaUrl(
                  input.asset.originalMediaUrl,
                  input.request,
                  { signed: true },
                ) ?? input.asset.originalMediaUrl,
              thumbnailUrl: publicStoryMediaUrl(
                input.asset.originalThumbnailUrl ?? null,
                input.request,
                { signed: true },
              ),
              storageProvider: input.asset.originalStorageProvider ?? null,
              storageKey: input.asset.originalStorageKey ?? null,
              contentType: input.asset.originalContentType ?? null,
              byteSize: input.asset.originalByteSize ?? null,
              checksum: input.asset.originalChecksum ?? null,
              width: input.asset.originalWidth ?? null,
              height: input.asset.originalHeight ?? null,
              durationMs: input.asset.originalDurationMs ?? null,
              processingStatus: "ready",
            }
          : null,
      },
    },
    processingStatus: storyStatus?.processingStatus ?? input.asset.processingStatus,
    providerStatus:
      storyStatus?.providerStatus ?? input.providerStatusFallback ?? null,
    providerError:
      storyStatus?.providerError ?? input.providerErrorFallback ?? null,
    lastCheckedAt: storyStatus?.lastCheckedAt ?? null,
    readyAt: storyStatus?.readyAt ?? null,
    moderationStatus: storyStatus?.moderationStatus,
    moderationReason: userFacingModerationReason({
      moderationStatus: storyStatus?.moderationStatus,
      moderationReason: storyStatus?.moderationReason,
    }),
    textOverlays,
  }
}

export async function getExistingMobileVideoStoryCompletion(input: {
  request: Request
  session: CompleteAuthSession
  storageProvider: string
  storageKey: string
}) {
  const existingStory = await getStoryByStoredAssetForOwner({
    ownerId: input.session.id,
    storageProvider: input.storageProvider,
    storageKey: input.storageKey,
  })

  if (!existingStory) {
    return null
  }

  return mobileVideoStoryResponse({
    request: input.request,
    session: input.session,
    storyId: existingStory.id,
    asset: existingStory,
    completionState: "reused",
  })
}

export async function completeMobileVideoStory(
  input: CompleteMobileVideoStoryInput,
) {
  const formData = mobileVideoFieldsToFormData(input.fields)
  const moderationMediaUrl =
    publicStoryMediaUrl(input.storedAsset.mediaUrl, input.request, {
      signed: true,
    }) ?? input.storedAsset.mediaUrl
  const moderationThumbnailUrl = publicStoryMediaUrl(
    input.storedAsset.thumbnailUrl,
    input.request,
    { signed: true },
  )
  const storyElements = parseStoryElements(formData)
  const storyId = await createStory({
    session: input.session,
    caption: parseStoryCaption(formData.get("caption")),
    explicitBrandTags: parseBrandTags(formData.get("brandTags")),
    elements: storyElements,
    storedAsset: input.storedAsset,
    moderationMediaUrl,
    moderationThumbnailUrl,
  })

  await input.onStoryCreated?.(storyId)

  return mobileVideoStoryResponse({
    request: input.request,
    session: input.session,
    storyId,
    asset: {
      assetKind: input.storedAsset.assetKind,
      mediaUrl: input.storedAsset.mediaUrl,
      thumbnailUrl: input.storedAsset.thumbnailUrl,
      storageProvider: input.storedAsset.storageProvider,
      storageKey: input.storedAsset.storageKey,
      contentType: input.storedAsset.contentType,
      byteSize: input.storedAsset.byteSize,
      checksum: input.storedAsset.checksum,
      width: input.storedAsset.width,
      height: input.storedAsset.height,
      durationMs: input.storedAsset.durationMs,
      originalMediaUrl: input.storedAsset.originalMediaUrl ?? null,
      originalThumbnailUrl: input.storedAsset.originalThumbnailUrl ?? null,
      originalStorageProvider: input.storedAsset.originalStorageProvider ?? null,
      originalStorageKey: input.storedAsset.originalStorageKey ?? null,
      originalContentType: input.storedAsset.originalContentType ?? null,
      originalByteSize: input.storedAsset.originalByteSize ?? null,
      originalChecksum: input.storedAsset.originalChecksum ?? null,
      originalWidth: input.storedAsset.originalWidth ?? null,
      originalHeight: input.storedAsset.originalHeight ?? null,
      originalDurationMs: input.storedAsset.originalDurationMs ?? null,
      processingStatus: input.storedAsset.processingStatus,
    },
    providerStatusFallback: input.providerStatusFallback,
    providerErrorFallback: input.providerErrorFallback,
    completionState: "created",
  })
}
