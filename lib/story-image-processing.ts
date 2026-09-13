import { createHash } from "node:crypto"

import { del, get, put } from "@vercel/blob"
import sharp from "sharp"
import { rgbaToThumbHash } from "thumbhash"

import {
  headCloudflareR2Original,
  putCloudflareR2DeliveryObject,
  readCloudflareR2Original,
  removeCloudflareR2DeliveryObject,
  removeCloudflareR2Original,
} from "@/lib/cloudflare-r2"
import { highestQualityImageWithinBudget } from "@/lib/story-image-encoding"
import { isVercelBlobAccessDisabled } from "@/lib/media-availability"
import { buildStoryMediaRoute } from "@/lib/story-media/access"
import { storyMediaContract, type StoryImageContentMode } from "@/lib/story-media-contract"
import {
  directStoryImageDisplayPathname,
  directStoryImageSourcePathname,
  directStoryImageThumbnailPathname,
  maxStoryImageDisplayDerivativeBytes,
  maxStoryImageThumbnailDerivativeBytes,
  StoryUploadError,
  type StoredStoryAsset,
} from "@/lib/story-storage"

export type DirectStoryImageSourceInput = {
  pathname: string
  contentType: string
  byteSize: number
  checksum: string
}

export type { StoryImageContentMode } from "@/lib/story-media-contract"

export function storyImageResizeOptions(contentMode: StoryImageContentMode) {
  return {
    fit: contentMode === "fill" ? ("cover" as const) : ("contain" as const),
    position: "centre" as const,
    kernel: sharp.kernel.lanczos3,
    background: { r: 0, g: 0, b: 0, alpha: contentMode === "fill" ? 1 : 0 },
  }
}

export async function createStoryCanvasImage(
  sourceBody: Buffer,
  contentMode: StoryImageContentMode = storyMediaContract.imageFraming.defaultContentMode,
) {
  const sourceOptions = {
    autoOrient: true,
    failOn: "warning",
    limitInputPixels: 80_000_000,
  } as const
  const metadata = await sharp(sourceBody, sourceOptions).metadata()
  const sourceHasAlpha = Boolean(metadata.hasAlpha)

  if (contentMode === "fill") {
    const filled = sharp(sourceBody, sourceOptions)
      .resize(
        storyMediaContract.canvas.width,
        storyMediaContract.canvas.height,
        storyImageResizeOptions("fill"),
      )
      .sharpen({ sigma: 0.6 })
    return sourceHasAlpha ? filled.ensureAlpha() : filled.removeAlpha()
  }

  if (sourceHasAlpha) {
    return sharp(sourceBody, sourceOptions)
      .resize(
        storyMediaContract.canvas.width,
        storyMediaContract.canvas.height,
        storyImageResizeOptions("fit"),
      )
      .sharpen({ sigma: 0.6 })
      .ensureAlpha()
  }

  return sharp(sourceBody, sourceOptions)
    .resize(
      storyMediaContract.canvas.width,
      storyMediaContract.canvas.height,
      storyImageResizeOptions("fit"),
    )
    .sharpen({ sigma: 0.6 })
    .removeAlpha()
}

export function storyImageThumbnailResizeOptions() {
  return storyImageResizeOptions("fill")
}

export async function storyImageDisplayDimensions(sourceBody: Buffer) {
  const metadata = await sharp(sourceBody, {
    autoOrient: false,
    failOn: "warning",
    limitInputPixels: 80_000_000,
  }).metadata()
  if (!metadata.width || !metadata.height) {
    return null
  }

  const swapsPixelAxes =
    metadata.orientation != null &&
    metadata.orientation >= 5 &&
    metadata.orientation <= 8

  return {
    width: swapsPixelAxes ? metadata.height : metadata.width,
    height: swapsPixelAxes ? metadata.width : metadata.height,
  }
}

export function createImageProcessingStoredAsset(input: {
  storageProvider: "vercel-blob" | "cloudflare-r2"
  source: DirectStoryImageSourceInput
  width?: number | null
  height?: number | null
}): StoredStoryAsset {
  const sourceUrl = buildStoryMediaRoute(input.source.pathname)
  return {
    assetKind: "image",
    mediaUrl: sourceUrl,
    thumbnailUrl: null,
    placeholderUrl: null,
    storageProvider: input.storageProvider,
    storageKey: input.source.pathname,
    originalMediaUrl: sourceUrl,
    originalStorageProvider: input.storageProvider,
    originalStorageKey: input.source.pathname,
    originalContentType: input.source.contentType,
    originalByteSize: input.source.byteSize,
    originalChecksum: input.source.checksum,
    originalWidth: input.width ?? null,
    originalHeight: input.height ?? null,
    contentType: input.source.contentType,
    byteSize: input.source.byteSize,
    checksum: input.source.checksum,
    width: input.width ?? null,
    height: input.height ?? null,
    durationMs: null,
    processingStatus: "processing",
    providerPctComplete: 0,
  }
}

function privateBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new StoryUploadError("Image processing is not configured.")
  return token
}

async function encodeWithinBudget(input: {
  qualities: readonly number[]
  maxByteSize: number
  encode: (quality: number) => Promise<Buffer>
}) {
  return highestQualityImageWithinBudget({
    qualities: input.qualities,
    maxByteSize: input.maxByteSize,
    encode: async (quality) => {
      const body = await input.encode(quality)
      return { body, size: body.byteLength, quality }
    },
  })
}

export async function createServerEncodedStoryImageAsset(input: {
  basePathname: string
  ownerUserId: string
  contentMode: StoryImageContentMode
  storageProvider?: "vercel-blob" | "cloudflare-r2"
  source: DirectStoryImageSourceInput
  deleteSourceAfterProcessing?: boolean
}): Promise<StoredStoryAsset> {
  const storageProvider = input.storageProvider ?? "vercel-blob"
  if (storageProvider === "vercel-blob" && isVercelBlobAccessDisabled()) {
    throw new StoryUploadError(
      "Image processing is paused while media service access recovers.",
    )
  }

  const safeOwner = input.ownerUserId.replace(/[^a-zA-Z0-9_-]/g, "_")
  const expectedPrefix = `stories/web-direct/${safeOwner}/`
  const expectedSource = directStoryImageSourcePathname(
    input.basePathname,
    input.source.contentType,
  )
  if (
    input.basePathname.includes("..") ||
    !input.basePathname.startsWith(expectedPrefix) ||
    input.source.pathname !== expectedSource ||
    !/^[a-f0-9]{64}$/i.test(input.source.checksum) ||
    input.source.byteSize <= 0 ||
    input.source.byteSize > storyMediaContract.upload.maxImageBytes
  ) {
    throw new StoryUploadError("Could not verify the uploaded story image.")
  }

  if (storageProvider === "cloudflare-r2") {
    const sourceMetadata = await headCloudflareR2Original(
      input.source.pathname,
    ).catch(() => null)
    if (
      !sourceMetadata ||
      sourceMetadata.ContentLength !== input.source.byteSize ||
      sourceMetadata.ContentType?.toLowerCase() !==
        input.source.contentType.toLowerCase()
    ) {
      throw new StoryUploadError("The uploaded image failed its metadata check.")
    }
  }

  const sourceBody =
    storageProvider === "cloudflare-r2"
      ? await readCloudflareR2Original(input.source.pathname).catch(() => {
          throw new StoryUploadError("The uploaded image is still being verified.")
        })
      : await (async () => {
          const sourceBlob = await get(input.source.pathname, {
            access: "private",
            token: privateBlobToken(),
            useCache: false,
          })
          if (!sourceBlob || sourceBlob.statusCode !== 200 || !sourceBlob.stream) {
            throw new StoryUploadError("The uploaded image is still being verified.")
          }
          return Buffer.from(await new Response(sourceBlob.stream).arrayBuffer())
        })()
  if (
    sourceBody.byteLength !== input.source.byteSize ||
    createHash("sha256").update(sourceBody).digest("hex") !==
      input.source.checksum.toLowerCase()
  ) {
    throw new StoryUploadError("The uploaded image failed its integrity check.")
  }

  const originalDimensions = await storyImageDisplayDimensions(sourceBody)
  const image = await createStoryCanvasImage(sourceBody, input.contentMode)
  const displayAvif = await encodeWithinBudget({
    qualities: storyMediaContract.imageEncoding.displayAvifQualities.map(
      (quality) => Math.round(quality * 100),
    ),
    maxByteSize: maxStoryImageDisplayDerivativeBytes,
    encode: (quality) =>
      image
        .clone()
        .avif({ quality, effort: 4, chromaSubsampling: "4:2:0", bitdepth: 8 })
        .toBuffer(),
  }).catch(() => null)
  const displayWebp = displayAvif
    ? null
    : await encodeWithinBudget({
        qualities: storyMediaContract.imageEncoding.displayWebpQualities.map(
          (quality) => Math.round(quality * 100),
        ),
        maxByteSize: maxStoryImageDisplayDerivativeBytes,
        encode: (quality) =>
          image.clone().webp({ quality, effort: 4, smartSubsample: true }).toBuffer(),
      })
  const display = displayAvif ?? displayWebp
  if (!display) {
    throw new StoryUploadError("The image could not fit the delivery budget.")
  }

  const thumbnailImage = image.clone().resize(
    storyMediaContract.thumbnail.width,
    storyMediaContract.thumbnail.height,
    { fit: "fill", kernel: sharp.kernel.lanczos3 },
  )
  const thumbnail = await encodeWithinBudget({
    qualities: storyMediaContract.imageEncoding.thumbnailWebpQualities.map(
      (quality) => Math.round(quality * 100),
    ),
    maxByteSize: maxStoryImageThumbnailDerivativeBytes,
    encode: (quality) =>
      thumbnailImage
        .clone()
        .webp({ quality, effort: 4, smartSubsample: true })
        .toBuffer(),
  })
  if (!thumbnail) {
    throw new StoryUploadError("The image thumbnail could not be generated.")
  }

  const { data: placeholderPixels, info: placeholderInfo } =
    await thumbnailImage
      .clone()
      .resize(18, 32, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  const thumbHash = Buffer.from(
    rgbaToThumbHash(placeholderInfo.width, placeholderInfo.height, placeholderPixels),
  ).toString("base64url")

  const displayContentType = displayAvif ? "image/avif" : "image/webp"
  const displayPathname = directStoryImageDisplayPathname(
    input.basePathname,
    displayContentType,
  )
  const thumbnailPathname = directStoryImageThumbnailPathname(input.basePathname)
  const outputPathnames = [displayPathname, thumbnailPathname]
  try {
    const [displayStored, thumbnailStored] =
      storageProvider === "cloudflare-r2"
        ? await Promise.all([
            putCloudflareR2DeliveryObject({
              key: displayPathname,
              body: display.body,
              contentType: displayContentType,
            }),
            putCloudflareR2DeliveryObject({
              key: thumbnailPathname,
              body: thumbnail.body,
              contentType: "image/webp",
            }),
          ])
        : await Promise.all([
            put(displayPathname, display.body, {
              access: "private",
              token: privateBlobToken(),
              addRandomSuffix: false,
              allowOverwrite: true,
              cacheControlMaxAge: 31_536_000,
              contentType: displayContentType,
            }).then((blob) => ({
              key: blob.pathname,
              url: buildStoryMediaRoute(blob.pathname),
            })),
            put(thumbnailPathname, thumbnail.body, {
              access: "private",
              token: privateBlobToken(),
              addRandomSuffix: false,
              allowOverwrite: true,
              cacheControlMaxAge: 31_536_000,
              contentType: "image/webp",
            }).then((blob) => ({
              key: blob.pathname,
              url: buildStoryMediaRoute(blob.pathname),
            })),
          ])
    if (input.deleteSourceAfterProcessing !== false) {
      if (storageProvider === "cloudflare-r2") {
        await removeCloudflareR2Original(input.source.pathname).catch(
          () => undefined,
        )
      } else {
        await del(input.source.pathname, { token: privateBlobToken() }).catch(
          () => undefined,
        )
      }
    }
    return {
      assetKind: "image",
      mediaUrl: displayStored.url,
      thumbnailUrl: thumbnailStored.url,
      placeholderUrl: `thumbhash:${thumbHash}`,
      storageProvider,
      storageKey: displayStored.key,
      contentType: displayContentType,
      byteSize: display.body.byteLength,
      checksum: createHash("sha256").update(display.body).digest("hex"),
      width: storyMediaContract.canvas.width,
      height: storyMediaContract.canvas.height,
      originalWidth: originalDimensions?.width ?? null,
      originalHeight: originalDimensions?.height ?? null,
      durationMs: null,
      processingStatus: "ready",
    }
  } catch (error) {
    if (storageProvider === "cloudflare-r2") {
      await Promise.allSettled(
        outputPathnames.map((pathname) =>
          removeCloudflareR2DeliveryObject(pathname),
        ),
      )
    } else {
      await del(outputPathnames, { token: privateBlobToken() }).catch(
        () => undefined,
      )
    }
    throw error
  }
}
