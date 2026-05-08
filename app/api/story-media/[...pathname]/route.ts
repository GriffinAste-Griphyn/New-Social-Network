import { get, head } from "@vercel/blob"
import { or, eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getMobileSession, getSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { stories, storyInteractions } from "@/lib/db/schema"
import { verifyStoryMediaAccessToken } from "@/lib/story-storage"

export const runtime = "nodejs"

function encodeStoryMediaPathname(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function isSafeStoryBlobPathname(pathname: string) {
  return (
    pathname.startsWith("stories/") &&
    pathname
      .split("/")
      .every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
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

async function getStoryForBlobPathname(blobPathname: string) {
  const encodedRoute = `/api/story-media/${encodeStoryMediaPathname(blobPathname)}`
  const decodedRoute = `/api/story-media/${blobPathname}`

  const [story] = await getDb()
    .select({
      creatorId: stories.creatorId,
      expiresAt: stories.expiresAt,
      status: stories.status,
    })
    .from(stories)
    .where(
      or(
        eq(stories.storageKey, blobPathname),
        eq(stories.mediaUrl, encodedRoute),
        eq(stories.thumbnailUrl, encodedRoute),
        eq(stories.mediaUrl, decodedRoute),
        eq(stories.thumbnailUrl, decodedRoute),
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

async function canServeStoryMedia(request: Request, blobPathname: string) {
  const story = await getStoryForBlobPathname(blobPathname)

  if (!story) {
    return false
  }

  const token = new URL(request.url).searchParams.get("token")
  const hasValidToken = verifyStoryMediaAccessToken(blobPathname, token)
  const session = hasValidToken
    ? null
    : (await getMobileSession(request)) ?? (await getSession())
  const isOwner = session?.id === story.creatorId
  const isLive = story.status === "live" && story.expiresAt.getTime() > Date.now()

  return (hasValidToken && isLive) || Boolean(session && (isLive || isOwner))
}

export async function GET(
  request: Request,
  context: { params: Promise<{ pathname: string[] }> },
) {
  const { pathname } = await context.params
  const blobPathname = pathname.join("/")

  if (!isSafeStoryBlobPathname(blobPathname)) {
    return notFound()
  }

  if (!(await canServeStoryMedia(request, blobPathname))) {
    return notFound()
  }

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
