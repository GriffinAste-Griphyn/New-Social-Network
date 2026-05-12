import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { del, put } from "@vercel/blob"
import sharp from "sharp"

import { env } from "@/lib/env"

const maxStoryUploadBytes = 25 * 1024 * 1024
const storyUploadDirectory = path.join(process.cwd(), "public", "uploads", "stories")
const localStoryUrlPrefix = "/uploads/stories"
const storyMediaRoutePrefix = "/api/story-media"
const localStoryMediaPrefix = "local"
const cloudflareStreamMediaPrefix = "cloudflare-stream"
const storyMediaAccessTokenTtlMs = 60 * 60 * 1000
const execFileAsync = promisify(execFile)

type ResolvedUploadType = {
  assetKind: "image" | "video"
  extension: string
  contentType: string
}

type StoryAssetProcessingStatus = "processing" | "ready"

type StoryAssetMetadata = {
  width: number | null
  height: number | null
  durationMs: number | null
  processingStatus: StoryAssetProcessingStatus
}

export class StoryUploadError extends Error {}

export type StoredStoryAsset = {
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  storageProvider: "local" | "vercel-blob" | "cloudflare-stream"
  storageKey: string
  contentType: string
  byteSize: number
  checksum: string
  width: number | null
  height: number | null
  durationMs: number | null
  processingStatus: StoryAssetProcessingStatus
}

type StoryStorageProvider = {
  remove: (mediaUrl: string) => Promise<void>
  save: (
    fileName: string,
    buffer: Buffer,
    assetKind: "image" | "video",
    contentType: string,
    checksum: string,
    metadata: StoryAssetMetadata,
  ) => Promise<StoredStoryAsset>
}

function withConfiguredPublicBaseUrl(mediaUrl: string) {
  const baseUrl = process.env.STORY_STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "")

  if (!baseUrl || /^https?:\/\//i.test(mediaUrl)) {
    return mediaUrl
  }

  return `${baseUrl}${mediaUrl}`
}

