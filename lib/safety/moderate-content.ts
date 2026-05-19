import { moderateMediaContent } from "@/lib/safety/media-moderation"
import { moderateTextLocally } from "@/lib/safety/text-moderation"
import { moderateWithOpenAi } from "@/lib/safety/openai-moderation"
import {
  approvedModerationResult,
  mergeModerationResults,
  type ContentModerationResult,
} from "@/lib/safety/policy"

type ModeratableMedia = {
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

function shouldRunOpenAiTextModeration() {
  return contentModerationProvider() === "openai" && Boolean(process.env.OPENAI_API_KEY)
}

function hasModeratableText(textParts: Array<string | null | undefined>) {
  return textParts.some((part) => Boolean(part?.trim()))
}

export async function moderateUserContent(input: {
  textParts: Array<string | null | undefined>
  linkUrls?: Array<string | null | undefined>
  media?: ModeratableMedia | null
}): Promise<ContentModerationResult> {
  const results: ContentModerationResult[] = [
    moderateTextLocally({
      textParts: input.textParts,
      linkUrls: input.linkUrls,
    }),
  ]
  const providerResults: Array<Promise<ContentModerationResult>> = []

  if (shouldRunOpenAiTextModeration() && hasModeratableText(input.textParts)) {
    providerResults.push(moderateWithOpenAi(input.textParts.filter(Boolean).join("\n")))
  }

  if (input.media) {
    providerResults.push(moderateMediaContent(input.media))
  }

  if (providerResults.length > 0) {
    results.push(...(await Promise.all(providerResults)))
  }

  const actionableResults = results.length > 0 ? results : [approvedModerationResult]

  return mergeModerationResults(actionableResults)
}
