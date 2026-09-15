import { randomUUID, createHash } from "node:crypto"
import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { imageProcessingJobs, mediaAssets, mediaBackgroundJobs, stories } from "@/lib/db/schema"
import { mediaQueueMessageSchema, InvalidMediaQueueMessage } from "@/lib/media-priority-queue"
import { withMediaWorkerSlot } from "@/lib/media-worker-capacity"
import { fanoutStoryFollowerBatch } from "@/lib/feed-timeline-store"
import { invalidateMobileFeedSnapshot } from "@/lib/feed-snapshot-store"
import { encodeStoryImageDelivery } from "@/lib/story-image-processing"
import { putCloudflareR2DeliveryObject, readCloudflareR2Original, removeCloudflareR2DeliveryObject } from "@/lib/cloudflare-r2"
import { dispatchBackgroundMediaJob, enqueueImageEnhancement, enqueueFeedFanout, type BackgroundMediaKind } from "@/lib/media-background-dispatch"

type Job = typeof mediaBackgroundJobs.$inferSelect
const maximumAttempts = 8

export function backgroundJobRetrySeconds(attempt: number) {
  return Math.min(300, 5 * 2 ** Math.min(Math.max(attempt - 1, 0), 6))
}

async function enhanceImage(job: Job, ownerToken: string): Promise<number> {
  if (process.env.MEDIA_IMAGE_AVIF_ENHANCEMENT_ENABLED === "false") return 300
  const db = getDb()
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, job.mediaAssetId!)).limit(1)
  if (!asset || asset.deletedAt || asset.processingStatus !== "ready" ||
      asset.storageKey !== job.payload.expectedKey || asset.originalStorageProvider !== "cloudflare-r2") return 0
  const references = await db.select({ creatorId: stories.creatorId, status: stories.status, moderationStatus: stories.moderationStatus })
    .from(stories).where(and(eq(stories.mediaAssetId, asset.id), gt(stories.expiresAt, new Date()),
      inArray(stories.status, ["live", "processing"])))
  if (!references.length) return 0
  // Do not change media while it is being scanned or revive withheld content.
  if (!references.some(story => story.status === "live" && story.moderationStatus === "approved")) {
    return references.some(story => story.moderationStatus === "pending") ? 60 : 0
  }
  if (!asset.originalStorageKey || !asset.originalChecksum || !asset.originalByteSize) return 0
  const source = await readCloudflareR2Original(asset.originalStorageKey)
  if (source.length !== asset.originalByteSize || createHash("sha256").update(source).digest("hex") !== asset.originalChecksum) {
    throw new Error("Image enhancement source integrity check failed")
  }
  const output = await encodeStoryImageDelivery(source, job.payload.contentMode === "fill" ? "fill" : "fit", "avif")
  // AVIF is an optional bandwidth enhancement. Keep WebP if there is no saving.
  if (output.displayContentType !== "image/avif" || output.display.size >= asset.byteSize * 0.95) return 0
  const key = `${job.payload.basePathname}-enhanced-v1-display.avif`
  const stored = await putCloudflareR2DeliveryObject({ key, body: output.display.body, contentType: "image/avif" })
  const promoted = await db.transaction(async tx => {
    // Hold the ownership row while promoting, so an expired worker cannot win a race.
    const lease = await tx.execute(sql`SELECT id FROM media_background_jobs
      WHERE id = ${job.id} AND owner_token = ${ownerToken} AND status = 'processing'
        AND lease_expires_at > now() FOR UPDATE`)
    if (!lease.rows.length) return false
    const values = { storageKey: stored.key, mediaUrl: stored.url, contentType: "image/avif",
      byteSize: output.display.size, checksum: createHash("sha256").update(output.display.body).digest("hex") }
    const updated = await tx.update(mediaAssets).set({ ...values, updatedAt: new Date() })
      .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.storageKey, job.payload.expectedKey),
        eq(mediaAssets.processingStatus, "ready"), isNull(mediaAssets.deletedAt))).returning({ id: mediaAssets.id })
    if (!updated.length) return false
    await tx.update(stories).set(values).where(and(eq(stories.mediaAssetId, asset.id),
      eq(stories.storageKey, job.payload.expectedKey), eq(stories.status, "live"),
      eq(stories.moderationStatus, "approved"), gt(stories.expiresAt, new Date())))
    return true
  })
  if (!promoted) {
    const [current] = await db.select({ deletedAt: mediaAssets.deletedAt }).from(mediaAssets).where(eq(mediaAssets.id, asset.id)).limit(1)
    if (!current || current.deletedAt) await removeCloudflareR2DeliveryObject(key)
  }
  if (promoted) await Promise.all([...new Set(references.map(story => story.creatorId))]
    .map(id => invalidateMobileFeedSnapshot(id)))
  return 0
}

async function fanoutBatch(job: Job) {
  const [story] = await getDb().select({ id: stories.id, creatorId: stories.creatorId, createdAt: stories.createdAt })
    .from(stories).where(and(eq(stories.id, job.storyId!), eq(stories.status, "live"),
      eq(stories.moderationStatus, "approved"), gt(stories.expiresAt, new Date()))).limit(1)
  if (!story) return
  const result = await fanoutStoryFollowerBatch({ ...story, storyId: story.id, cursor: job.payload.cursor || null })
  // The next batch is durable before this one completes; duplicate envelopes are harmless.
  if (result.nextCursor) await enqueueFeedFanout(story.id, result.nextCursor)
}

