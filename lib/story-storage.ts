import { createHash, createPrivateKey, createSign, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"
import { del, head, put } from "@vercel/blob"

import {
  buildCloudflareStreamPathname,
  buildCloudflareStreamThumbnailPathname,
  buildStoryMediaRoute,
  cloudflareStreamMediaPrefix,
  getPrivateVercelBlobPathname,
  isVercelBlobUrl,
  storyMediaAccessTokenTtlMs,
} from "@/lib/story-media/access"
import {
  isSupportedStoryImageInputContentType,
  storyMediaContract,
} from "@/lib/story-media-contract"
export {
  createStoryMediaAccessToken,
  getStoryMediaAccessTokenMaxAgeSeconds,
  publicStoryMediaUrl,
  verifyStoryMediaAccessToken,
} from "@/lib/story-media/access"

const maxStoryUploadBytes = storyMediaContract.upload.maxImageBytes
export const maxStoryImageUploadBytes = maxStoryUploadBytes
export const maxStoryImageDisplayDerivativeBytes =
  storyMediaContract.upload.maxImageDisplayDerivativeBytes
export const maxStoryImageThumbnailDerivativeBytes =
  storyMediaContract.upload.maxImageThumbnailDerivativeBytes
export const maxStoryImagePlaceholderBytes =
  storyMediaContract.upload.maxImagePlaceholderBytes
export const maxStoryVideoUploadBytes = storyMediaContract.upload.maxVideoBytes
export const maxStoryVideoPosterUploadBytes = 2 * 1024 * 1024
const execFileAsync = promisify(execFile)
const directStoryImageDisplayWidth = storyMediaContract.canvas.width
const directStoryImageDisplayHeight = storyMediaContract.canvas.height
const directStoryImageThumbnailWidth = storyMediaContract.thumbnail.width
const directStoryImageThumbnailHeight = storyMediaContract.thumbnail.height

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
  placeholderUrl?: string | null
  storageProvider: "local" | "vercel-blob" | "cloudflare-stream"
  storageKey: string
  originalMediaUrl?: string | null
  originalThumbnailUrl?: string | null
  originalStorageProvider?: "local" | "vercel-blob" | "cloudflare-stream" | null
  originalStorageKey?: string | null
  originalContentType?: string | null
  originalByteSize?: number | null
  originalChecksum?: string | null
  originalWidth?: number | null
  originalHeight?: number | null
  originalDurationMs?: number | null
  contentType: string
  byteSize: number
  checksum: string
  width: number | null
  height: number | null
  durationMs: number | null
  processingStatus: StoryAssetProcessingStatus
  providerPctComplete?: number | null
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

export function createCloudflareStreamThumbnailMediaUrl(uid: string) {
  if (!isCloudflareStreamUid(uid)) {
    throw new StoryUploadError("Cloudflare Stream returned an invalid video id.")
  }

  return buildStoryMediaRoute(buildCloudflareStreamThumbnailPathname(uid))
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
      placeholderUrl: assetKind === "image" ? mediaUrl : null,
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

type CloudflareTusUpload = {
  uid: string
  uploadUrl: string
  uploadProtocol: "tus"
}

type CloudflareStreamTokenResponse = {
  success: boolean
  errors?: Array<{ message?: string }>
  result?: {
    token?: string
  }
}

type CloudflareStreamVideoDetailsResponse = {
  success: boolean
  errors?: Array<{ message?: string }>
  result?: {
    readyToStream?: boolean
    size?: number | null
    status?: {
      state?: string
      pctComplete?: number | string | null
      errorReasonCode?: string
      errorReasonText?: string
    } | null
    duration?: number | null
    input?: {
      width?: number | null
      height?: number | null
    } | null
  }
}

type CloudflareStreamUpdateResponse = {
  success: boolean
  errors?: Array<{ message?: string }>
}

type CachedCloudflareStreamToken = {
  customerSubdomain: string
  token: string
  expiresAtMs: number
}

const cloudflareStreamTokenCache = new Map<string, CachedCloudflareStreamToken>()
const cloudflareStreamTokenCacheMaxEntries = 500
const cloudflareStreamTokenCacheSkewMs = 60 * 1000

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

function parseCloudflareStreamSigningJwk(value: string) {
  const trimmed = value.trim()
  const json = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64")
        .toString("utf8")

  return JSON.parse(json) as Record<string, unknown>
}

function getCloudflareStreamSigningKeyConfig() {
  const keyId = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID?.trim()
  const pem = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM
    ?.replace(/\\n/g, "\n")
    .trim()
  const jwk = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK?.trim()

  if (!keyId && !pem && !jwk) {
    if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
      throw new StoryUploadError(
        "Production Cloudflare Stream playback requires a local signing key.",
      )
    }
    return null
  }

  if (!keyId || (!pem && !jwk)) {
    throw new StoryUploadError(
      "Cloudflare Stream signing requires CLOUDFLARE_STREAM_SIGNING_KEY_ID and CLOUDFLARE_STREAM_SIGNING_KEY_JWK or CLOUDFLARE_STREAM_SIGNING_KEY_PEM.",
    )
  }

  try {
    const privateKey = pem
      ? createPrivateKey(pem)
      : createPrivateKey({
          key: parseCloudflareStreamSigningJwk(jwk!),
          format: "jwk",
        })

    return { keyId, privateKey }
  } catch {
    throw new StoryUploadError("Cloudflare Stream signing key is not valid.")
  }
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function createSignedCloudflareStreamToken(input: {
  uid: string
  keyId: string
  privateKey: ReturnType<typeof createPrivateKey>
  expiresAtMs: number
}) {
  const header = base64UrlJson({
    alg: "RS256",
    kid: input.keyId,
    typ: "JWT",
  })
  const payload = base64UrlJson({
    sub: input.uid,
    kid: input.keyId,
    exp: Math.floor(input.expiresAtMs / 1000),
    downloadable: false,
  })
  const unsignedToken = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")

  signer.update(unsignedToken)
  signer.end()

  return `${unsignedToken}.${signer.sign(input.privateKey).toString("base64url")}`
}

export const cloudflareStreamThumbnailTimestampPct = 0

export function buildCloudflareThumbnailUrl(
  customerSubdomain: string,
  playbackId: string,
) {
  const origin = /^https?:\/\//i.test(customerSubdomain)
    ? customerSubdomain
    : `https://${customerSubdomain}`
  const thumbnailUrl = new URL(`${origin}/${playbackId}/thumbnails/thumbnail.jpg`)

  // Keep the loading poster pixel-aligned with the frame where playback begins.
  // An explicit value also corrects previously uploaded videos whose provider-level
  // default thumbnail timestamp was configured later in the video.
  thumbnailUrl.searchParams.set("time", "0s")
  thumbnailUrl.searchParams.set("width", "1080")
  thumbnailUrl.searchParams.set("height", "1920")
  thumbnailUrl.searchParams.set("fit", "clip")

  return thumbnailUrl.toString()
}

function encodeCloudflareTusMetadataValue(value: string | number) {
  return Buffer.from(String(value)).toString("base64")
}

function buildCloudflareTusUploadMetadata(input: {
  fileName: string
  maxDurationSeconds: number
}) {
  return [
    `name ${encodeCloudflareTusMetadataValue(input.fileName)}`,
    "requiresignedurls",
    `thumbnailtimestamppct ${encodeCloudflareTusMetadataValue(cloudflareStreamThumbnailTimestampPct)}`,
    `maxdurationseconds ${encodeCloudflareTusMetadataValue(input.maxDurationSeconds)}`,
  ].join(",")
}

function isCloudflareStreamUid(value: string) {
  return /^[a-f0-9]{32}$/i.test(value)
}

function parseCloudflarePctComplete(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null
  }

  if (typeof value === "string") {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null
  }

  return null
}

export function isAllowedDirectStoryImageContentType(contentType: string) {
  return isSupportedStoryImageInputContentType(contentType)
}

export function directStoryImagePathname(userId: string, fileName: string) {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_")
  void fileName
  return `stories/web-direct/${safeUserId}/${randomUUID()}`
}

export function directStoryImageDisplayPathname(
  basePathname: string,
  contentType: "image/avif" | "image/webp" = "image/avif",
) {
  return `${basePathname}-display.${contentType === "image/avif" ? "avif" : "webp"}`
}

export function directStoryImageThumbnailPathname(basePathname: string) {
  return `${basePathname}-thumb.webp`
}

export function directStoryVideoPosterPathname(uid: string) {
  if (!isCloudflareStreamUid(uid)) {
    throw new StoryUploadError("Cloudflare Stream returned an invalid video id.")
  }

  return `stories/video-posters/${uid}-poster.jpg`
}

export type DirectStoryImageClientDerivativeInput = {
  pathname: string
  contentType: string
  byteSize: number
  checksum: string
  width?: number | null
  height?: number | null
}

type VerifiedDirectStoryImageDerivative = {
  mediaUrl: string
  pathname: string
  contentType: string
  byteSize: number
  checksum: string
  width: number | null
  height: number | null
}

async function waitForDirectBlobMetadata(input: {
  pathname: string
  contentType: string
  byteSize: number
}) {
  const retryDelaysMs = [0, 150, 400, 900]

  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await delay(delayMs)
    }

    const candidate = await head(input.pathname).catch(() => null)
    if (
      candidate &&
      candidate.size === input.byteSize &&
      candidate.contentType.toLowerCase() === input.contentType.toLowerCase()
    ) {
      return candidate
    }
  }

  return null
}

