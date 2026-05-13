export function formatStoryPostedAt(createdAt: Date) {
  const ageMinutes = Math.max(
    0,
    Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60)),
  )

  if (ageMinutes < 1) {
    return "Now"
  }

  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`
  }

  const ageHours = Math.floor(ageMinutes / 60)

  if (ageHours < 24) {
    return `${ageHours}h ago`
  }

  return createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}
