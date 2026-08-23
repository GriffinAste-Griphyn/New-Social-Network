import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  directStoryImageDisplayPathname,
  directStoryImagePathname,
  directStoryImageThumbnailPathname,
  isAllowedDirectStoryImageContentType,
  maxStoryImageDisplayDerivativeBytes,
  maxStoryImageThumbnailDerivativeBytes,
  maxStoryImageUploadBytes,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const imageUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180).default("story-photo.jpg"),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive().max(maxStoryImageUploadBytes),
  displayContentType: z.enum(["image/avif", "image/webp"]),
})

const minimumDerivativeOnlyBuild = 285

type ImageUploadPartAccess = "private"

function blobApiUploadUrl(pathname: string) {
  const baseUrl =
    process.env.VERCEL_BLOB_API_URL ||
    process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL ||
    "https://blob.vercel-storage.com"
  const url = new URL(baseUrl)

  url.searchParams.set("pathname", pathname)

  return url.toString()
}

async function createImageUploadPart(input: {
  pathname: string
  contentType: string
  maxSizeBytes: number
  access: ImageUploadPartAccess
}) {
  const clientToken = await generateClientTokenFromReadWriteToken({
    pathname: input.pathname,
    allowedContentTypes: [input.contentType],
    maximumSizeInBytes: input.maxSizeBytes,
    validUntil: Date.now() + 15 * 60 * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
  })

  return {
    pathname: input.pathname,
    uploadUrl: blobApiUploadUrl(input.pathname),
    clientToken,
    contentType: input.contentType,
    maxSizeBytes: input.maxSizeBytes,
    access: input.access,
  }
}

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json(
      { error: "Sign in before uploading stories." },
      { status: 401 },
    )
  }

  const clientBuild = Number.parseInt(
    request.headers.get("x-ubeye-app-build") ?? "",
    10,
  )
  if (!Number.isFinite(clientBuild) || clientBuild < minimumDerivativeOnlyBuild) {
    return NextResponse.json(
      { error: "Update UBEYE to post image stories." },
      { status: 426, headers: { Upgrade: "UBEYE/285" } },
    )
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:story-image-upload:user",
      subject: session.id,
      options: mutationRateLimits.storyUploadUser,
    },
    {
      bucket: "mobile:story-image-upload:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.storyUploadIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = imageUploadSchema.safeParse(await request.json().catch(() => null))

  if (
    !parsed.success ||
    !isAllowedDirectStoryImageContentType(parsed.data.contentType)
  ) {
    return NextResponse.json(
      { error: "Choose a JPG, PNG, or WEBP image up to 25 MB." },
      { status: 400 },
    )
  }

  if (
    process.env.STORY_STORAGE_PROVIDER !== "vercel-blob" ||
    !process.env.BLOB_READ_WRITE_TOKEN
  ) {
    return NextResponse.json(
      { error: "Direct image uploads are not configured." },
      { status: 503 },
    )
  }

  const basePathname = directStoryImagePathname(session.id, parsed.data.fileName)
  const [display, thumbnail] = await Promise.all([
    createImageUploadPart({
      pathname: directStoryImageDisplayPathname(
        basePathname,
        parsed.data.displayContentType,
      ),
      contentType: parsed.data.displayContentType,
      maxSizeBytes: maxStoryImageDisplayDerivativeBytes,
      access: "private",
    }),
    createImageUploadPart({
      pathname: directStoryImageThumbnailPathname(basePathname),
      contentType: "image/webp",
      maxSizeBytes: maxStoryImageThumbnailDerivativeBytes,
      access: "private",
    }),
  ])

  return NextResponse.json({
    ok: true,
    basePathname,
    display,
    thumbnail,
  })
}
