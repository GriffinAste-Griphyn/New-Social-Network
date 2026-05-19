export type ContentModerationAction = "approve" | "hold" | "reject"

export type SafetyCategory =
  | "sexual_content"
  | "minor_safety"
  | "graphic_violence"
  | "weapons"
  | "self_harm"
  | "hate"
  | "harassment"
  | "violence"
  | "illegal_goods"
  | "spam"
  | "fraud"
  | "impersonation"
  | "intellectual_property"
  | "suspicious_link"
  | "scanner_unavailable"
  | "unsupported_media"
  | "other"

export type ModerationCategorySignal = {
  key: SafetyCategory
  confidence: number
  reason: string
  source: "local_text" | "local_link" | "local_media" | "openai" | "system"
}

export type ContentModerationResult = {
  action: ContentModerationAction
  provider: string
  reason: string | null
  categories: ModerationCategorySignal[]
  rawResult?: unknown
  error?: string | null
}

export const approvedModerationResult: ContentModerationResult = {
  action: "approve",
  provider: "local",
  reason: null,
  categories: [],
}

const rejectCategories = new Set<SafetyCategory>([
  "minor_safety",
  "graphic_violence",
])

const holdCategories = new Set<SafetyCategory>([
  "sexual_content",
  "weapons",
  "self_harm",
  "hate",
  "harassment",
  "violence",
  "illegal_goods",
  "spam",
  "fraud",
  "impersonation",
  "intellectual_property",
  "suspicious_link",
  "scanner_unavailable",
  "unsupported_media",
  "other",
])

export function actionForSignals(
  signals: ModerationCategorySignal[],
): ContentModerationAction {
  if (signals.some((signal) => rejectCategories.has(signal.key))) {
    return "reject"
  }

  if (signals.some((signal) => holdCategories.has(signal.key))) {
    return "hold"
  }

  return "approve"
}

export function summarizeSignals(signals: ModerationCategorySignal[]) {
  const highestConfidence = [...signals].sort(
    (left, right) => right.confidence - left.confidence,
  )[0]

  return highestConfidence?.reason ?? null
}

export function resultFromSignals(input: {
  provider: string
  signals: ModerationCategorySignal[]
  rawResult?: unknown
  error?: string | null
}): ContentModerationResult {
  const action = actionForSignals(input.signals)

  return {
    action,
    provider: input.provider,
    reason: action === "approve" ? null : summarizeSignals(input.signals),
    categories: input.signals,
    rawResult: input.rawResult,
    error: input.error ?? null,
  }
}

export function mergeModerationResults(
  results: ContentModerationResult[],
): ContentModerationResult {
  const orderedActions: ContentModerationAction[] = ["approve", "hold", "reject"]
  const action = results.reduce<ContentModerationAction>((current, result) => {
    return orderedActions.indexOf(result.action) > orderedActions.indexOf(current)
      ? result.action
      : current
  }, "approve")
  const categories = results.flatMap((result) => result.categories)
  const reason =
    action === "approve"
      ? null
      : summarizeSignals(categories) ??
        results.find((result) => result.reason)?.reason ??
        "Content requires safety review."
  const provider = [...new Set(results.map((result) => result.provider))].join("+")
  const error = results.find((result) => result.error)?.error ?? null

  return {
    action,
    provider: provider || "local",
    reason,
    categories,
    rawResult: results.map((result) => result.rawResult).filter(Boolean),
    error,
  }
}
