import { createHash } from "node:crypto"
import { get, head } from "@vercel/blob"
import { NextResponse } from "next/server"

import { readCloudflareR2Original } from "@/lib/cloudflare-r2"
import {
  blobMediaUnavailableResponse,
  isVercelBlobAccessDisabled,
} from "@/lib/media-availability"

export const runtime = "nodejs"

function isSafeAvatarBlobPathname(pathname: string) {
  return (
    pathname.startsWith("avatars/") &&
    pathname
      .split("/")
      .every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  )
}

function notFound() {
  return NextResponse.json({ error: "Profile photo not found." }, { status: 404 })
}

function isBlobNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "BlobNotFoundError" ||
      error.message.toLowerCase().includes("requested blob does not exist"))
  )
}

function isR2NotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      ("$metadata" in error &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404))
  )
}

async function cloudflareR2AvatarSourceResponse(
  request: Request,
  pathname: string[],
) {
  const key = pathname.join("/")
  if (!isSafeAvatarBlobPathname(key) || !key.startsWith("avatars/source/")) {
    return notFound()
  }

  let body: Buffer
  try {
    body = await readCloudflareR2Original(key)
  } catch (error) {
    if (isR2NotFoundError(error)) {
      return notFound()
    }
    throw error
  }

  const etag = `"${createHash("sha256").update(body).digest("hex")}"`
  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": "image/jpeg",
    "Content-Length": body.byteLength.toString(),
    ETag: etag,
  })

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers })
  }

  return new Response(new Uint8Array(body), { headers })
}

async function getBlobMetadata(blobPathname: string) {
  try {
    return await head(blobPathname)
  } catch (error) {
    if (isBlobNotFoundError(error)) {
      return null
    }

    throw error
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ pathname: string[] }> },
) {
  const { pathname } = await context.params

  if (pathname[0] === "cloudflare-r2") {
    return cloudflareR2AvatarSourceResponse(request, pathname.slice(1))
  }

  const blobPathname = pathname.join("/")

  if (!isSafeAvatarBlobPathname(blobPathname)) {
    return notFound()
  }

  if (isVercelBlobAccessDisabled()) {
    return blobMediaUnavailableResponse("This profile photo is temporarily unavailable.")
  }

  const blobMetadata = await getBlobMetadata(blobPathname)

  if (!blobMetadata) {
    return notFound()
  }

  let result

  try {
    result = await get(blobPathname, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    })
  } catch (error) {
    if (isBlobNotFoundError(error)) {
      return notFound()
    }

    throw error
  }

  if (!result) {
    return notFound()
  }

  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: result.blob.etag || blobMetadata.etag,
  })

  if (result.statusCode === 304) {
    return new Response(null, {
      status: 304,
      headers,
    })
  }

  headers.set("Content-Type", result.blob.contentType ?? blobMetadata.contentType)
  headers.set("Content-Length", blobMetadata.size.toString())

  return new Response(result.stream, {
    headers,
  })
}
