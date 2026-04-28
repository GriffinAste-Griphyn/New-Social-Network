import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { del, put } from "@vercel/blob"

const maxStoryUploadBytes = 25 * 1024 * 1024
const storyUploadDirectory = path.join(process.cwd(), "public", "uploads", "stories")
const localStoryUrlPrefix = "/uploads/stories"

const supportedUploadTypes = new Map<
  string,
  {
    assetKind: "image" | "video"
    extension: string
  }
>([
  ["image/jpeg", { assetKind: "image", extension: "jpg" }],
  ["image/png", { assetKind: "image", extension: "png" }],
  ["image/webp", { assetKind: "image", extension: "webp" }],
  ["video/mp4", { assetKind: "video", extension: "mp4" }],
  ["video/webm", { assetKind: "video", extension: "webm" }],
])

const extensionFallback = new Map<
  string,
  {
    assetKind: "image" | "video"
    extension: string
  }
>([
  [".jpg", { assetKind: "image", extension: "jpg" }],
  [".jpeg", { assetKind: "image", extension: "jpg" }],
  [".png", { assetKind: "image", extension: "png" }],
  [".webp", { assetKind: "image", extension: "webp" }],
  [".mp4", { assetKind: "video", extension: "mp4" }],
  [".webm", { assetKind: "video", extension: "webm" }],
])

export class StoryUploadError extends Error {}

export type StoredStoryAsset = {
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
}

type StoryStorageProvider = {
  remove: (mediaUrl: string) => Promise<void>
  save: (
    fileName: string,
    buffer: Buffer,
    assetKind: "image" | "video",
    contentType: string,
  ) => Promise<StoredStoryAsset>
}

function withConfiguredPublicBaseUrl(mediaUrl: string) {
  const baseUrl = process.env.STORY_STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "")

  if (!baseUrl || /^https?:\/\//i.test(mediaUrl)) {
    return mediaUrl
  }

  return `${baseUrl}${mediaUrl}`
}

const localStoryStorageProvider: StoryStorageProvider = {
  async save(fileName, buffer, assetKind) {
    await mkdir(storyUploadDirectory, { recursive: true })
    await writeFile(path.join(storyUploadDirectory, fileName), buffer)

    const mediaUrl = withConfiguredPublicBaseUrl(`${localStoryUrlPrefix}/${fileName}`)

    return {
      assetKind,
      mediaUrl,
      thumbnailUrl: assetKind === "image" ? mediaUrl : null,
    }
  },
  async remove(mediaUrl) {
    const baseUrl = process.env.STORY_STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "")
    const localMediaUrl =
      baseUrl && mediaUrl.startsWith(baseUrl)
        ? mediaUrl.slice(baseUrl.length)
        : mediaUrl

    if (!localMediaUrl.startsWith(localStoryUrlPrefix)) {
      return
    }

    const fileName = localMediaUrl.replace(`${localStoryUrlPrefix}/`, "")
    const absolutePath = path.join(storyUploadDirectory, fileName)

    await rm(absolutePath, { force: true })
  },
}

function getBlobContentType(fileName: string, assetKind: "image" | "video") {
  const extension = path.extname(fileName).slice(1).toLowerCase()

  if (assetKind === "video") {
    return `video/${extension}`
  }

  return extension === "jpg" ? "image/jpeg" : `image/${extension}`
}

const vercelBlobStoryStorageProvider: StoryStorageProvider = {
  async save(fileName, buffer, assetKind) {
    const blob = await put(`stories/${fileName}`, buffer, {
      access: "public",
      contentType: getBlobContentType(fileName, assetKind),
    })

    return {
      assetKind,
      mediaUrl: blob.url,
      thumbnailUrl: assetKind === "image" ? blob.url : null,
    }
  },
  async remove(mediaUrl) {
    if (/^https?:\/\//i.test(mediaUrl)) {
      await del(mediaUrl)
    }
  },
}

type CloudflareDirectUploadResponse = {
  success: boolean
  errors?: Array<{ message?: string }>
  result?: {
    uid?: string
    uploadURL?: string
  }
}

function getCloudflareStreamConfig() {
  const accountId = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN
  const customerSubdomain =
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN?.replace(/\/+$/, "")

  if (!accountId || !apiToken || !customerSubdomain) {
    throw new StoryUploadError(
      "Cloudflare Stream uploads require CLOUDFLARE_STREAM_ACCOUNT_ID, CLOUDFLARE_STREAM_API_TOKEN, and CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN.",
    )
  }

  return { accountId, apiToken, customerSubdomain }
}

