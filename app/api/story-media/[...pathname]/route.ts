import { get, head } from "@vercel/blob"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { and, or, eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { isAdminSession } from "@/lib/admin-auth"
import { getMobileSession, getSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { stories, storyInteractions } from "@/lib/db/schema"
import {
  createCloudflareStreamPlaybackUrl,
  createCloudflareStreamThumbnailUrl,
  parseCloudflareStreamMediaPathname,
  verifyStoryMediaAccessToken,
} from "@/lib/story-storage"

export const runtime = "nodejs"

const storyUploadDirectory = path.join(process.cwd(), "public", "uploads", "stories")
const localStoryMediaPrefix = "local"
const localStoryUrlPrefix = "/uploads/stories"

function encodeStoryMediaPathname(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function isSafeLocalStoryMediaPathname(pathname: string) {
  const segments = pathname.split("/")

  return (
    segments.length === 2 &&
    segments[0] === localStoryMediaPrefix &&
    Boolean(segments[1]) &&
    segments[1] !== "." &&
    segments[1] !== ".." &&
    !segments[1].includes("/")
  )
}

function isSafeStoryBlobPathname(pathname: string) {
  return (
    pathname.startsWith("stories/") &&
    pathname
      .split("/")
      .every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  )
}

function isSafeStoryMediaPathname(pathname: string) {
  return (
    isSafeLocalStoryMediaPathname(pathname) ||
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

function getLocalStoryMediaFileName(mediaPathname: string) {
  if (!isSafeLocalStoryMediaPathname(mediaPathname)) {
    return null
  }

  return mediaPathname.slice(localStoryMediaPrefix.length + 1)
}

function getLocalStoryMediaContentType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase()

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".webp":
      return "image/webp"
    case ".mp4":
      return "video/mp4"
    case ".webm":
      return "video/webm"
    default:
      return "application/octet-stream"
  }
}

async function getLocalStoryMediaMetadata(mediaPathname: string) {
  const fileName = getLocalStoryMediaFileName(mediaPathname)

  if (!fileName) {
    return null
  }

  try {
    const fileStats = await stat(path.join(storyUploadDirectory, fileName))

    if (!fileStats.isFile()) {
      return null
    }

    return {
      fileName,
      size: fileStats.size,
      contentType: getLocalStoryMediaContentType(fileName),
      etag: `W/"${fileStats.size.toString(16)}-${Math.round(
        fileStats.mtimeMs,
      ).toString(16)}"`,
    }
  } catch {
    return null
  }
}

async function getBlobMetadata(blobPathname: string) {
  try {
    return await head(blobPathname)
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
  const localFileName = getLocalStoryMediaFileName(mediaPathname)
  const localUploadsRoute = localFileName
    ? `${localStoryUrlPrefix}/${localFileName}`
    : null
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
        localUploadsRoute ? eq(stories.mediaUrl, localUploadsRoute) : undefined,
        localUploadsRoute ? eq(stories.thumbnailUrl, localUploadsRoute) : undefined,
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
        localUploadsRoute
          ? eq(storyInteractions.mediaUrl, localUploadsRoute)
          : undefined,
        localUploadsRoute
          ? eq(storyInteractions.mediaThumbnailUrl, localUploadsRoute)
          : undefined,
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

async function serveLocalStoryMedia(request: Request, mediaPathname: string) {
  const metadata = await getLocalStoryMediaMetadata(mediaPathname)

  if (!metadata) {
    return notFound()
  }

  const isVideo = metadata.contentType.startsWith("video/")
  const requestedRange = isVideo ? request.headers.get("range") : null
  const byteRange = parseByteRange(requestedRange, metadata.size)

  if (requestedRange && !byteRange) {
    return rangeNotSatisfiable(metadata.size)
  }

  const headers = new Headers({
    "Cache-Control": "private, no-store",
    ETag: metadata.etag,
    "Content-Type": metadata.contentType,
  })

  if (isVideo) {
    headers.set("Accept-Ranges", "bytes")
  }

  if (byteRange) {
    const contentLength = byteRange.end - byteRange.start + 1

    headers.set("Content-Length", contentLength.toString())
    headers.set(
      "Content-Range",
      `bytes ${byteRange.start}-${byteRange.end}/${metadata.size}`,
    )

    return new Response(
      Readable.toWeb(
        createReadStream(path.join(storyUploadDirectory, metadata.fileName), {
          start: byteRange.start,
          end: byteRange.end,
        }),
      ) as ReadableStream,
      {
        status: 206,
        headers,
      },
    )
  }

  headers.set("Content-Length", metadata.size.toString())

  return new Response(
    Readable.toWeb(
      createReadStream(path.join(storyUploadDirectory, metadata.fileName)),
    ) as ReadableStream,
    {
      headers,
    },
  )
}

export async function GET(
  request: Request,
  context: { params: Promise<{ pathname: string[] }> },
) {
  const { pathname } = await context.params
  const mediaPathname = pathname.join("/")
  const cloudflareStreamMedia = parseCloudflareStreamMediaPathname(mediaPathname)
  const localMediaFileName = getLocalStoryMediaFileName(mediaPathname)

  if (!isSafeStoryMediaPathname(mediaPathname)) {
    return notFound()
  }

  if (!(await canServeStoryMedia(request, mediaPathname))) {
    return notFound()
  }

  if (cloudflareStreamMedia) {
    const remoteUrl =
      cloudflareStreamMedia.kind === "thumbnail"
        ? await createCloudflareStreamThumbnailUrl(cloudflareStreamMedia.uid)
        : await createCloudflareStreamPlaybackUrl(cloudflareStreamMedia.uid)
    const response = NextResponse.redirect(remoteUrl, { status: 302 })

    response.headers.set("Cache-Control", "private, no-store")

    return response
  }

  if (localMediaFileName) {
    return serveLocalStoryMedia(request, mediaPathname)
  }

  const blobPathname = mediaPathname

  const blobMetadata = await getBlobMetadata(blobPathname)

  if (!blobMetadata) {
    return notFound()
  }

  const isVideo = blobMetadata.contentType.startsWith("video/")
  const requestedRange = isVideo ? request.headers.get("range") : null
  const byteRange = parseByteRange(requestedRange, blobMetadata.size)

  if (requestedRange && !byteRange) {
    return rangeNotSatisfiable(blobMetadata.size)
  }

  const result = await get(blobPathname, {
    access: "private",
    ifNoneMatch: byteRange
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
    "Cache-Control": "private, no-store",
    ETag: result.blob.etag || blobMetadata.etag,
  })

  if (result.statusCode === 304) {
    return new Response(null, {
      status: 304,
      headers,
    })
  }

  headers.set("Content-Type", result.blob.contentType ?? blobMetadata.contentType)

  if (isVideo) {
    headers.set("Accept-Ranges", "bytes")
  }

  if (byteRange) {
    const contentLength = byteRange.end - byteRange.start + 1
    const contentRange =
      result.headers.get("content-range") ??
      `bytes ${byteRange.start}-${byteRange.end}/${blobMetadata.size}`

    headers.set("Content-Length", contentLength.toString())
    headers.set("Content-Range", contentRange)

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