function encodeStoryMediaPathname(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function getPrivateVercelBlobPathname(mediaUrl: string) {
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

function buildStoryMediaRoute(pathname: string) {
  return `${storyMediaRoutePrefix}/${encodeStoryMediaPathname(pathname)}`
}

function buildLocalStoryMediaPathname(fileName: string) {
  return `${localStoryMediaPrefix}/${fileName}`
}

function getLocalStoryMediaPathname(mediaUrl: string) {
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

function buildCloudflareStreamPathname(uid: string) {
  return `${cloudflareStreamMediaPrefix}/${uid}/manifest/video.m3u8`
}

function signStoryMediaPathname(pathname: string, expiresAtMs: number) {
  return createHmac("sha256", env.AUTH_SECRET)
    .update(`${pathname}:${expiresAtMs}`)
    .digest("base64url")
}

export function createStoryMediaAccessToken(pathname: string) {
  const expiresAtMs = Date.now() + storyMediaAccessTokenTtlMs
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

  const url = new URL(mediaUrl, request.url)

  if (
    /^https?:\/\//i.test(mediaUrl) &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  ) {
    return mediaUrl
  }

  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    const requestUrl = new URL(request.url)
    url.protocol = requestUrl.protocol
    url.hostname = requestUrl.hostname
    url.port = requestUrl.port
  }

  if (options.signed && mediaPathname) {
    url.searchParams.set("token", createStoryMediaAccessToken(mediaPathname))
  }

  return url.toString()
}

async function createLocalVideoThumbnail(videoPath: string, thumbnailPath: string) {
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg"
  const extractLastFrame = [
    "-y",
    "-sseof",
    "-0.1",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    thumbnailPath,
  ]
  const extractFirstFrame = [
    "-y",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    thumbnailPath,
  ]

  try {
    await execFileAsync(ffmpegPath, extractLastFrame)
  } catch {
    try {
      await execFileAsync(ffmpegPath, extractFirstFrame)
    } catch {
      return false
    }
  }

  try {
    const normalizedThumbnail = Buffer.from(await sharp(thumbnailPath)
      .rotate()
      .resize({
        width: 720,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 86,
        progressive: false,
      })
      .toBuffer())

    await writeFile(thumbnailPath, normalizedThumbnail)
    return true
  } catch {
    await rm(thumbnailPath, { force: true })
    return false
  }
}

const localStoryStorageProvider: StoryStorageProvider = {
  async save(fileName, buffer, assetKind, contentType, checksum, metadata) {
    await mkdir(storyUploadDirectory, { recursive: true })
    const absolutePath = path.join(storyUploadDirectory, fileName)
    const temporaryPath = path.join(
      storyUploadDirectory,
      `.${fileName}.${randomUUID()}.tmp`,
    )

    await writeFile(temporaryPath, buffer)
    await rename(temporaryPath, absolutePath)

    const mediaUrl = withConfiguredPublicBaseUrl(
      buildStoryMediaRoute(buildLocalStoryMediaPathname(fileName)),
    )
    let thumbnailUrl = assetKind === "image" ? mediaUrl : null

    if (assetKind === "video") {
      const extension = path.extname(fileName)
      const thumbnailFileName = `${fileName.slice(0, -extension.length)}-thumb.jpg`
      const thumbnailPath = path.join(storyUploadDirectory, thumbnailFileName)

      if (await createLocalVideoThumbnail(absolutePath, thumbnailPath)) {
        thumbnailUrl = withConfiguredPublicBaseUrl(
          buildStoryMediaRoute(buildLocalStoryMediaPathname(thumbnailFileName)),
        )
      }
    }

    return {
      assetKind,
      mediaUrl,
      thumbnailUrl,
      storageProvider: "local",
      storageKey: buildLocalStoryMediaPathname(fileName),
      contentType,
      byteSize: buffer.byteLength,
      checksum,
      ...metadata,
    }
  },
  async remove(mediaUrl) {
    const localStoryMediaPathname = getLocalStoryMediaPathname(mediaUrl)

    if (!localStoryMediaPathname?.startsWith(`${localStoryMediaPrefix}/`)) {
      return
    }

    const fileName = localStoryMediaPathname.slice(localStoryMediaPrefix.length + 1)
    const absolutePath = path.join(storyUploadDirectory, fileName)
    const extension = path.extname(fileName)
    const thumbnailPath = extension
      ? path.join(
          storyUploadDirectory,
          `${fileName.slice(0, -extension.length)}-thumb.jpg`,
        )
      : null

    await rm(absolutePath, { force: true })
    if (thumbnailPath) {
      await rm(thumbnailPath, { force: true })
    }
  },
}

const vercelBlobStoryStorageProvider: StoryStorageProvider = {
  async save(fileName, buffer, assetKind, contentType, checksum, metadata) {
    const blob = await put(`stories/${fileName}`, buffer, {
      access: "private",
      contentType,
    })
    const mediaUrl = buildStoryMediaRoute(blob.pathname)

    return {
      assetKind,
      mediaUrl,
      thumbnailUrl: assetKind === "image" ? mediaUrl : null,
      storageProvider: "vercel-blob",
      storageKey: blob.pathname,
      contentType,
      byteSize: buffer.byteLength,
      checksum,
      ...metadata,
    }
  },
  async remove(mediaUrl) {
    const blobPathname = getPrivateVercelBlobPathname(mediaUrl)

    if (blobPathname) {
      await del(blobPathname)
    } else if (isVercelBlobUrl(mediaUrl)) {
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

type CloudflareStreamTokenResponse = {
  success: boolean
  errors?: Array<{ message?: string }>
  result?: {
    token?: string
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

function buildCloudflarePlaybackUrl(customerSubdomain: string, playbackId: string) {
  const origin = /^https?:\/\//i.test(customerSubdomain)
    ? customerSubdomain
    : `https://${customerSubdomain}`

  return `${origin}/${playbackId}/manifest/video.m3u8`
}

function parseCloudflareStreamUid(mediaUrl: string) {
  const match = mediaUrl.match(/\/([a-f0-9]{32})\/manifest\/video\.m3u8/i)

  return match?.[1] ?? null
}

function getCloudflareStreamPathname(mediaUrl: string) {
  if (mediaUrl.startsWith(`${storyMediaRoutePrefix}/${cloudflareStreamMediaPrefix}/`)) {
    return mediaUrl.slice(storyMediaRoutePrefix.length + 1)
  }

  const uid = parseCloudflareStreamUid(mediaUrl)

  return uid ? buildCloudflareStreamPathname(uid) : null
}

export function parseCloudflareStreamMediaPathname(pathname: string) {
  const segments = pathname.split("/")

  if (
    segments.length !== 4 ||
    segments[0] !== cloudflareStreamMediaPrefix ||
    segments[2] !== "manifest" ||
    segments[3] !== "video.m3u8" ||
    !/^[a-f0-9]{32}$/i.test(segments[1] ?? "")
  ) {
    return null
  }

  return {
    uid: segments[1],
  }
}

export async function createCloudflareStreamPlaybackUrl(uid: string) {
  const { accountId, apiToken, customerSubdomain } = getCloudflareStreamConfig()
  const tokenResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        downloadable: false,
        exp: Math.floor((Date.now() + storyMediaAccessTokenTtlMs) / 1000),
      }),
    },
  )
  const tokenPayload = (await tokenResponse.json().catch(() => null)) as
    | CloudflareStreamTokenResponse
    | null
  const token = tokenPayload?.result?.token

  if (!tokenResponse.ok || !tokenPayload?.success || !token) {
    throw new StoryUploadError(
      tokenPayload?.errors?.[0]?.message ??
        "Could not create a Cloudflare Stream playback token.",
    )
  }

  return buildCloudflarePlaybackUrl(customerSubdomain, token)
}

async function saveCloudflareStreamVideo(
  fileName: string,
  buffer: Buffer,
  contentType: string,
  checksum: string,
  metadata: StoryAssetMetadata,
): Promise<StoredStoryAsset> {
  const { accountId, apiToken } = getCloudflareStreamConfig()
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
        requireSignedURLs: true,
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
    mediaUrl: buildStoryMediaRoute(buildCloudflareStreamPathname(uid)),
    thumbnailUrl: null,
    storageProvider: "cloudflare-stream",
    storageKey: uid,
    contentType,
    byteSize: buffer.byteLength,
    checksum,
    width: metadata.width,
    height: metadata.height,
    durationMs: metadata.durationMs,
    processingStatus: "processing",
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

  if (process.env.NODE_ENV === "production") {
    throw new StoryUploadError(
      "Production story uploads require STORY_STORAGE_PROVIDER=vercel-blob.",
    )
  }

  return localStoryStorageProvider
}

function hasPrefix(buffer: Buffer, bytes: number[]) {
  return bytes.every((byte, index) => buffer[index] === byte)
}

function getPositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function getDimensionPair(width: number, height: number) {
  const resolvedWidth = getPositiveInteger(width)
  const resolvedHeight = getPositiveInteger(height)

  return resolvedWidth && resolvedHeight
    ? { width: resolvedWidth, height: resolvedHeight }
    : null
}

function readUInt24LE(buffer: Buffer, offset: number) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function getPngDimensions(buffer: Buffer) {
  if (buffer.byteLength < 24) {
    return null
  }

  return getDimensionPair(buffer.readUInt32BE(16), buffer.readUInt32BE(20))
}

function getJpegDimensions(buffer: Buffer) {
  let offset = 2

  while (offset + 9 < buffer.byteLength) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]

    if (marker === 0xda || marker === 0xd9) {
      break
    }

    const segmentLength = buffer.readUInt16BE(offset + 2)

    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.byteLength) {
      break
    }

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)

    if (isStartOfFrame) {
      return getDimensionPair(
        buffer.readUInt16BE(offset + 7),
        buffer.readUInt16BE(offset + 5),
      )
    }

    offset += 2 + segmentLength
  }

  return null
}

