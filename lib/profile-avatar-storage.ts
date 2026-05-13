import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { del, get, put } from "@vercel/blob"
import sharp from "sharp"

const maxAvatarUploadBytes = 8 * 1024 * 1024
const avatarUploadDirectory = path.join(process.cwd(), "public", "uploads", "avatars")
const localAvatarUrlPrefix = "/uploads/avatars"
const profileAvatarMediaRoutePrefix = "/api/profile-avatar-media"

type ResolvedAvatarUploadType = {
  extension: string
  contentType: string
}

export class ProfileAvatarUploadError extends Error {}

export type StoredProfileAvatar = {
  avatarUrl: string
  sourceUrl: string
  storageProvider: "local" | "vercel-blob"
  storageKey: string
  sourceStorageKey: string
  sourceContentType: string
  sourceByteSize: number
  contentType: string
  byteSize: number
  checksum: string
}

export type ProfileAvatarCrop = {
  originX: number
  originY: number
  width: number
  height: number
}

function withConfiguredPublicBaseUrl(mediaUrl: string) {
  const baseUrl = process.env.STORY_STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "")

  if (!baseUrl || /^https?:\/\//i.test(mediaUrl)) {
    return mediaUrl
  }

  return `${baseUrl}${mediaUrl}`
}

function encodeProfileAvatarPathname(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function buildProfileAvatarMediaRoute(pathname: string) {
  return `${profileAvatarMediaRoutePrefix}/${encodeProfileAvatarPathname(pathname)}`
}

function buildLocalAvatarPathname(fileName: string) {
  return `${localAvatarUrlPrefix}/${fileName}`
}

function hasPrefix(buffer: Buffer, bytes: number[]) {
  return bytes.every((byte, index) => buffer[index] === byte)
}

function getIsoBaseMediaBrand(buffer: Buffer) {
  if (buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
    return null
  }

  return buffer.subarray(8, 12).toString("ascii").trim()
}

function resolveAvatarUploadType(buffer: Buffer): ResolvedAvatarUploadType {
  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    return { extension: "jpg", contentType: "image/jpeg" }
  }

  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { extension: "png", contentType: "image/png" }
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", contentType: "image/webp" }
  }

  const isoBrand = getIsoBaseMediaBrand(buffer)

  if (isoBrand && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(isoBrand)) {
    return { extension: "heic", contentType: "image/heic" }
  }

  throw new ProfileAvatarUploadError("Choose a JPG, PNG, WEBP, or HEIC profile photo.")
}

function isVercelBlobUrl(mediaUrl: string) {
  if (!/^https?:\/\//i.test(mediaUrl)) {
    return false
  }

  try {
    return new URL(mediaUrl).hostname.endsWith(".blob.vercel-storage.com")
  } catch {
    return false
  }
}

function getPrivateVercelBlobPathname(mediaUrl: string) {
  if (mediaUrl.startsWith(`${profileAvatarMediaRoutePrefix}/`)) {
    const pathname = mediaUrl
      .slice(profileAvatarMediaRoutePrefix.length + 1)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")

    return pathname.startsWith("avatars/") ? pathname : null
  }

  if (!/^https?:\/\//i.test(mediaUrl)) {
    return null
  }

  try {
    const url = new URL(mediaUrl)

    if (!url.hostname.endsWith(".private.blob.vercel-storage.com")) {
      return null
    }

    const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ""))

    return pathname.startsWith("avatars/") ? pathname : null
  } catch {
    return null
  }
}

function getLocalAvatarFileName(mediaUrl: string) {
  const baseUrl = process.env.STORY_STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "")
  const localAvatarUrl =
    baseUrl && mediaUrl.startsWith(baseUrl)
      ? mediaUrl.slice(baseUrl.length)
      : mediaUrl

  if (!localAvatarUrl.startsWith(localAvatarUrlPrefix)) {
    return null
  }

  return localAvatarUrl.replace(`${localAvatarUrlPrefix}/`, "")
}

