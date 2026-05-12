import { get, head } from "@vercel/blob"
import { NextResponse } from "next/server"

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
  const blobPathname = pathname.join("/")

  if (!isSafeAvatarBlobPathname(blobPathname)) {
    return notFound()
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
