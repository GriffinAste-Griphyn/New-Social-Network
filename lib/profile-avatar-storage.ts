import { createHash, randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { del, put } from "@vercel/blob"
import sharp from "sharp"

const maxAvatarUploadBytes = 8 * 1024 * 1024
const avatarUploadDirectory = path.join(process.cwd(), "public", "uploads", "avatars")
const localAvatarUrlPrefix = "/uploads/avatars"

type ResolvedAvatarUploadType = {
  extension: string
  contentType: string
}

export class ProfileAvatarUploadError extends Error {}

export type StoredProfileAvatar = {
  avatarUrl: string
  storageProvider: "local" | "vercel-blob"
  storageKey: string
  contentType: string
  byteSize: number
  checksum: string
}

function withConfiguredPublicBaseUrl(mediaUrl: string) {
  const baseUrl = process.env.STORY_STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "")

  if (!baseUrl || /^https?:\/\//i.test(mediaUrl)) {
    return mediaUrl
  }

  return `${baseUrl}${mediaUrl}`
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

export async function saveProfileAvatar(file: File): Promise<StoredProfileAvatar> {
  if (!(file instanceof File) || file.size === 0) {
    throw new ProfileAvatarUploadError("Choose a profile photo first.")
  }

  if (file.size > maxAvatarUploadBytes) {
    throw new ProfileAvatarUploadError("Profile photos are capped at 8 MB.")
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  resolveAvatarUploadType(buffer)

  let normalizedBuffer: Buffer

  try {
    normalizedBuffer = await sharp(buffer)
      .rotate()
      .resize(512, 512, {
        fit: "cover",
        position: "center",
      })
      .jpeg({
        quality: 90,
        mozjpeg: true,
      })
      .toBuffer()
  } catch {
    throw new ProfileAvatarUploadError(
      "Could not process that profile photo. Choose a JPG, PNG, WEBP, or HEIC image.",
    )
  }

  const contentType = "image/jpeg"
  const checksum = createHash("sha256").update(normalizedBuffer).digest("hex")
  const fileName = `${randomUUID()}.jpg`
  const storageKey = `avatars/${fileName}`

  if (process.env.STORY_STORAGE_PROVIDER === "vercel-blob") {
    const blob = await put(storageKey, normalizedBuffer, {
      access: "public",
      contentType,
    })

    return {
      avatarUrl: blob.url,
      storageProvider: "vercel-blob",
      storageKey: blob.pathname,
      contentType,
      byteSize: normalizedBuffer.byteLength,
      checksum,
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new ProfileAvatarUploadError(
      "Production profile photo uploads require STORY_STORAGE_PROVIDER=vercel-blob.",
    )
  }

  await mkdir(avatarUploadDirectory, { recursive: true })
  await writeFile(path.join(avatarUploadDirectory, fileName), normalizedBuffer)

  return {
    avatarUrl: withConfiguredPublicBaseUrl(`${localAvatarUrlPrefix}/${fileName}`),
    storageProvider: "local",
    storageKey: fileName,
    contentType,
    byteSize: normalizedBuffer.byteLength,
    checksum,
  }
}

export async function removeProfileAvatar(avatarUrl: string | null) {
  if (!avatarUrl) {
    return
  }

  if (isVercelBlobUrl(avatarUrl)) {
    await del(avatarUrl)
    return
  }

  const baseUrl = process.env.STORY_STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "")
  const localAvatarUrl =
    baseUrl && avatarUrl.startsWith(baseUrl)
      ? avatarUrl.slice(baseUrl.length)
      : avatarUrl

  if (!localAvatarUrl.startsWith(localAvatarUrlPrefix)) {
    return
  }

  const fileName = localAvatarUrl.replace(`${localAvatarUrlPrefix}/`, "")
  await rm(path.join(avatarUploadDirectory, fileName), { force: true })
}