export function normalizeStoryImageThumbHash(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed || !/^[A-Za-z0-9_-]{20,80}$/.test(trimmed)) {
    return null
  }
  const bytes = Buffer.from(trimmed, "base64url")
  if (bytes.length < 15 || bytes.length > 64) {
    return null
  }
  return bytes.toString("base64url")
}

async function verifyDirectStoryImageClientDerivative(input: {
  expectedPathname: string
  derivative: DirectStoryImageClientDerivativeInput | null | undefined
  maxByteSize: number
  contentTypes: readonly string[]
  width: number
  height: number
}): Promise<VerifiedDirectStoryImageDerivative | null> {
  if (!input.derivative) {
    return null
  }

  const { derivative } = input
  if (
    derivative.pathname.includes("..") ||
    derivative.pathname !== input.expectedPathname ||
    !input.contentTypes.includes(derivative.contentType.toLowerCase()) ||
    !Number.isSafeInteger(derivative.byteSize) ||
    derivative.byteSize <= 0 ||
    derivative.byteSize > input.maxByteSize ||
    derivative.width !== input.width ||
    derivative.height !== input.height ||
    !/^[a-f0-9]{64}$/i.test(derivative.checksum)
  ) {
    throw new StoryUploadError("Could not verify the uploaded story image variants.")
  }

  const blobMetadata = await waitForDirectBlobMetadata({
    pathname: derivative.pathname,
    contentType: derivative.contentType,
    byteSize: derivative.byteSize,
  })

  if (!blobMetadata) {
    throw new StoryUploadError(
      "The uploaded image is still being verified. Retry in a moment.",
    )
  }

  return {
    mediaUrl: buildStoryMediaRoute(blobMetadata.pathname),
    pathname: blobMetadata.pathname,
    contentType: derivative.contentType.toLowerCase(),
    byteSize: derivative.byteSize,
    checksum: derivative.checksum.toLowerCase(),
    width: derivative.width ?? null,
    height: derivative.height ?? null,
  }
}

