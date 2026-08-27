import { get, head } from "@vercel/blob"
import { and, or, eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { isAdminSession } from "@/lib/admin-auth"
import { getMobileSession, getSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { stories, storyInteractions } from "@/lib/db/schema"
import { forwardCloudflarePlaybackOptions } from "@/lib/story-media/access"
import {
  getStoryMediaCacheControl,
  getStoryMediaCdnCacheControl,
} from "@/lib/story-media/cache-control"
import {
  createCloudflareStreamPlaybackUrl,
  createCloudflareStreamThumbnailUrl,
  parseCloudflareStreamMediaPathname,
  verifyStoryMediaAccessToken,
} from "@/lib/story-storage"
import { rewriteHlsPlaylistForStoryMedia } from "@/lib/story-media/hls"

export const runtime = "nodejs"

function encodeStoryMediaPathname(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function isSafeStoryBlobPathname(pathname: string) {
  return (
    (pathname.startsWith("stories/") ||
      pathname.startsWith("media-originals/") ||
      pathname.startsWith("media/")) &&
    pathname
      .split("/")
      .every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  )
}

function isSafeStoryMediaPathname(pathname: string) {
  return (
    isSafeStoryBlobPathname(pathname) ||
    Boolean(parseCloudflareStreamMediaPathname(pathname))
  )
}

function notFound() {
  return NextResponse.json({ error: "Story media not found." }, { status: 404 })
}

type ByteRange = {
  start: number
  end: number
}

function parseByteRange(rangeHeader: string | null, size: number): ByteRange | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=") || size <= 0) {
    return null
  }

  const rangeValue = rangeHeader.slice("bytes=".length)

  if (rangeValue.includes(",")) {
    return null
  }

  const rangeParts = rangeValue.split("-")

  if (rangeParts.length !== 2) {
    return null
  }

  const [startValue, endValue] = rangeParts

  if (startValue === "") {
    if (!endValue) {
      return null
    }

    const suffixLength = Number(endValue)

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null
    }

    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    }
  }

  const start = Number(startValue)
  const end = endValue ? Number(endValue) : size - 1

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null
  }

  return {
    start,
    end: Math.min(end, size - 1),
  }
}

function rangeNotSatisfiable(size: number) {
  return new Response(null, {
    status: 416,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Range": `bytes */${size}`,
    },
  })
}

function blobToken(blobPathname: string) {
  return blobPathname.startsWith("media/")
    ? process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN
    : process.env.BLOB_READ_WRITE_TOKEN
}

async function getBlobMetadata(blobPathname: string) {
  try {
    return await head(blobPathname, { token: blobToken(blobPathname) })
  } catch (error) {
    if (error instanceof Error && error.name === "BlobNotFoundError") {
      return null
    }

    throw error
  }
}

async function getStoryForMediaPathname(mediaPathname: string) {
  const encodedRoute = `/api/story-media/${encodeStoryMediaPathname(mediaPathname)}`
  const decodedRoute = `/api/story-media/${mediaPathname}`
  const cloudflareStreamMedia = parseCloudflareStreamMediaPathname(mediaPathname)

  const [story] = await getDb()
    .select({
      creatorId: stories.creatorId,
      expiresAt: stories.expiresAt,
      moderationStatus: stories.moderationStatus,
      status: stories.status,
    })
    .from(stories)
    .where(
      or(
        eq(stories.storageKey, mediaPathname),
        eq(stories.originalStorageKey, mediaPathname),
        cloudflareStreamMedia
          ? and(
              eq(stories.storageProvider, "cloudflare-stream"),
              eq(stories.storageKey, cloudflareStreamMedia.uid),
            )
          : undefined,
        eq(stories.mediaUrl, encodedRoute),
        eq(stories.thumbnailUrl, encodedRoute),
        eq(stories.mediaUrl, decodedRoute),
        eq(stories.thumbnailUrl, decodedRoute),
        eq(stories.originalMediaUrl, encodedRoute),
        eq(stories.originalMediaUrl, decodedRoute),
      ),
    )
    .limit(1)

  if (story) {
    return story
  }

  const [interactionStory] = await getDb()
    .select({
      creatorId: stories.creatorId,
      expiresAt: stories.expiresAt,
      moderationStatus: stories.moderationStatus,
      status: stories.status,
    })
    .from(storyInteractions)
    .innerJoin(stories, eq(stories.id, storyInteractions.storyId))
    .where(
      or(
        eq(storyInteractions.mediaUrl, encodedRoute),
        eq(storyInteractions.mediaThumbnailUrl, encodedRoute),
        eq(storyInteractions.mediaUrl, decodedRoute),
        eq(storyInteractions.mediaThumbnailUrl, decodedRoute),
      ),
    )
    .limit(1)

  return interactionStory ?? null
}

async function canServeStoryMedia(request: Request, mediaPathname: string) {
  const token = new URL(request.url).searchParams.get("token")
  const hasValidToken = verifyStoryMediaAccessToken(mediaPathname, token)

  if (hasValidToken) {
    return true
  }

  const story = await getStoryForMediaPathname(mediaPathname)

  if (!story) {
    return false
  }

  const session = (await getMobileSession(request)) ?? (await getSession())
  const isOwner = session?.id === story.creatorId
  const isAdmin = session ? isAdminSession(session) : false
  const isLive =
    story.status === "live" &&
    story.moderationStatus === "approved" &&
    story.expiresAt.getTime() > Date.now()

  return (
    Boolean(session && (isAdmin || isLive || isOwner))
  )
}

