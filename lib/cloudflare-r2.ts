import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const uploadUrlTtlSeconds = 15 * 60
const immutableCacheControl = "public, max-age=31536000, immutable"

export const minimumCloudflareR2ImageBuild = 400

export class CloudflareR2Error extends Error {}

type CloudflareR2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  originalsBucket: string
  deliveryBucket: string
  publicBaseUrl: string
}

function trimmed(name: string) {
  return process.env[name]?.trim() || null
}

export function getCloudflareR2Config(): CloudflareR2Config {
  const accountId =
    trimmed("CLOUDFLARE_R2_ACCOUNT_ID") ??
    trimmed("CLOUDFLARE_STREAM_ACCOUNT_ID")
  const accessKeyId = trimmed("CLOUDFLARE_R2_ACCESS_KEY_ID")
  const secretAccessKey = trimmed("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
  const originalsBucket = trimmed("CLOUDFLARE_R2_ORIGINALS_BUCKET")
  const deliveryBucket = trimmed("CLOUDFLARE_R2_DELIVERY_BUCKET")
  const publicBaseUrl = trimmed("CLOUDFLARE_R2_PUBLIC_BASE_URL")?.replace(
    /\/+$/,
    "",
  )

  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !originalsBucket ||
    !deliveryBucket ||
    !publicBaseUrl
  ) {
    throw new CloudflareR2Error("Cloudflare R2 image storage is not configured.")
  }

  const parsedPublicBaseUrl = new URL(publicBaseUrl)
  if (parsedPublicBaseUrl.protocol !== "https:") {
    throw new CloudflareR2Error(
      "Cloudflare R2 delivery requires an HTTPS public base URL.",
    )
  }
  if (
    process.env.VERCEL_ENV === "production" &&
    parsedPublicBaseUrl.hostname.endsWith(".r2.dev")
  ) {
    throw new CloudflareR2Error(
      "Production R2 delivery requires a cached Cloudflare custom domain.",
    )
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    originalsBucket,
    deliveryBucket,
    publicBaseUrl: parsedPublicBaseUrl.toString().replace(/\/+$/, ""),
  }
}

export function isCloudflareR2Configured() {
  try {
    getCloudflareR2Config()
    return true
  } catch {
    return false
  }
}

export function isCloudflareR2StoryImageStorageEnabled() {
  return (
    process.env.STORY_IMAGE_STORAGE_PROVIDER?.trim() === "cloudflare-r2" &&
    isCloudflareR2Configured()
  )
}

let cachedClient: { cacheKey: string; client: S3Client } | null = null

function r2Client(config: CloudflareR2Config) {
  const cacheKey = [
    config.accountId,
    config.accessKeyId,
    config.secretAccessKey,
  ].join(":")

  if (cachedClient?.cacheKey === cacheKey) {
    return cachedClient.client
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  cachedClient = { cacheKey, client }
  return client
}

function assertImageObjectKey(key: string) {
  if (
    key.includes("..") ||
    !["stories/web-direct/", "avatars/"].some((prefix) =>
      key.startsWith(prefix),
    ) ||
    key.startsWith("/")
  ) {
    throw new CloudflareR2Error("The Cloudflare R2 image key is invalid.")
  }

  return key
}

function encodeObjectKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/")
}

export function cloudflareR2PublicUrl(key: string) {
  const config = getCloudflareR2Config()
  return `${config.publicBaseUrl}/${encodeObjectKey(assertImageObjectKey(key))}`
}

export function cloudflareR2DeliveryKeyFromUrl(value: string) {
  try {
    const config = getCloudflareR2Config()
    const expected = new URL(`${config.publicBaseUrl}/`)
    const candidate = new URL(value)
    if (candidate.origin !== expected.origin) return null

    const basePath = expected.pathname.replace(/\/+$/, "")
    if (
      basePath &&
      candidate.pathname !== basePath &&
      !candidate.pathname.startsWith(`${basePath}/`)
    ) {
      return null
    }

    const encodedKey = candidate.pathname.slice(basePath.length).replace(/^\/+/, "")
    const key = encodedKey
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")
    return assertImageObjectKey(key)
  } catch {
    return null
  }
}