export type DirectStoryVideoPosterInput = {
  pathname: string
  contentType: string
  byteSize: number
  checksum: string
  width: number
  height: number
}

export async function createDirectBlobStoryVideoPosterUrl(input: {
  uid: string
  poster: DirectStoryVideoPosterInput
}) {
  const expectedPathname = directStoryVideoPosterPathname(input.uid)
  const poster = input.poster
  if (
    poster.pathname.includes("..") ||
    poster.pathname !== expectedPathname ||
    poster.contentType.toLowerCase() !== "image/jpeg" ||
    !Number.isSafeInteger(poster.byteSize) ||
    poster.byteSize <= 0 ||
    poster.byteSize > maxStoryVideoPosterUploadBytes ||
    !/^[a-f0-9]{64}$/i.test(poster.checksum) ||
    !Number.isSafeInteger(poster.width) ||
    poster.width <= 0 ||
    poster.width > storyMediaContract.canvas.width ||
    !Number.isSafeInteger(poster.height) ||
    poster.height <= 0 ||
    poster.height > storyMediaContract.canvas.height
  ) {
    throw new StoryUploadError("Could not verify the story video poster.")
  }

  const blobMetadata = await waitForDirectBlobMetadata({
    pathname: poster.pathname,
    contentType: poster.contentType,
    byteSize: poster.byteSize,
  })
  if (!blobMetadata) {
    throw new StoryUploadError(
      "The uploaded video poster is still being verified. Retry in a moment.",
    )
  }

  return buildStoryMediaRoute(blobMetadata.pathname)
}

