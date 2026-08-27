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
    const immutable =
      mediaPathname.startsWith("media/") && !mediaPathname.endsWith(".m3u8")
        ? ", immutable"
        : ""
    return `private, max-age=${signedMaxAgeSeconds}${immutable}`
  }

  return "private, no-store"
}

export function getStoryMediaCdnCacheControl(
  request: Request,
  mediaPathname: string,
  options: { expirationSkewSeconds?: number } = {},
) {
  const token = new URL(request.url).searchParams.get("token")
  const signedMaxAgeSeconds = getStoryMediaAccessTokenMaxAgeSeconds(
    mediaPathname,
    token,
  )
  const expirationSkewSeconds = Math.max(
    0,
    Math.floor(options.expirationSkewSeconds ?? 60),
  )
  const sharedMaxAgeSeconds = signedMaxAgeSeconds - expirationSkewSeconds

  if (sharedMaxAgeSeconds <= 0) {
    return "no-store"
  }

  return `public, max-age=0, s-maxage=${sharedMaxAgeSeconds}, stale-while-revalidate=60, must-revalidate`
}
