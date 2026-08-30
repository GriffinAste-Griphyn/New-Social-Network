import { del, get, put } from "@vercel/blob"
import { and, asc, eq, gt, like, notLike } from "drizzle-orm"
import sharp from "sharp"

import { getDb } from "@/lib/db"
import { stories } from "@/lib/db/schema"
import { highestQualityImageWithinBudget } from "@/lib/story-image-encoding"
import { buildStoryMediaRoute } from "@/lib/story-media/access"
import { storyMediaContract } from "@/lib/story-media-contract"
import {
  maxStoryImageThumbnailDerivativeBytes,
  StoryUploadError,
} from "@/lib/story-storage"

function privateBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new StoryUploadError("Image processing is not configured.")
  return token
}

function fitThumbnailPathname(storageKey: string) {
  const match = storageKey.match(/^(.*)-display\.(?:avif|webp)$/i)
  return match ? `${match[1]}-fit-thumb.webp` : null
}

async function encodeFitThumbnail(sourceBody: Buffer) {
  const image = sharp(sourceBody, {
    autoOrient: true,
    failOn: "warning",
    limitInputPixels: 80_000_000,
  }).resize(storyMediaContract.thumbnail.width, storyMediaContract.thumbnail.height, {
    fit: "contain",
    position: "centre",
    kernel: sharp.kernel.lanczos3,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })

  const encoded = await highestQualityImageWithinBudget({
    qualities: [85, 80, 75, 70, 65, 60],
    maxByteSize: maxStoryImageThumbnailDerivativeBytes,
    encode: async (quality) => {
      const body = await image
        .clone()
        .webp({ quality, effort: 6, smartSubsample: true })
        .toBuffer()
      return { body, size: body.byteLength, quality }
    },
  })
  if (!encoded) {
    throw new StoryUploadError("The image thumbnail could not be generated.")
  }

  return encoded.body
}

export async function backfillActiveStoryFitThumbnails(
  input: { limit?: number } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50)
  const db = getDb()
  const candidates = await db
    .select({
      id: stories.id,
      storageKey: stories.storageKey,
      thumbnailUrl: stories.thumbnailUrl,
    })
    .from(stories)
    .where(
      and(
        eq(stories.assetKind, "image"),
        eq(stories.status, "live"),
        gt(stories.expiresAt, new Date()),
        eq(stories.storageProvider, "vercel-blob"),
        like(stories.thumbnailUrl, "%-thumb.webp%"),
        notLike(stories.thumbnailUrl, "%-fit-thumb.webp%"),
      ),
    )
    .orderBy(asc(stories.createdAt))
    .limit(limit)

  let updated = 0
  const failures: Array<{ id: string; reason: string }> = []

  for (const candidate of candidates) {
    const targetPathname = candidate.storageKey
      ? fitThumbnailPathname(candidate.storageKey)
      : null
    if (!targetPathname || !candidate.thumbnailUrl) {
      failures.push({ id: candidate.id, reason: "unsupported story asset" })
      continue
    }

    try {
      const source = await get(candidate.storageKey!, {
        access: "private",
        token: privateBlobToken(),
        useCache: false,
      })
      if (!source || source.statusCode !== 200 || !source.stream) {
        throw new Error(
          `Could not read playback image (${source?.statusCode ?? "missing"}).`,
        )
      }

      const sourceBody = Buffer.from(
        await new Response(source.stream).arrayBuffer(),
      )
      const thumbnailBody = await encodeFitThumbnail(sourceBody)
      const uploaded = await put(targetPathname, thumbnailBody, {
        access: "private",
        token: privateBlobToken(),
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 31_536_000,
        contentType: "image/webp",
      })
      if (uploaded.pathname !== targetPathname) {
        throw new Error("Blob pathname mismatch.")
      }

      const changed = await db
        .update(stories)
        .set({ thumbnailUrl: buildStoryMediaRoute(targetPathname) })
        .where(
          and(
            eq(stories.id, candidate.id),
            eq(stories.thumbnailUrl, candidate.thumbnailUrl),
          ),
        )
        .returning({ id: stories.id })
      if (changed.length !== 1) {
        await del(targetPathname, { token: privateBlobToken() }).catch(
          () => undefined,
        )
        throw new Error("Story changed while its thumbnail was being generated.")
      }

      updated += 1
    } catch (error) {
      failures.push({
        id: candidate.id,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    scanned: candidates.length,
    updated,
    failed: failures.length,
    failures,
  }
}