export async function removeDirectBlobStoryVideoPoster(uid: string) {
  if (!isCloudflareStreamUid(uid)) {
    return
  }

  await del(directStoryVideoPosterPathname(uid))
}

export async function createDirectBlobStoryImageAsset(input: {
  basePathname: string
  ownerUserId: string
  displayDerivative: DirectStoryImageClientDerivativeInput
  thumbnailDerivative: DirectStoryImageClientDerivativeInput
  thumbHash: string
}): Promise<StoredStoryAsset> {
  const expectedPrefix = `stories/web-direct/${input.ownerUserId.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  )}/`

  if (
    input.basePathname.includes("..") ||
    !input.basePathname.startsWith(expectedPrefix)
  ) {
    throw new StoryUploadError("Could not verify the uploaded story image.")
  }

  const displayContentType = input.displayDerivative.contentType.toLowerCase()
  const clientDisplay = await verifyDirectStoryImageClientDerivative({
    expectedPathname: directStoryImageDisplayPathname(
      input.basePathname,
      displayContentType === "image/avif" ? "image/avif" : "image/webp",
    ),
    derivative: input.displayDerivative,
    maxByteSize: maxStoryImageDisplayDerivativeBytes,
    contentTypes: ["image/avif", "image/webp"],
    width: directStoryImageDisplayWidth,
    height: directStoryImageDisplayHeight,
  })
  const clientThumbnail = await verifyDirectStoryImageClientDerivative({
    expectedPathname: directStoryImageThumbnailPathname(input.basePathname),
    derivative: input.thumbnailDerivative,
    maxByteSize: maxStoryImageThumbnailDerivativeBytes,
    contentTypes: ["image/webp"],
    width: directStoryImageThumbnailWidth,
    height: directStoryImageThumbnailHeight,
  })
  const thumbHash = normalizeStoryImageThumbHash(input.thumbHash)
  if (!clientDisplay || !clientThumbnail || !thumbHash) {
    throw new StoryUploadError("Could not verify the uploaded story image variants.")
  }

  return {
    assetKind: "image",
    mediaUrl: clientDisplay.mediaUrl,
    thumbnailUrl: clientThumbnail.mediaUrl,
    placeholderUrl: `thumbhash:${thumbHash}`,
    storageProvider: "vercel-blob",
    storageKey: clientDisplay.pathname,
    contentType: clientDisplay.contentType,
    byteSize: clientDisplay.byteSize,
    checksum: clientDisplay.checksum,
    width: clientDisplay.width,
    height: clientDisplay.height,
    durationMs: null,
    processingStatus: "ready",
  }
}


export async function backfillStoryImageThumbnails(input: {
  dryRun?: boolean
  limit?: number
} = {}) {
  return {
    ok: true,
    kind: "images" as const,
    dryRun: input.dryRun ?? true,
    limit: input.limit ?? null,
    updated: 0,
  }
}

export async function backfillCloudflareStreamPosterThumbnails(input: {
  dryRun?: boolean
  limit?: number
} = {}) {
  return {
    ok: true,
    kind: "cloudflare-posters" as const,
    dryRun: input.dryRun ?? true,
    limit: input.limit ?? null,
    updated: 0,
  }
}


