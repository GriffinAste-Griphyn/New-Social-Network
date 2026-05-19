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

const videoThumbnailReadinessDelaysMs = [750, 1_500, 3_000]
const mediaModerationRetryDelaysMs = [1_000, 2_500]

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isModeratableImageResponse(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""

  return response.ok && contentType.startsWith("image/")
}

async function discardResponseBody(response: Response) {
  try {
    await response.body?.cancel()
  } catch {
    // Best-effort cleanup only.
  }
}

async function resolveReviewableImageUrl(input: {
  assetKind: "image" | "video"
  scanUrl: string
}) {
  if (input.assetKind === "image") {
    return { ok: true as const, url: input.scanUrl }
  }

  let lastError = "Video thumbnail was not available for safety scanning."

  for (let attempt = 0; attempt <= videoThumbnailReadinessDelaysMs.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(videoThumbnailReadinessDelaysMs[attempt - 1] ?? 0)
    }

    try {
      const response = await fetch(input.scanUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(6_000),
      })

      if (isModeratableImageResponse(response)) {
        await discardResponseBody(response)

        return { ok: true as const, url: response.url || input.scanUrl }
      }

      lastError = `Video thumbnail returned ${response.status} ${response.statusText}.`
      await discardResponseBody(response)
    } catch (error) {
      lastError =
        error instanceof Error
          ? `Video thumbnail fetch failed: ${error.message}`
          : "Video thumbnail fetch failed."
    }
  }

  return { ok: false as const, error: lastError }
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

function isRetryableOpenAiMediaError(result: ContentModerationResult) {
  if (!result.error) {
    return false
  }

  if (!result.categories.some((category) => category.key === "scanner_unavailable")) {
    return false
  }

  return /(?:image_url_unavailable|could not download|failed to download|download image|file_url)/i.test(
    result.error,
  )
}

async function moderateReviewableImageUrl(url: string) {
  let result = await moderateWithOpenAi([
    {
      type: "image_url",
      image_url: {
        url,
      },
    },
  ])

  for (const delayMs of mediaModerationRetryDelaysMs) {
    if (!isRetryableOpenAiMediaError(result)) {
      return result
    }

    await sleep(delayMs)
    result = await moderateWithOpenAi([
      {
        type: "image_url",
        image_url: {
          url,
        },
      },
    ])
  }

  return result
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

  const reviewableImageUrl = await resolveReviewableImageUrl({
    assetKind: input.assetKind,
    scanUrl,
  })

  if (!reviewableImageUrl.ok) {
    return resultFromSignals({
      provider: "openai",
      signals: [
        {
          key: "scanner_unavailable",
          confidence: 1,
          reason:
            "Video thumbnail was not available for safety scanning; content requires review.",
          source: "system",
        },
      ],
      error: reviewableImageUrl.error,
    })
  }

  return moderateReviewableImageUrl(reviewableImageUrl.url)
}
