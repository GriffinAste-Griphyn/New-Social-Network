const VERCEL_BLOB_HOST_SUFFIX = ".blob.vercel-storage.com"

export const BLOB_MEDIA_UNAVAILABLE_CODE = "vercel_blob_temporarily_unavailable"
export const BLOB_MEDIA_UNAVAILABLE_MESSAGE =
  "Photo uploads are temporarily unavailable while media service access recovers. Video stories still work."
export function isVercelBlobAccessDisabled() {
  return process.env.VERCEL_BLOB_SUSPENDED_MODE?.trim().toLowerCase() === "true"
}

export function isVercelBlobMediaReference(value: string | null | undefined) {
  if (!value) {
    return false
  }

  if (value.startsWith("/api/story-media/cloudflare-stream/")) {
    return false
  }

  if (
    value.startsWith("/api/story-media/") ||
    value.startsWith("/api/profile-avatar-media/")
  ) {
    return true
  }

  try {
    const url = new URL(value)
    return url.hostname.endsWith(VERCEL_BLOB_HOST_SUFFIX)
  } catch {
    return false
  }
}

export function blobMediaUnavailableResponse(message = BLOB_MEDIA_UNAVAILABLE_MESSAGE) {
  return Response.json(
    {
      error: message,
      code: BLOB_MEDIA_UNAVAILABLE_CODE,
      retryable: true,
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": "3600",
      },
    },
  )
}