function assertCloudflareStreamUploadsEnabled() {
  if (process.env.STORY_VIDEO_PROCESSOR !== "cloudflare-stream") {
    throw new StoryUploadError(
      "Production video uploads require STORY_VIDEO_PROCESSOR=cloudflare-stream.",
    )
  }
}

function parseCloudflareStreamUid(mediaUrl: string) {
  const match = mediaUrl.match(
    /\/([a-f0-9]{32})\/(?:manifest\/video\.m3u8|thumbnails\/thumbnail\.jpg)/i,
  )

  return match?.[1] ?? null
}

export function parseCloudflareStreamMediaPathname(pathname: string) {
  const segments = pathname.split("/")

  if (
    segments.length === 4 &&
    segments[0] === cloudflareStreamMediaPrefix &&
    segments[2] === "manifest" &&
    segments[3] === "video.m3u8" &&
    /^[a-f0-9]{32}$/i.test(segments[1] ?? "")
  ) {
    return {
      kind: "playback" as const,
      uid: segments[1],
    }
  }

  if (
    segments.length === 4 &&
    segments[0] === cloudflareStreamMediaPrefix &&
    segments[2] === "thumbnails" &&
    segments[3] === "thumbnail.jpg" &&
    /^[a-f0-9]{32}$/i.test(segments[1] ?? "")
  ) {
    return {
      kind: "thumbnail" as const,
      uid: segments[1],
    }
  }

  return null
}

function pruneCloudflareStreamTokenCache() {
  if (cloudflareStreamTokenCache.size <= cloudflareStreamTokenCacheMaxEntries) {
    return
  }

  const now = Date.now()

  for (const [key, cached] of cloudflareStreamTokenCache) {
    if (
      cached.expiresAtMs <= now + cloudflareStreamTokenCacheSkewMs ||
      cloudflareStreamTokenCache.size > cloudflareStreamTokenCacheMaxEntries
    ) {
      cloudflareStreamTokenCache.delete(key)
    }
  }
}

async function createCloudflareStreamToken(uid: string) {
  const { accountId, apiToken, customerSubdomain } = getCloudflareStreamConfig()
  const now = Date.now()
  const signingKey = getCloudflareStreamSigningKeyConfig()
  const cacheKey = `${customerSubdomain}:${signingKey?.keyId ?? "api"}:${uid}`
  const cached = cloudflareStreamTokenCache.get(cacheKey)

  if (cached && cached.expiresAtMs > now + cloudflareStreamTokenCacheSkewMs) {
    return cached
  }

  const expiresAtMs = now + storyMediaAccessTokenTtlMs
  if (signingKey) {
    const nextCached = {
      customerSubdomain,
      token: createSignedCloudflareStreamToken({
        uid,
        keyId: signingKey.keyId,
        privateKey: signingKey.privateKey,
        expiresAtMs,
      }),
      expiresAtMs,
    }

    cloudflareStreamTokenCache.set(cacheKey, nextCached)
    pruneCloudflareStreamTokenCache()

    return nextCached
  }

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
        exp: Math.floor(expiresAtMs / 1000),
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

  const nextCached = { customerSubdomain, token, expiresAtMs }

  cloudflareStreamTokenCache.set(cacheKey, nextCached)
  pruneCloudflareStreamTokenCache()

  return nextCached
}

export async function createCloudflareStreamPlaybackUrl(uid: string) {
  const { customerSubdomain, token } = await createCloudflareStreamToken(uid)

  return buildCloudflarePlaybackUrl(customerSubdomain, token)
}

export async function createCloudflareStreamThumbnailUrl(uid: string) {
  const { customerSubdomain, token } = await createCloudflareStreamToken(uid)

  return buildCloudflareThumbnailUrl(customerSubdomain, token)
}

