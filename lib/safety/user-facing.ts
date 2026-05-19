export function userFacingModerationReason(input: {
  moderationStatus?: string | null
  moderationReason?: string | null
}) {
  switch (input.moderationStatus) {
    case "approved":
      return null
    case "rejected":
    case "removed":
      return "This story could not be posted because it may violate community guidelines."
    case "flagged":
      return "This story needs a safety review before it can go live."
    default:
      return input.moderationReason
        ? "This story needs a safety review before it can go live."
        : null
  }
}
