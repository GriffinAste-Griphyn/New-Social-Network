import {
  resultFromSignals,
  type ContentModerationResult,
  type ModerationCategorySignal,
  type SafetyCategory,
} from "@/lib/safety/policy"

type OpenAIModerationResult = {
  flagged?: boolean
  categories?: Record<string, boolean>
  category_scores?: Record<string, number>
  category_applied_input_types?: Record<string, string[]>
}

type OpenAIModerationResponse = {
  id?: string
  model?: string
  results?: OpenAIModerationResult[]
}

type OpenAIModerationInput =
  | string
  | Array<
      | {
          type: "text"
          text: string
        }
      | {
          type: "image_url"
          image_url: {
            url: string
          }
        }
    >

const openAiModerationModel =
  process.env.OPENAI_MODERATION_MODEL ?? "omni-moderation-latest"

const categoryMap: Record<string, SafetyCategory> = {
  "sexual": "sexual_content",
  "sexual/minors": "minor_safety",
  "harassment": "harassment",
  "harassment/threatening": "harassment",
  "hate": "hate",
  "hate/threatening": "hate",
  "illicit": "illegal_goods",
  "illicit/violent": "illegal_goods",
  "self-harm": "self_harm",
  "self-harm/intent": "self_harm",
  "self-harm/instructions": "self_harm",
  "violence": "violence",
  "violence/graphic": "graphic_violence",
}

function isPlainHarassment(category: string) {
  return category === "harassment"
}

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || null
}

function openAiSignalReason(category: string, inputTypes: string[]) {
  const inputLabel = inputTypes.length > 0 ? ` in ${inputTypes.join(" and ")}` : ""

  return `OpenAI moderation flagged ${category}${inputLabel}.`
}

function mapOpenAiResult(result: OpenAIModerationResult) {
  return Object.entries(result.categories ?? {}).flatMap<ModerationCategorySignal>(
    ([category, flagged]) => {
      if (!flagged) {
        return []
      }

      if (isPlainHarassment(category)) {
        return []
      }

      const key = categoryMap[category] ?? "other"
      const inputTypes = result.category_applied_input_types?.[category] ?? []

      return [
        {
          key,
          confidence: result.category_scores?.[category] ?? 1,
          reason: openAiSignalReason(category, inputTypes),
          source: "openai",
        },
      ]
    },
  )
}

export function canUseOpenAiModeration() {
  return Boolean(getOpenAiApiKey())
}

export async function moderateWithOpenAi(
  input: OpenAIModerationInput,
): Promise<ContentModerationResult> {
  const apiKey = getOpenAiApiKey()

  if (!apiKey) {
    return resultFromSignals({
      provider: "openai",
      signals: [
        {
          key: "scanner_unavailable",
          confidence: 1,
          reason: "OpenAI moderation is configured but OPENAI_API_KEY is missing.",
          source: "system",
        },
      ],
      error: "OPENAI_API_KEY is missing.",
    })
  }

  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: openAiModerationModel,
        input,
      }),
      signal: AbortSignal.timeout(8_000),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")

      throw new Error(
        body
          ? `OpenAI moderation failed with ${response.status}: ${body.slice(0, 300)}`
          : `OpenAI moderation failed with ${response.status}.`,
      )
    }

    const payload = (await response.json()) as OpenAIModerationResponse
    const signals = (payload.results ?? []).flatMap(mapOpenAiResult)

    return resultFromSignals({
      provider: "openai",
      signals,
      rawResult: payload,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OpenAI moderation failed."

    return resultFromSignals({
      provider: "openai",
      signals: [
        {
          key: "scanner_unavailable",
          confidence: 1,
          reason: "Moderation scanner was unavailable; content requires review.",
          source: "system",
        },
      ],
      error: message,
    })
  }
}
