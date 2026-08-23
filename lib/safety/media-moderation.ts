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

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
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
      const response = await fetchWithTimeout(input.scanUrl, 6_000)

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

function isUnsupportedOpenAiImageFormatError(result: ContentModerationResult) {
  if (!result.error) {
    return false
  }

  return (
    result.categories.some((category) => category.key === "scanner_unavailable") &&
    /(?:invalid_image_format|unsupported (?:image )?format)/i.test(result.error)
  )
}

function uniqueAbsoluteUrls(
  urls: Array<string | null | undefined>,
): string[] {
  return Array.from(new Set(urls.filter(isAbsoluteHttpUrl)))
}

function moderationImageCandidates(input: MediaModerationInput) {
  if (input.assetKind === "video") {
    return uniqueAbsoluteUrls([input.thumbnailUrl ?? input.mediaUrl])
  }

  const displayFormatNeedsFallback = input.contentType.toLowerCase() === "image/avif"

  return displayFormatNeedsFallback
    ? uniqueAbsoluteUrls([input.thumbnailUrl, input.mediaUrl])
    : uniqueAbsoluteUrls([input.mediaUrl, input.thumbnailUrl])
}

function approvedDeferredVideoThumbnailModeration(
  error: string,
): ContentModerationResult {
  return {
    action: "approve",
    provider: "openai",
    reason: null,
    categories: [],
    error,
  }
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

  const scanCandidates = moderationImageCandidates(input)

  if (scanCandidates.length === 0) {
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

  let lastResult: ContentModerationResult | null = null
  let lastResolutionError: string | null = null

  for (const scanUrl of scanCandidates) {
    const reviewableImageUrl = await resolveReviewableImageUrl({
      assetKind: input.assetKind,
      scanUrl,
    })

    if (!reviewableImageUrl.ok) {
      lastResolutionError = reviewableImageUrl.error
      continue
    }

    const result = await moderateReviewableImageUrl(reviewableImageUrl.url)
    lastResult = result

    if (!isUnsupportedOpenAiImageFormatError(result)) {
      return result
    }
  }

  if (lastResult) {
    return lastResult
  }

  return approvedDeferredVideoThumbnailModeration(
    lastResolutionError ?? "Media was not available for safety scanning.",
  )
}