export async function setCloudflareStreamThumbnailAtDefaultTime(uid: string) {
  assertCloudflareStreamUploadsEnabled()

  if (!isCloudflareStreamUid(uid)) {
    throw new StoryUploadError("Cloudflare Stream returned an invalid video id.")
  }

  const { accountId, apiToken } = getCloudflareStreamConfig()
  const updateResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thumbnailTimestampPct: cloudflareStreamThumbnailTimestampPct,
      }),
    },
  )
  const updatePayload = (await updateResponse.json().catch(() => null)) as
    | CloudflareStreamUpdateResponse
    | null

  if (!updateResponse.ok || !updatePayload?.success) {
    throw new StoryUploadError(
      updatePayload?.errors?.[0]?.message ??
        "Could not set the Cloudflare Stream thumbnail.",
    )
  }
}

export async function getCloudflareStreamVideoDetails(uid: string) {
  assertCloudflareStreamUploadsEnabled()

  if (!isCloudflareStreamUid(uid)) {
    throw new StoryUploadError("Cloudflare Stream returned an invalid video id.")
  }

  const { accountId, apiToken } = getCloudflareStreamConfig()
  const detailsResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    },
  )
  const detailsPayload = (await detailsResponse.json().catch(() => null)) as
    | CloudflareStreamVideoDetailsResponse
    | null

  if (!detailsResponse.ok || !detailsPayload?.success) {
    throw new StoryUploadError(
      detailsPayload?.errors?.[0]?.message ??
        "Could not read Cloudflare Stream video details.",
    )
  }

  return {
    readyToStream: detailsPayload.result?.readyToStream === true,
    state: detailsPayload.result?.status?.state ?? null,
    pctComplete: parseCloudflarePctComplete(
      detailsPayload.result?.status?.pctComplete,
    ),
    errorReason:
      detailsPayload.result?.status?.errorReasonText ||
      detailsPayload.result?.status?.errorReasonCode ||
      null,
    byteSize:
      typeof detailsPayload.result?.size === "number" &&
      Number.isFinite(detailsPayload.result.size) &&
      detailsPayload.result.size > 0
        ? Math.round(detailsPayload.result.size)
        : null,
    durationMs:
      typeof detailsPayload.result?.duration === "number" &&
      Number.isFinite(detailsPayload.result.duration) &&
      detailsPayload.result.duration > 0
        ? Math.round(detailsPayload.result.duration * 1_000)
        : null,
    width:
      typeof detailsPayload.result?.input?.width === "number"
        ? Math.round(detailsPayload.result.input.width)
        : null,
    height:
      typeof detailsPayload.result?.input?.height === "number"
        ? Math.round(detailsPayload.result.input.height)
        : null,
  }
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

  await setCloudflareStreamThumbnailAtDefaultTime(uid).catch(() => undefined)

  return {
    assetKind: "video",
    mediaUrl: buildStoryMediaRoute(buildCloudflareStreamPathname(uid)),
    thumbnailUrl: createCloudflareStreamThumbnailMediaUrl(uid),
    placeholderUrl: createCloudflareStreamThumbnailMediaUrl(uid),
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

export async function createCloudflareStreamTusUpload(input: {
  fileName: string
  uploadLengthBytes: number
  maxDurationSeconds: number
}): Promise<CloudflareTusUpload> {
  assertCloudflareStreamUploadsEnabled()

  if (
    !Number.isSafeInteger(input.uploadLengthBytes) ||
    input.uploadLengthBytes <= 0
  ) {
    throw new StoryUploadError("Cloudflare Stream tus uploads require a file size.")
  }

  const { accountId, apiToken } = getCloudflareStreamConfig()
  const createUploadResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?direct_user=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": input.uploadLengthBytes.toString(),
        "Upload-Metadata": buildCloudflareTusUploadMetadata({
          fileName: input.fileName,
          maxDurationSeconds: input.maxDurationSeconds,
        }),
      },
    },
  )
  const uploadUrl = createUploadResponse.headers.get("location")
  const uid = createUploadResponse.headers.get("stream-media-id")

  if (!createUploadResponse.ok || !uploadUrl || !uid) {
    const errorPayload = (await createUploadResponse.json().catch(() => null)) as
      | CloudflareDirectUploadResponse
      | null

    throw new StoryUploadError(
      errorPayload?.errors?.[0]?.message ??
        "Could not create a Cloudflare Stream resumable upload.",
    )
  }

  if (!isCloudflareStreamUid(uid)) {
    throw new StoryUploadError("Cloudflare Stream returned an invalid video id.")
  }

  return { uid, uploadUrl, uploadProtocol: "tus" }
}