export async function GET(
  request: Request,
  context: { params: Promise<{ pathname: string[] }> },
) {
  const { pathname } = await context.params
  const mediaPathname = pathname.join("/")
  const cloudflareStreamMedia = parseCloudflareStreamMediaPathname(mediaPathname)
  if (!isSafeStoryMediaPathname(mediaPathname)) {
    return notFound()
  }

  if (!(await canServeStoryMedia(request, mediaPathname))) {
    return notFound()
  }

  if (cloudflareStreamMedia) {
    const baseRemoteUrl =
      cloudflareStreamMedia.kind === "thumbnail"
        ? await createCloudflareStreamThumbnailUrl(cloudflareStreamMedia.uid)
        : await createCloudflareStreamPlaybackUrl(cloudflareStreamMedia.uid)
    const remoteUrl =
      cloudflareStreamMedia.kind === "playback"
        ? forwardCloudflarePlaybackOptions(baseRemoteUrl, request.url)
        : baseRemoteUrl
    const response = NextResponse.redirect(remoteUrl, { status: 302 })
    const isPlaybackManifest = cloudflareStreamMedia.kind === "playback"

    // Stream manifests are dynamic and the redirect target contains an expiring
    // playback credential. Always mint a current redirect instead of allowing an
    // edge or browser cache to strand viewers on an expired manifest URL.
    response.headers.set(
      "Cache-Control",
      isPlaybackManifest
        ? "private, no-store"
        : getStoryMediaCacheControl(request, mediaPathname),
    )
    response.headers.set(
      "CDN-Cache-Control",
      isPlaybackManifest
        ? "no-store"
        : getStoryMediaCdnCacheControl(request, mediaPathname),
    )

    return response
  }

  const blobPathname = mediaPathname
  const blobMetadata = await getBlobMetadata(blobPathname)

  if (!blobMetadata) {
    return notFound()
  }

  const isVideo = blobMetadata.contentType.startsWith("video/")
  const isHlsPlaylist = blobPathname.endsWith(".m3u8")
  const requestedRange = isVideo ? request.headers.get("range") : null
  const byteRange = parseByteRange(requestedRange, blobMetadata.size)

  if (requestedRange && !byteRange) {
    return rangeNotSatisfiable(blobMetadata.size)
  }

  const result = await get(blobPathname, {
    access: "private",
    token: blobToken(blobPathname),
    ifNoneMatch: byteRange || isHlsPlaylist
      ? undefined
      : request.headers.get("if-none-match") ?? undefined,
    headers: byteRange
      ? {
          Range: `bytes=${byteRange.start}-${byteRange.end}`,
        }
      : undefined,
  })

  if (!result) {
    return notFound()
  }

  const headers = new Headers({
    "Cache-Control": getStoryMediaCacheControl(request, mediaPathname),
    "CDN-Cache-Control": getStoryMediaCdnCacheControl(request, mediaPathname),
    ETag: result.blob.etag || blobMetadata.etag,
    "X-Content-Type-Options": "nosniff",
  })
  if (result.statusCode === 304) {
    return new Response(null, {
      status: 304,
      headers,
    })
  }

  headers.set("Content-Type", result.blob.contentType ?? blobMetadata.contentType)

  if (isHlsPlaylist && result.statusCode === 200 && result.stream) {
    const playlist = rewriteHlsPlaylistForStoryMedia(
      await new Response(result.stream).text(),
      blobPathname,
    )
    const body = Buffer.from(playlist, "utf8")
    const isMaster = blobPathname.endsWith("/master.m3u8")
    headers.delete("ETag")
    headers.set(
      "Cache-Control",
      isMaster ? "private, max-age=0, must-revalidate" : "private, max-age=3600",
    )
    headers.set(
      "CDN-Cache-Control",
      isMaster
        ? "public, max-age=0, s-maxage=10, stale-while-revalidate=30, must-revalidate"
        : getStoryMediaCdnCacheControl(request, mediaPathname),
    )
    headers.set("Content-Length", body.byteLength.toString())
    return new Response(body, { headers })
  }

  if (isVideo) {
    headers.set("Accept-Ranges", "bytes")
  }

  if (byteRange) {
    const upstreamContentRange = result.headers.get("content-range")
    const upstreamContentLength = result.headers.get("content-length")

    if (!upstreamContentRange) {
      headers.set(
        "Content-Length",
        upstreamContentLength ?? blobMetadata.size.toString(),
      )

      return new Response(result.stream, {
        headers,
      })
    }

    headers.set(
      "Content-Length",
      upstreamContentLength ?? (byteRange.end - byteRange.start + 1).toString(),
    )
    headers.set("Content-Range", upstreamContentRange)

    return new Response(result.stream, {
      status: 206,
      headers,
    })
  }

  headers.set("Content-Length", blobMetadata.size.toString())

  return new Response(result.stream, {
    headers,
  })
}