export function publicProfileAvatarUrl(value: string | null, request?: Request) {
  if (!value) {
    return null
  }

  const blobPathname = getPrivateVercelBlobPathname(value)
  const avatarUrl = blobPathname ? buildProfileAvatarMediaRoute(blobPathname) : value

  if (!request || /^https?:\/\//i.test(avatarUrl)) {
    return avatarUrl
  }

  return new URL(avatarUrl, request.url).toString()
}

function normalizeCrop(crop: ProfileAvatarCrop, width: number, height: number) {
  const maxSize = Math.min(width, height)
  const cropSize = Math.min(
    maxSize,
    Math.max(1, Math.round(Math.min(crop.width, crop.height))),
  )

  return {
    left: Math.min(width - cropSize, Math.max(0, Math.round(crop.originX))),
    top: Math.min(height - cropSize, Math.max(0, Math.round(crop.originY))),
    width: cropSize,
    height: cropSize,
  }
}

async function normalizeAvatarSource(buffer: Buffer) {
  return sharp(buffer)
    .rotate()
    .resize(2048, 2048, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 94,
      mozjpeg: true,
    })
    .toBuffer()
}

async function createAvatarBuffer(sourceBuffer: Buffer, crop?: ProfileAvatarCrop) {
  const metadata = await sharp(sourceBuffer).metadata()
  const width = metadata.width
  const height = metadata.height

  if (!width || !height) {
    throw new ProfileAvatarUploadError("Could not read that profile photo.")
  }

  const defaultCropSize = Math.min(width, height)
  const centeredCrop = {
    left: Math.round((width - defaultCropSize) / 2),
    top: Math.round((height - defaultCropSize) / 2),
    width: defaultCropSize,
    height: defaultCropSize,
  }
  const cropRect = crop ? normalizeCrop(crop, width, height) : centeredCrop

  return sharp(sourceBuffer)
    .extract(cropRect)
    .resize(512, 512, {
      fit: "cover",
    })
    .jpeg({
      quality: 90,
      mozjpeg: true,
    })
    .toBuffer()
}

