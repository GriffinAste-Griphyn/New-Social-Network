import {
  approvedModerationResult,
  resultFromSignals,
  type ContentModerationResult,
} from "@/lib/safety/policy"
import { moderateWithOpenAi } from "@/lib/safety/openai-moderation"

type MediaModerationInput = {
  assetKind: "image" | "video"
  contentType: string
  byteSize: number
  durationMs?: number | null
  mediaUrl?: string | null
  thumbnailUrl?: string | null
}

function contentModerationProvider() {
  return process.env.CONTENT_MODERATION_PROVIDER?.trim().toLowerCase() || "local"
}

function productionRequiresProvider() {
  if (process.env.CONTENT_MODERATION_REQUIRE_PROVIDER === "true") {
    return true
  }

  return process.env.NODE_ENV === "production"
}

function isAbsoluteHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value && /^https?:\/\//i.test(value))
}

function scanStructuralMedia(input: MediaModerationInput): ContentModerationResult {
  if (input.byteSize <= 0) {
    return resultFromSignals({
      provider: "local-media",
      signals: [
        {
          key: "unsupported_media",
          confidence: 1,
          reason: "Media upload has no readable bytes.",
          source: "local_media",
        },
      ],
    })
  }

  if (input.assetKind === "image" && !input.contentType.startsWith("image/")) {
    return resultFromSignals({
      provider: "local-media",
      signals: [
        {
          key: "unsupported_media",
          confidence: 1,
          reason: "Image upload has an unexpected content type.",
          source: "local_media",
        },
      ],
    })
  }

  if (input.assetKind === "video" && !input.contentType.startsWith("video/")) {
    return resultFromSignals({
      provider: "local-media",
      signals: [
        {
          key: "unsupported_media",
          confidence: 1,
          reason: "Video upload has an unexpected content type.",
          source: "local_media",
        },
      ],
    })
  }

  if (input.assetKind === "video" && input.durationMs && input.durationMs > 120_000) {
    return resultFromSignals({
      provider: "local-media",
      signals: [
        {
          key: "unsupported_media",
          confidence: 1,
          reason: "Video duration exceeds the production safety limit.",
          source: "local_media",
        },
      ],
    })
  }

  return approvedModerationResult
}

export async function moderateMediaContent(
  input: MediaModerationInput,
): Promise<ContentModerationResult> {
  const structuralResult = scanStructuralMedia(input)

  if (structuralResult.action !== "approve") {
    return structuralResult
  }

  const provider = contentModerationProvider()

  if (provider === "off") {
    return approvedModerationResult
  }

  const scanUrl =
    input.assetKind === "image"
      ? input.mediaUrl
      : input.thumbnailUrl ?? input.mediaUrl

  if (provider !== "openai") {
    if (productionRequiresProvider()) {
      return resultFromSignals({
        provider: "local-media",
        signals: [
          {
            key: "scanner_unavailable",
            confidence: 1,
            reason:
              "Production media moderation provider is not configured; content requires review.",
            source: "system",
          },
        ],
        error: "CONTENT_MODERATION_PROVIDER is not openai.",
      })
    }

    return approvedModerationResult
  }

  if (!isAbsoluteHttpUrl(scanUrl)) {
    return resultFromSignals({
      provider: "openai",
      signals: [
        {
          key: "scanner_unavailable",
          confidence: 1,
          reason: "Media moderation requires an absolute reviewable media URL.",
          source: "system",
        },
      ],
      error: "Missing absolute media URL.",
    })
  }

  const imageUrl = scanUrl

  return moderateWithOpenAi([
    {
      type: "image_url",
      image_url: {
        url: imageUrl,
      },
    },
  ])
}