function getWebpDimensions(buffer: Buffer) {
  let offset = 12

  while (offset + 8 <= buffer.byteLength) {
    const chunkType = buffer.subarray(offset, offset + 4).toString("ascii")
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const dataStart = offset + 8

    if (dataStart + chunkSize > buffer.byteLength) {
      return null
    }

    if (chunkType === "VP8X" && chunkSize >= 10) {
      return getDimensionPair(
        readUInt24LE(buffer, dataStart + 4) + 1,
        readUInt24LE(buffer, dataStart + 7) + 1,
      )
    }

    if (chunkType === "VP8L" && chunkSize >= 5 && buffer[dataStart] === 0x2f) {
      const width =
        1 + buffer[dataStart + 1] + ((buffer[dataStart + 2] & 0x3f) << 8)
      const height =
        1 +
        ((buffer[dataStart + 2] & 0xc0) >> 6) +
        (buffer[dataStart + 3] << 2) +
        ((buffer[dataStart + 4] & 0x0f) << 10)

      return getDimensionPair(width, height)
    }

    if (chunkType === "VP8 " && chunkSize >= 10) {
      return getDimensionPair(
        buffer.readUInt16LE(dataStart + 6) & 0x3fff,
        buffer.readUInt16LE(dataStart + 8) & 0x3fff,
      )
    }

    offset = dataStart + chunkSize + (chunkSize % 2)
  }

  return null
}

type IsoBox = {
  type: string
  dataStart: number
  end: number
}