export async function runBackgroundMediaJob(id: string, kind: BackgroundMediaKind) {
  return withMediaWorkerSlot(kind, async () => {
    const db = getDb(), token = randomUUID(), now = new Date()
    const [job] = await db.update(mediaBackgroundJobs).set({ status: "processing", ownerToken: token,
      attempts: sql`${mediaBackgroundJobs.attempts} + 1`, leaseExpiresAt: new Date(now.getTime() + 300_000), updatedAt: now })
      .where(and(eq(mediaBackgroundJobs.id, id), eq(mediaBackgroundJobs.kind, kind),
        lt(mediaBackgroundJobs.attempts, maximumAttempts), lte(mediaBackgroundJobs.availableAt, now),
        or(eq(mediaBackgroundJobs.status, "pending"),
          and(eq(mediaBackgroundJobs.status, "processing"), lt(mediaBackgroundJobs.leaseExpiresAt, now)))))
      .returning()
    if (!job) return
    const owns = and(eq(mediaBackgroundJobs.id, id), eq(mediaBackgroundJobs.ownerToken, token))
    try {
      const deferSeconds = kind === "imageEnhancement" ? await enhanceImage(job, token) : (await fanoutBatch(job), 0)
      await db.update(mediaBackgroundJobs).set({ status: deferSeconds ? "pending" : "ready", ownerToken: null,
        leaseExpiresAt: null, lastError: null, updatedAt: new Date(),
        ...(deferSeconds ? { attempts: sql`${mediaBackgroundJobs.attempts} - 1`, availableAt: new Date(Date.now() + deferSeconds * 1000) } : {}) })
        .where(owns)
      console.info("media_background_completed", { kind, id, deferred: deferSeconds > 0, processingMs: Date.now() - now.getTime() })
    } catch (error) {
      await db.update(mediaBackgroundJobs).set({ status: job.attempts >= maximumAttempts ? "error" : "pending",
        ownerToken: null, leaseExpiresAt: null, updatedAt: new Date(),
        availableAt: new Date(Date.now() + backgroundJobRetrySeconds(job.attempts) * 1000),
        lastError: error instanceof Error ? error.message.slice(0, 1000) : "Background media failed" }).where(owns)
      throw error
    }
  })
}

export async function consumeBackgroundMediaMessage(payload: unknown, kind: BackgroundMediaKind) {
  const result = mediaQueueMessageSchema.safeParse(payload)
  if (!result.success) throw new InvalidMediaQueueMessage("Invalid background media envelope")
  const parsed = result.data
  const prefix = kind === "imageEnhancement" ? "background-image-" : "background-feed-"
  if (!parsed.jobId.startsWith(prefix)) throw new InvalidMediaQueueMessage("Incorrect background media lane")
  console.info("media_background_queue_wait", { kind, queueWaitMs: Math.max(0, Date.now() - parsed.enqueuedAt) })
  await runBackgroundMediaJob(parsed.jobId, kind)
}

export async function reconcileBackgroundMediaJobs() {
  const db = getDb(), now = new Date()
  await db.update(mediaBackgroundJobs).set({ status: "error", lastError: "Final worker lease expired", updatedAt: now })
    .where(and(eq(mediaBackgroundJobs.status, "processing"), lt(mediaBackgroundJobs.leaseExpiresAt, now),
      sql`${mediaBackgroundJobs.attempts} >= ${maximumAttempts}`))
  const rows = await db.select().from(mediaBackgroundJobs).where(and(lt(mediaBackgroundJobs.attempts, maximumAttempts),
    lte(mediaBackgroundJobs.availableAt, now), or(eq(mediaBackgroundJobs.status, "pending"),
      and(eq(mediaBackgroundJobs.status, "processing"), lt(mediaBackgroundJobs.leaseExpiresAt, now)))))
    .orderBy(asc(mediaBackgroundJobs.availableAt)).limit(25)
  const results = await Promise.allSettled(rows.map(job => dispatchBackgroundMediaJob(job.id, job.kind as BackgroundMediaKind)))
  // Recover an interruption between initial image completion and enhancement enqueue.
  const images = await db.select({ id: imageProcessingJobs.id }).from(imageProcessingJobs)
    .innerJoin(mediaAssets, eq(imageProcessingJobs.mediaAssetId, mediaAssets.id))
    .leftJoin(mediaBackgroundJobs, eq(mediaBackgroundJobs.mediaAssetId, mediaAssets.id))
    .where(and(eq(imageProcessingJobs.status, "ready"), eq(mediaAssets.storageProvider, "cloudflare-r2"),
      sql`${mediaAssets.storageKey} LIKE '%-fast-v1-display.webp'`, isNull(mediaAssets.deletedAt),
      isNull(mediaBackgroundJobs.id))).limit(10)
  await Promise.allSettled(images.map(job => enqueueImageEnhancement(job.id)))
  await db.delete(mediaBackgroundJobs).where(and(eq(mediaBackgroundJobs.status, "ready"),
    lt(mediaBackgroundJobs.updatedAt, new Date(Date.now() - 7 * 86400_000))))
  return { scanned: rows.length, scheduled: results.filter(result => result.status === "fulfilled").length }
}
