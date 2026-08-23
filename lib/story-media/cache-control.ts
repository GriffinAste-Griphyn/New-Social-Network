import { getStoryMediaAccessTokenMaxAgeSeconds } from "@/lib/story-storage"

export function getStoryMediaCacheControl(
  request: Request,
  mediaPathname: string,
) {
  const token = new URL(request.url).searchParams.get("token")
  const signedMaxAgeSeconds = getStoryMediaAccessTokenMaxAgeSeconds(
    mediaPathname,
    token,
  )

  if (signedMaxAgeSeconds > 0) {
    return `private, max-age=${signedMaxAgeSeconds}`
  }

  return "private, no-store"
}