function walkIsoBoxes(
  buffer: Buffer,
  start: number,
  end: number,
  visitor: (box: IsoBox) => void,
  depth = 0,
) {
  if (depth > 8) {
    return
  }

  let offset = start

  while (offset + 8 <= end) {
    let boxSize = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii")
    let dataStart = offset + 8

    if (boxSize === 1) {
      if (offset + 16 > end) {
        return
      }

      const largeSize = buffer.readBigUInt64BE(offset + 8)

      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        return
      }

      boxSize = Number(largeSize)
      dataStart = offset + 16
    } else if (boxSize === 0) {
      boxSize = end - offset
    }

    const boxEnd = offset + boxSize

    if (boxSize < dataStart - offset || boxEnd > end) {
      return
    }

    const box = { type, dataStart, end: boxEnd }
    visitor(box)

    if (
      [
        "moov",
        "trak",
        "mdia",
        "minf",
        "stbl",
        "edts",
        "udta",
        "iprp",
        "ipco",
      ].includes(type)
    ) {
      walkIsoBoxes(buffer, dataStart, boxEnd, visitor, depth + 1)
    } else if (type === "meta" && dataStart + 4 <= boxEnd) {
      walkIsoBoxes(buffer, dataStart + 4, boxEnd, visitor, depth + 1)
    }

    offset = boxEnd
  }
}

function getIsoMediaMetadata(buffer: Buffer, assetKind: "image" | "video") {
  let dimensions: { width: number; height: number } | null = null
  let durationMs: number | null = null

  walkIsoBoxes(buffer, 0, buffer.byteLength, (box) => {
    if (!dimensions && box.type === "ispe" && box.dataStart + 12 <= box.end) {
      dimensions = getDimensionPair(
        buffer.readUInt32BE(box.dataStart + 4),
        buffer.readUInt32BE(box.dataStart + 8),
      )
    }

    if (
      !dimensions &&
      assetKind === "video" &&
      box.type === "tkhd" &&
      box.dataStart + 4 <= box.end
    ) {
      const version = buffer[box.dataStart]
      const widthOffset = version === 1 ? box.dataStart + 88 : box.dataStart + 76
      const heightOffset = widthOffset + 4

      if (heightOffset + 4 <= box.end) {
        dimensions = getDimensionPair(
          Math.round(buffer.readUInt32BE(widthOffset) / 65536),
          Math.round(buffer.readUInt32BE(heightOffset) / 65536),
        )
      }
    }

    if (!durationMs && assetKind === "video" && box.type === "mvhd") {
      const version = buffer[box.dataStart]
      const timescaleOffset = version === 1 ? box.dataStart + 20 : box.dataStart + 12
      const durationOffset = version === 1 ? box.dataStart + 24 : box.dataStart + 16

      if (version === 0 && durationOffset + 4 <= box.end) {
        const timescale = buffer.readUInt32BE(timescaleOffset)
        const duration = buffer.readUInt32BE(durationOffset)
        durationMs = timescale > 0 ? Math.round((duration / timescale) * 1000) : null
      } else if (version === 1 && durationOffset + 8 <= box.end) {
        const timescale = buffer.readUInt32BE(timescaleOffset)
        const duration = buffer.readBigUInt64BE(durationOffset)
        durationMs =
          timescale > 0 && duration <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Math.round((Number(duration) / timescale) * 1000)
            : null
      }
    }
  })

  const resolvedDimensions = dimensions as { width: number; height: number } | null

  return {
    width: resolvedDimensions?.width ?? null,
    height: resolvedDimensions?.height ?? null,
    durationMs,
  }
}

function getStoryAssetMetadata(
  buffer: Buffer,
  uploadType: ResolvedUploadType,
): StoryAssetMetadata {
  if (uploadType.contentType === "image/png") {
    const dimensions = getPngDimensions(buffer)

    return {
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      durationMs: null,
      processingStatus: "ready",
    }
  }

  if (uploadType.contentType === "image/jpeg") {
    const dimensions = getJpegDimensions(buffer)

    return {
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      durationMs: null,
      processingStatus: "ready",
    }
  }

  if (uploadType.contentType === "image/webp") {
    const dimensions = getWebpDimensions(buffer)

    return {
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      durationMs: null,
      processingStatus: "ready",
    }
  }

  if (
    uploadType.contentType === "image/heic" ||
    uploadType.contentType === "image/avif" ||
    uploadType.contentType === "video/mp4"
  ) {
    const metadata = getIsoMediaMetadata(buffer, uploadType.assetKind)

    return {
      ...metadata,
      durationMs: uploadType.assetKind === "video" ? metadata.durationMs : null,
      processingStatus: "ready",
    }
  }

  return {
    width: null,
    height: null,
    durationMs: null,
    processingStatus: "ready",
  }
}

