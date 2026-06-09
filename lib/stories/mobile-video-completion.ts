import type { CompleteAuthSession } from "@/lib/auth"
import { userFacingModerationReason } from "@/lib/safety/user-facing"
import {
  createStory,
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

  const storyStatus = await getStoryUploadStatusForOwner(
    storyId,
    input.session.id,
  )
  const textOverlays = await getStoryTextOverlaysForOwner(
    storyId,
    input.session.id,
  )

  return {
    ok: true,
    storyId,
    asset: {
      assetKind: input.storedAsset.assetKind,
      mediaUrl:
        publicStoryMediaUrl(input.storedAsset.mediaUrl, input.request, {
          signed: true,
        }) ?? input.storedAsset.mediaUrl,
      thumbnailUrl: publicStoryMediaUrl(
        input.storedAsset.thumbnailUrl,
        input.request,
        { signed: true },
      ),
    },
    processingStatus:
      storyStatus?.processingStatus ?? input.storedAsset.processingStatus,
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