export async function createCloudflareR2OriginalUpload(input: {
  key: string
  contentType: string
  byteSize: number
}) {
  const config = getCloudflareR2Config()
  const key = assertImageObjectKey(input.key)
  const command = new PutObjectCommand({
    Bucket: config.originalsBucket,
    Key: key,
    ContentType: input.contentType,
    ContentLength: input.byteSize,
    CacheControl: "private, no-store",
  })
  const uploadUrl = await getSignedUrl(r2Client(config), command, {
    expiresIn: uploadUrlTtlSeconds,
    signableHeaders: new Set(["content-length", "content-type"]),
  })

  return {
    key,
    uploadUrl,
    expiresInSeconds: uploadUrlTtlSeconds,
  }
}

export async function putCloudflareR2OriginalObject(input: {
  key: string
  body: Buffer
  contentType: string
}) {
  const config = getCloudflareR2Config()
  const key = assertImageObjectKey(input.key)
  await r2Client(config).send(
    new PutObjectCommand({
      Bucket: config.originalsBucket,
      Key: key,
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: input.contentType,
      CacheControl: "private, no-store",
    }),
  )

  return { key }
}

export async function readCloudflareR2Original(key: string) {
  const config = getCloudflareR2Config()
  const response = await r2Client(config).send(
    new GetObjectCommand({
      Bucket: config.originalsBucket,
      Key: assertImageObjectKey(key),
    }),
  )
  if (!response.Body) {
    throw new CloudflareR2Error("The uploaded image is not available in R2.")
  }

  return Buffer.from(await response.Body.transformToByteArray())
}

export async function headCloudflareR2Original(key: string) {
  const config = getCloudflareR2Config()
  return r2Client(config).send(
    new HeadObjectCommand({
      Bucket: config.originalsBucket,
      Key: assertImageObjectKey(key),
    }),
  )
}

export async function removeCloudflareR2Original(key: string) {
  const config = getCloudflareR2Config()
  await r2Client(config).send(
    new DeleteObjectCommand({
      Bucket: config.originalsBucket,
      Key: assertImageObjectKey(key),
    }),
  )
}

export async function putCloudflareR2DeliveryObject(input: {
  key: string
  body: Buffer
  contentType: string
}) {
  const config = getCloudflareR2Config()
  const key = assertImageObjectKey(input.key)
  await r2Client(config).send(
    new PutObjectCommand({
      Bucket: config.deliveryBucket,
      Key: key,
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: input.contentType,
      CacheControl: immutableCacheControl,
    }),
  )

  return { key, url: cloudflareR2PublicUrl(key) }
}

export async function removeCloudflareR2DeliveryObject(key: string) {
  const config = getCloudflareR2Config()
  await r2Client(config).send(
    new DeleteObjectCommand({
      Bucket: config.deliveryBucket,
      Key: assertImageObjectKey(key),
    }),
  )
}

export async function removeCloudflareR2DeliveryUrl(value: string) {
  const key = cloudflareR2DeliveryKeyFromUrl(value)
  if (!key) return false

  // Both generations remain usable for cached feeds until normal story cleanup.
  const match = key.match(/^(stories\/web-direct\/.+)-(?:fast-v1-(?:display|fit-thumb)\.webp|enhanced-v1-display\.avif)$/)
  const keys = match ? [key, `${match[1]}-fast-v1-display.webp`,
    `${match[1]}-fast-v1-fit-thumb.webp`, `${match[1]}-enhanced-v1-display.avif`] : [key]
  await Promise.all([...new Set(keys)].map(objectKey => removeCloudflareR2DeliveryObject(objectKey)))
  return true
}

export async function probeCloudflareR2Buckets() {
  const config = getCloudflareR2Config()
  const client = r2Client(config)
  await Promise.all([
    client.send(new HeadBucketCommand({ Bucket: config.originalsBucket })),
    client.send(new HeadBucketCommand({ Bucket: config.deliveryBucket })),
  ])
  return true
}