function getIsoBaseMediaBrand(buffer: Buffer) {
  if (buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
    return null
  }

  return buffer.subarray(8, 12).toString("ascii").trim()
}

function resolveStoryUploadType(buffer: Buffer): ResolvedUploadType {
  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    return {
      assetKind: "image",
      extension: "jpg",
      contentType: "image/jpeg",
    }
  }

  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return {
      assetKind: "image",
      extension: "png",
      contentType: "image/png",
    }
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return {
      assetKind: "image",
      extension: "webp",
      contentType: "image/webp",
    }
  }

  const isoBrand = getIsoBaseMediaBrand(buffer)

  if (isoBrand && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(isoBrand)) {
    return {
      assetKind: "image",
      extension: "heic",
      contentType: "image/heic",
    }
  }

  if (isoBrand === "avif" || isoBrand === "avis") {
    return {
      assetKind: "image",
      extension: "avif",
      contentType: "image/avif",
    }
  }

  if (isoBrand) {
    return {
      assetKind: "video",
      extension: "mp4",
      contentType: "video/mp4",
    }
  }

  if (hasPrefix(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return {
      assetKind: "video",
      extension: "webm",
      contentType: "video/webm",
    }
  }

  throw new StoryUploadError(
    "Upload a valid JPG, PNG, WEBP, MP4, or WEBM story asset.",
  )
}

async function normalizeVideoForLocalPlayback(buffer: Buffer): Promise<Buffer> {
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg"
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ubeye-story-video-"))
  const inputPath = path.join(tempDirectory, "input")
  const outputPath = path.join(tempDirectory, "output.mp4")

  try {
    await writeFile(inputPath, buffer)
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ])

    return Buffer.from(await readFile(outputPath))
  } catch {
    return buffer
  } finally {
    await rm(tempDirectory, { force: true, recursive: true })
  }
}

export async function saveStoryAsset(file: File): Promise<StoredStoryAsset> {
  if (!(file instanceof File) || file.size === 0) {
    throw new StoryUploadError("Choose an image or video before posting.")
  }

  if (file.size > maxStoryUploadBytes) {
    throw new StoryUploadError("Story uploads are capped at 25 MB for now.")
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const uploadType = resolveStoryUploadType(buffer)
  const { assetKind } = uploadType
  let storedBuffer: Buffer = buffer
  let storedUploadType = uploadType

  if (assetKind === "image") {
    try {
      storedBuffer = Buffer.from(await sharp(buffer)
        .rotate()
        .jpeg({
          quality: 90,
          progressive: false,
        })
        .toBuffer())
      storedUploadType = {
        assetKind: "image",
        extension: "jpg",
        contentType: "image/jpeg",
      }
    } catch {
      throw new StoryUploadError(
        "Could not process that image. Choose a JPG, PNG, WEBP, or HEIC story photo.",
      )
    }
  } else if (process.env.STORY_VIDEO_PROCESSOR !== "cloudflare-stream") {
    storedBuffer = await normalizeVideoForLocalPlayback(buffer)
    storedUploadType = {
      assetKind: "video",
      extension: "mp4",
      contentType: "video/mp4",
    }
  }

  const { extension, contentType } = storedUploadType
  const checksum = createHash("sha256").update(storedBuffer).digest("hex")
  const metadata = getStoryAssetMetadata(storedBuffer, storedUploadType)
  const fileName = `${randomUUID()}.${extension}`

  if (
    process.env.NODE_ENV === "production" &&
    assetKind === "video" &&
    process.env.STORY_VIDEO_PROCESSOR !== "cloudflare-stream"
  ) {
    throw new StoryUploadError(
      "Production video uploads require STORY_VIDEO_PROCESSOR=cloudflare-stream.",
    )
  }

  if (
    assetKind === "video" &&
    process.env.STORY_VIDEO_PROCESSOR === "cloudflare-stream"
  ) {
    return saveCloudflareStreamVideo(fileName, storedBuffer, contentType, checksum, metadata)
  }

  return getStoryStorageProvider().save(
    fileName,
    storedBuffer,
    assetKind,
    contentType,
    checksum,
    metadata,
  )
}

export async function removeStoryAsset(mediaUrl: string) {
  if (process.env.STORY_VIDEO_PROCESSOR === "cloudflare-stream") {
    await removeCloudflareStreamVideo(mediaUrl)
  }

  await getStoryStorageProvider().remove(mediaUrl)
}
