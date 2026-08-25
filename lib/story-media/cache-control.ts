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

  return `public, max-age=0, s-maxage=${sharedMaxAgeSeconds}, must-revalidate`
}
