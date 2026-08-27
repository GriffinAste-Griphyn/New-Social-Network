export const minimumAsyncMediaCompletionBuild = 363

export function areDurableMediaWorkersEnabled() {
  return process.env.MEDIA_ASYNC_COMPLETION_ENABLED !== "false"
}

export function isAsyncMediaCompletionEnabled(clientBuild: number) {
  return (
    Number.isFinite(clientBuild) &&
    clientBuild >= minimumAsyncMediaCompletionBuild &&
    areDurableMediaWorkersEnabled()
  )
}

export function mediaDeliveryAccess(): "private" | "public" {
  return process.env.MEDIA_DELIVERY_ACCESS?.trim().toLowerCase() === "public"
    ? "public"
    : "private"
}

export function isDirectMediaDeliveryEnabled() {
  return mediaDeliveryAccess() === "public"
}