export function createCloudflareStreamStoredVideoAsset(input: {
  uid: string
  contentType: string
  byteSize: number
  thumbnailUrl?: string | null
  durationMs?: number | null
  width?: number | null
  height?: number | null
  processingStatus?: StoryAssetProcessingStatus
  providerPctComplete?: number | null
}): StoredStoryAsset {
  assertCloudflareStreamUploadsEnabled()

  if (!isCloudflareStreamUid(input.uid)) {
    throw new StoryUploadError("Cloudflare Stream returned an invalid video id.")
  }

  return {
    assetKind: "video",
    mediaUrl: buildStoryMediaRoute(buildCloudflareStreamPathname(input.uid)),
    thumbnailUrl:
      input.thumbnailUrl ?? createCloudflareStreamThumbnailMediaUrl(input.uid),
    placeholderUrl:
      input.thumbnailUrl ?? createCloudflareStreamThumbnailMediaUrl(input.uid),
    storageProvider: "cloudflare-stream",
    storageKey: input.uid,
    contentType: input.contentType.startsWith("video/")
      ? input.contentType
      : "video/mp4",
    byteSize: Math.max(1, Math.floor(input.byteSize)),
    checksum: input.uid,
    width: input.width ?? null,
    height: input.height ?? null,
    durationMs: input.durationMs ?? null,
    processingStatus: input.processingStatus ?? "ready",
    providerPctComplete:
      input.providerPctComplete ??
      (input.processingStatus === "processing" ? null : 100),
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

export async function removeCloudflareStreamVideoByUid(uid: string) {
  if (!isCloudflareStreamUid(uid)) {
    return
  }

  const { accountId, apiToken } = getCloudflareStreamConfig()

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    },
  )

  if (!response.ok && response.status !== 404) {
    throw new StoryUploadError(
      `Could not remove abandoned Cloudflare Stream upload (${response.status}).`,
    )
  }
}

function getStoryStorageProvider() {
  if (
    process.env.STORY_STORAGE_PROVIDER !== "vercel-blob" ||
    !process.env.BLOB_READ_WRITE_TOKEN
  ) {
    throw new StoryUploadError(
      "Story uploads require private Vercel Blob storage.",
    )
  }
  return vercelBlobStoryStorageProvider
}

async function removeDirectStoryImageDerivatives(mediaUrl: string) {
  const pathname = getPrivateVercelBlobPathname(mediaUrl)

  if (!pathname?.startsWith("stories/web-direct/")) {
    return
  }

  const derivativeMatch = pathname.match(/^(.*)-(?:display|thumb)\.(?:avif|webp)$/i)
  const basePathname = derivativeMatch?.[1]
  if (!basePathname) {
    return
  }

  await Promise.allSettled([
    del(directStoryImageDisplayPathname(basePathname, "image/avif")),
    del(directStoryImageDisplayPathname(basePathname, "image/webp")),
    del(directStoryImageThumbnailPathname(basePathname)),
  ])
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

  if (assetKind !== "image" && process.env.STORY_VIDEO_PROCESSOR !== "cloudflare-stream") {
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
    assertCloudflareStreamUploadsEnabled()
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

  await removeDirectStoryImageDerivatives(mediaUrl)
  await getStoryStorageProvider().remove(mediaUrl)
}

export async function removeStoredStoryAsset(
  asset: Pick<
    StoredStoryAsset,
    | "mediaUrl"
    | "thumbnailUrl"
    | "placeholderUrl"
    | "originalMediaUrl"
    | "originalThumbnailUrl"
  >,
) {
  const mediaUrls = Array.from(
    new Set(
      [
        asset.mediaUrl,
        asset.thumbnailUrl,
        asset.placeholderUrl,
        asset.originalMediaUrl,
        asset.originalThumbnailUrl,
      ].filter((value): value is string => Boolean(value)),
    ),
  )

  await Promise.allSettled(mediaUrls.map((mediaUrl) => removeStoryAsset(mediaUrl)))
}
