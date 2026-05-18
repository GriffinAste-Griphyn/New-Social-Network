import { createHmac, timingSafeEqual } from "node:crypto"

import { env } from "@/lib/env"

export const storyMediaRoutePrefix = "/api/story-media"
export const localStoryUrlPrefix = "/uploads/stories"
export const localStoryMediaPrefix = "local"
export const cloudflareStreamMediaPrefix = "cloudflare-stream"
export const storyMediaAccessTokenTtlMs = 60 * 60 * 1000

const storyMediaAccessTokenBucketMs = 30 * 60 * 1000

export function withConfiguredPublicBaseUrl(mediaUrl: string) {
  const baseUrl = process.env.STORY_STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "")

  if (!baseUrl || /^https?:\/\//i.test(mediaUrl)) {
    return mediaUrl
  }

  return `${baseUrl}${mediaUrl}`
}

function getPublicRequestUrl(request: Request) {
  const requestUrl = new URL(request.url)
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim()
  const host = forwardedHost || request.headers.get("host")

  if (forwardedProto) {
    requestUrl.protocol = forwardedProto.endsWith(":")
      ? forwardedProto
      : `${forwardedProto}:`
  }

  if (host) {
    requestUrl.host = host
  }

  return requestUrl
}

function encodeStoryMediaPathname(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

export function getPrivateVercelBlobPathname(mediaUrl: string) {
  if (mediaUrl.startsWith(`${storyMediaRoutePrefix}/`)) {
    const pathname = mediaUrl
      .slice(storyMediaRoutePrefix.length + 1)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")

    return pathname.startsWith("stories/") ? pathname : null
  }

  if (!/^https?:\/\//i.test(mediaUrl)) {
    return null
  }

  try {
    const url = new URL(mediaUrl)

    if (!url.hostname.endsWith(".private.blob.vercel-storage.com")) {
      return null
    }

    return decodeURIComponent(url.pathname.replace(/^\/+/, ""))
  } catch {
    return null
  }
}

export function isVercelBlobUrl(mediaUrl: string) {
  if (!/^https?:\/\//i.test(mediaUrl)) {
    return false
  }

  try {
    return new URL(mediaUrl).hostname.endsWith(".blob.vercel-storage.com")
  } catch {
    return false
  }
}

export function buildStoryMediaRoute(pathname: string) {
  return `${storyMediaRoutePrefix}/${encodeStoryMediaPathname(pathname)}`
}

export function buildLocalStoryMediaPathname(fileName: string) {
  return `${localStoryMediaPrefix}/${fileName}`
}

export function getLocalStoryMediaPathname(mediaUrl: string) {
  const baseUrl = process.env.STORY_STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "")
  const normalizedUrl =
    baseUrl && mediaUrl.startsWith(baseUrl)
      ? mediaUrl.slice(baseUrl.length)
      : mediaUrl

  if (normalizedUrl.startsWith(`${storyMediaRoutePrefix}/${localStoryMediaPrefix}/`)) {
    return normalizedUrl
      .slice(storyMediaRoutePrefix.length + 1)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")
  }

  if (normalizedUrl.startsWith(`${localStoryUrlPrefix}/`)) {
    const fileName = normalizedUrl.slice(localStoryUrlPrefix.length + 1)

    return buildLocalStoryMediaPathname(fileName)
  }

  return null
}

export function buildCloudflareStreamPathname(uid: string) {
  return `${cloudflareStreamMediaPrefix}/${uid}/manifest/video.m3u8`
}

export function buildCloudflareStreamThumbnailPathname(uid: string) {
  return `${cloudflareStreamMediaPrefix}/${uid}/thumbnails/thumbnail.jpg`
}

function parseCloudflareStreamUid(mediaUrl: string) {
  const match = mediaUrl.match(
    /\/([a-f0-9]{32})\/(?:manifest\/video\.m3u8|thumbnails\/thumbnail\.jpg)/i,
  )

  return match?.[1] ?? null
}

export function getCloudflareStreamPathname(mediaUrl: string) {
  if (mediaUrl.startsWith(`${storyMediaRoutePrefix}/${cloudflareStreamMediaPrefix}/`)) {
    return mediaUrl.slice(storyMediaRoutePrefix.length + 1)
  }

  const uid = parseCloudflareStreamUid(mediaUrl)

  return uid ? buildCloudflareStreamPathname(uid) : null
}

function signStoryMediaPathname(pathname: string, expiresAtMs: number) {
  return createHmac("sha256", env.AUTH_SECRET)
    .update(`${pathname}:${expiresAtMs}`)
    .digest("base64url")
}

export function createStoryMediaAccessToken(pathname: string) {
  const stableIssuedAtMs =
    Math.floor(Date.now() / storyMediaAccessTokenBucketMs) *
    storyMediaAccessTokenBucketMs
  const expiresAtMs = stableIssuedAtMs + storyMediaAccessTokenTtlMs
  const signature = signStoryMediaPathname(pathname, expiresAtMs)

  return `${expiresAtMs}.${signature}`
}

export function verifyStoryMediaAccessToken(pathname: string, token: string | null) {
  if (!token) {
    return false
  }

  const [expiresAtValue, signature] = token.split(".")
  const expiresAtMs = Number(expiresAtValue)

  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || !signature) {
    return false
  }

  const expected = signStoryMediaPathname(pathname, expiresAtMs)
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  return (
    signatureBuffer.length === expectedBuffer.length &&
    timingSafeEqual(signatureBuffer, expectedBuffer)
  )
}

export function publicStoryMediaUrl(
  value: string | null,
  request?: Request,
  options: { signed?: boolean } = {},
) {
  if (!value) {
    return null
  }

  const blobPathname = getPrivateVercelBlobPathname(value)
  const localStoryMediaPathname = getLocalStoryMediaPathname(value)
  const cloudflareStreamPathname = getCloudflareStreamPathname(value)
  const mediaPathname =
    blobPathname ?? localStoryMediaPathname ?? cloudflareStreamPathname
  const mediaUrl = mediaPathname ? buildStoryMediaRoute(mediaPathname) : value

  if (!request) {
    return mediaUrl
  }

  const requestUrl = getPublicRequestUrl(request)
  const url = new URL(mediaUrl, requestUrl)

  if (
    /^https?:\/\//i.test(mediaUrl) &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  ) {
    return mediaUrl
  }

  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.protocol = requestUrl.protocol
    url.hostname = requestUrl.hostname
    url.port = requestUrl.port
  }

  if (options.signed && mediaPathname) {
    url.searchParams.set("token", createStoryMediaAccessToken(mediaPathname))
  }

  return url.toString()
}
