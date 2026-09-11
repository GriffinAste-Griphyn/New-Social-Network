export const retryableStoryModerationReasons = [
  "Media moderation requires an absolute reviewable media URL.",
  "Moderation scanner was unavailable; content requires review.",
  "OpenAI moderation is configured but OPENAI_API_KEY is missing.",
  "Production media moderation provider is not configured; content requires review.",
] as const

const retryableReasonSet = new Set<string>(retryableStoryModerationReasons)

export function isRetryableStoryModeration(input: {
  moderationStatus: string | null | undefined
  moderationReason: string | null | undefined
}) {
  if (input.moderationStatus === "pending") return true

  return (
    input.moderationStatus === "flagged" &&
    Boolean(input.moderationReason && retryableReasonSet.has(input.moderationReason))
  )
}