function buildCloudflarePlaybackUrl(customerSubdomain: string, uid: string) {
  const origin = /^https?:\/\//i.test(customerSubdomain)
    ? customerSubdomain
    : `https://${customerSubdomain}`

  return `${origin}/${uid}/manifest/video.m3u8`
}

function parseCloudflareStreamUid(mediaUrl: string) {
  const match = mediaUrl.match(/\/([a-f0-9]{32})\/manifest\/video\.m3u8/i)

  return match?.[1] ?? null
}

async function saveCloudflareStreamVideo(
  fileName: string,
  buffer: Buffer,
  contentType: string,
): Promise<StoredStoryAsset> {
  const { accountId, apiToken, customerSubdomain } = getCloudflareStreamConfig()
  const createUploadResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/direct_upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        maxDurationSeconds: 120,
        meta: { name: fileName },
        requireSignedURLs: false,
      }),
    },
  )
  const createUploadPayload =
    (await createUploadResponse.json().catch(() => null)) as
      | CloudflareDirectUploadResponse
      | null
  const uid = createUploadPayload?.result?.uid
  const uploadUrl = createUploadPayload?.result?.uploadURL

  if (!createUploadResponse.ok || !createUploadPayload?.success || !uid || !uploadUrl) {
    throw new StoryUploadError(
      createUploadPayload?.errors?.[0]?.message ??
        "Could not create a Cloudflare Stream upload.",
    )
  }

  const uploadForm = new FormData()
  const uploadBytes = new Uint8Array(buffer.byteLength)
  uploadBytes.set(buffer)
  uploadForm.append("file", new Blob([uploadBytes], { type: contentType }), fileName)

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    body: uploadForm,
  })

  if (!uploadResponse.ok) {
    throw new StoryUploadError("Cloudflare Stream could not process the video upload.")
  }

  return {
    assetKind: "video",
    mediaUrl: buildCloudflarePlaybackUrl(customerSubdomain, uid),
    thumbnailUrl: null,
  }
}

async function removeCloudflareStreamVideo(mediaUrl: string) {
  const uid = parseCloudflareStreamUid(mediaUrl)

  if (!uid) {
    return
  }

  const { accountId, apiToken } = getCloudflareStreamConfig()

  await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  })
}

function getStoryStorageProvider() {
  if (process.env.STORY_STORAGE_PROVIDER === "vercel-blob") {
    return vercelBlobStoryStorageProvider
  }

  return localStoryStorageProvider
}

function resolveStoryUploadType(file: File) {
  const byMimeType = supportedUploadTypes.get(file.type)

  if (byMimeType) {
    return byMimeType
  }

  const extension = path.extname(file.name).toLowerCase()
  const byExtension = extensionFallback.get(extension)

  if (byExtension) {
    return byExtension
  }

  throw new StoryUploadError(
    "Upload a JPG, PNG, WEBP, MP4, or WEBM story asset.",
  )
}

export async function saveStoryAsset(file: File): Promise<StoredStoryAsset> {
  if (!(file instanceof File) || file.size === 0) {
    throw new StoryUploadError("Choose an image or video before posting.")
  }

  if (file.size > maxStoryUploadBytes) {
    throw new StoryUploadError("Story uploads are capped at 25 MB for now.")
  }

  const { assetKind, extension } = resolveStoryUploadType(file)
  const buffer = Buffer.from(await file.arrayBuffer())
  const fileName = `${randomUUID()}.${extension}`

  if (
    assetKind === "video" &&
    process.env.STORY_VIDEO_PROCESSOR === "cloudflare-stream"
  ) {
    return saveCloudflareStreamVideo(fileName, buffer, file.type || getBlobContentType(fileName, assetKind))
  }

  return getStoryStorageProvider().save(
    fileName,
    buffer,
    assetKind,
    file.type || getBlobContentType(fileName, assetKind),
  )
}

export async function removeStoryAsset(mediaUrl: string) {
  if (process.env.STORY_VIDEO_PROCESSOR === "cloudflare-stream") {
    await removeCloudflareStreamVideo(mediaUrl)
  }

  await getStoryStorageProvider().remove(mediaUrl)
}
