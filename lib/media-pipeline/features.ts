export const minimumAsyncMediaCompletionBuild = 363
export const minimumVercelHlsUploadBuild = 353

export function supportsVercelHlsUpload(
  clientBuild: number,
  pipelineHeader: string | null,
) {
  const match = pipelineHeader?.trim().toLowerCase().match(/^hls-v(\d+)$/)
  const pipelineVersion = match ? Number.parseInt(match[1], 10) : Number.NaN

  return (
    Number.isFinite(clientBuild) &&
    clientBuild >= minimumVercelHlsUploadBuild &&
    Number.isFinite(pipelineVersion) &&
    pipelineVersion >= 2
  )
}

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