async function storeAvatarBuffer(input: {
  buffer: Buffer
  fileName: string
  storageKey: string
  contentType: string
}) {
  if (process.env.STORY_STORAGE_PROVIDER === "vercel-blob") {
    const blob = await put(input.storageKey, input.buffer, {
      access: "private",
      contentType: input.contentType,
    })

    return {
      url: buildProfileAvatarMediaRoute(blob.pathname),
      storageKey: blob.pathname,
      storageProvider: "vercel-blob" as const,
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new ProfileAvatarUploadError(
      "Production profile photo uploads require STORY_STORAGE_PROVIDER=vercel-blob.",
    )
  }

  await mkdir(path.dirname(path.join(avatarUploadDirectory, input.fileName)), {
    recursive: true,
  })
  await writeFile(path.join(avatarUploadDirectory, input.fileName), input.buffer)

  return {
    url: withConfiguredPublicBaseUrl(buildLocalAvatarPathname(input.fileName)),
    storageKey: input.fileName,
    storageProvider: "local" as const,
  }
}

async function readStoredAvatarBuffer(sourceUrl: string) {
  const privateBlobPathname = getPrivateVercelBlobPathname(sourceUrl)

  if (privateBlobPathname) {
    const result = await get(privateBlobPathname, { access: "private" })

    if (!result) {
      throw new ProfileAvatarUploadError("Could not load the original photo.")
    }

    if (result.statusCode !== 200 || !result.stream) {
      throw new ProfileAvatarUploadError("Could not load the original photo.")
    }

    return Buffer.from(await new Response(result.stream).arrayBuffer())
  }

  const localFileName = getLocalAvatarFileName(sourceUrl)

  if (localFileName) {
    return readFile(path.join(avatarUploadDirectory, localFileName))
  }

  throw new ProfileAvatarUploadError("Could not load the original photo.")
}

export async function saveProfileAvatar(file: File): Promise<StoredProfileAvatar> {
  if (!(file instanceof File) || file.size === 0) {
    throw new ProfileAvatarUploadError("Choose a profile photo first.")
  }

  if (file.size > maxAvatarUploadBytes) {
    throw new ProfileAvatarUploadError("Profile photos are capped at 8 MB.")
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  resolveAvatarUploadType(buffer)

  let sourceBuffer: Buffer
  let avatarBuffer: Buffer

  try {
    sourceBuffer = await normalizeAvatarSource(buffer)
    avatarBuffer = await createAvatarBuffer(sourceBuffer)
  } catch {
    throw new ProfileAvatarUploadError(
      "Could not process that profile photo. Choose a JPG, PNG, WEBP, or HEIC image.",
    )
  }

  const contentType = "image/jpeg"
  const checksum = createHash("sha256").update(avatarBuffer).digest("hex")
  const fileName = `${randomUUID()}.jpg`
  const sourceFileName = `source/${randomUUID()}.jpg`
  const storageKey = `avatars/${fileName}`
  const sourceStorageKey = `avatars/${sourceFileName}`
  const sourceContentType = "image/jpeg"
  const sourceByteSize = sourceBuffer.byteLength
  const sourceResult = await storeAvatarBuffer({
    buffer: sourceBuffer,
    fileName: sourceFileName,
    storageKey: sourceStorageKey,
    contentType: sourceContentType,
  })
  let avatarResult: Awaited<ReturnType<typeof storeAvatarBuffer>>

  try {
    avatarResult = await storeAvatarBuffer({
      buffer: avatarBuffer,
      fileName,
      storageKey,
      contentType,
    })
  } catch (error) {
    await removeProfileAvatar(sourceResult.url).catch(() => undefined)
    throw error
  }

  return {
    avatarUrl: avatarResult.url,
    sourceUrl: sourceResult.url,
    storageProvider: avatarResult.storageProvider,
    storageKey: avatarResult.storageKey,
    sourceStorageKey: sourceResult.storageKey,
    sourceContentType,
    sourceByteSize,
    contentType,
    byteSize: avatarBuffer.byteLength,
    checksum,
  }
}

export async function saveRepositionedProfileAvatar(input: {
  sourceUrl: string
  sourceStorageKey: string
  sourceContentType: string
  sourceByteSize: number
  crop: ProfileAvatarCrop
}): Promise<StoredProfileAvatar> {
  const sourceBuffer = await readStoredAvatarBuffer(input.sourceUrl)
  const avatarBuffer = await createAvatarBuffer(sourceBuffer, input.crop)
  const contentType = "image/jpeg"
  const checksum = createHash("sha256").update(avatarBuffer).digest("hex")
  const fileName = `${randomUUID()}.jpg`
  const storageKey = `avatars/${fileName}`
  const avatarResult = await storeAvatarBuffer({
    buffer: avatarBuffer,
    fileName,
    storageKey,
    contentType,
  })

  return {
    avatarUrl: avatarResult.url,
    sourceUrl: input.sourceUrl,
    storageProvider: avatarResult.storageProvider,
    storageKey: avatarResult.storageKey,
    sourceStorageKey: input.sourceStorageKey,
    sourceContentType: input.sourceContentType,
    sourceByteSize: input.sourceByteSize,
    contentType,
    byteSize: avatarBuffer.byteLength,
    checksum,
  }
}

export async function removeProfileAvatar(avatarUrl: string | null) {
  if (!avatarUrl) {
    return
  }

  const privateBlobPathname = getPrivateVercelBlobPathname(avatarUrl)

  if (privateBlobPathname) {
    await del(privateBlobPathname)
    return
  }

  if (isVercelBlobUrl(avatarUrl)) {
    await del(avatarUrl)
    return
  }

  const fileName = getLocalAvatarFileName(avatarUrl)
  if (!fileName) return
  await rm(path.join(avatarUploadDirectory, fileName), { force: true })
}
