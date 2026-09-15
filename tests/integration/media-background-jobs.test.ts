import { randomUUID, createHash } from "node:crypto"
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { and, eq, like } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { mediaAssets, mediaBackgroundJobs, stories, users } from "@/lib/db/schema"
import { withMediaWorkerSlot, MediaWorkerCapacityUnavailable } from "@/lib/media-worker-capacity"
import { runBackgroundMediaJob } from "@/lib/media-background-jobs"
import { encodeStoryImageDelivery } from "@/lib/story-image-processing"
import { readCloudflareR2Original, putCloudflareR2DeliveryObject } from "@/lib/cloudflare-r2"
import { fanoutStoryFollowerBatch } from "@/lib/feed-timeline-store"

vi.mock("@/lib/media-dispatch", () => ({ dispatchMediaTask: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/feed-snapshot-store", () => ({ invalidateMobileFeedSnapshot: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/feed-timeline-store", () => ({ fanoutStoryFollowerBatch: vi.fn().mockResolvedValue({ nextCursor: null, viewerCount: 1 }) }))
vi.mock("@/lib/story-image-processing", () => ({ encodeStoryImageDelivery: vi.fn() }))
vi.mock("@/lib/cloudflare-r2", () => ({ readCloudflareR2Original: vi.fn(), putCloudflareR2DeliveryObject: vi.fn(), removeCloudflareR2DeliveryObject: vi.fn().mockResolvedValue(undefined) }))

// Only run with an explicitly selected disposable database branch. Provider I/O
// and dispatch are mocked; the actual Drizzle transactions/leases are exercised.
describe.skipIf(process.env.MEDIA_TEST_ISOLATED !== "codex-media-delivery-440")("background media database integration", () => {
  const prefix = `test440-${randomUUID()}`
  const source = Buffer.from("verified source"), display = Buffer.from("avif")
  let userId: string
  const db = () => getDb()
  async function fixture(kind: "imageEnhancement" | "feedFanout" = "imageEnhancement") {
    const id = `${prefix}-${randomUUID()}`, base = `stories/web-direct/${userId}/${id}`
    const key = `${base}-fast-v1-display.webp`
    await db().insert(mediaAssets).values({ id, ownerUserId: userId, purpose: "story", assetKind: "image",
      storageProvider: "cloudflare-r2", storageKey: key, mediaUrl: `https://media.example/${key}`,
      contentType: "image/webp", byteSize: 1000, checksum: "old", processingStatus: "ready",
      originalStorageProvider: "cloudflare-r2", originalStorageKey: `${base}-source.jpg`,
      originalByteSize: source.length, originalChecksum: createHash("sha256").update(source).digest("hex") })
    await db().insert(stories).values({ id, creatorId: userId, mediaAssetId: id, assetKind: "image",
      mediaUrl: `https://media.example/${key}`, storageKey: key, status: "live", moderationStatus: "approved",
      expiresAt: new Date(Date.now() + 600_000) })
    await db().insert(mediaBackgroundJobs).values({ id, kind, mediaAssetId: id, storyId: id,
      payload: { basePathname: base, expectedKey: key, contentMode: "fit", cursor: "" } })
    return id
  }
  async function job(id: string) { return (await db().select().from(mediaBackgroundJobs).where(eq(mediaBackgroundJobs.id, id)))[0] }
  beforeAll(async () => {
    userId = prefix
    await db().insert(users).values({ id: userId, email: `${prefix}@example.invalid`, passwordHash: "not-a-login", displayName: "Isolated fixture" })
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readCloudflareR2Original).mockResolvedValue(source)
    vi.mocked(encodeStoryImageDelivery).mockResolvedValue({ displayContentType: "image/avif", display: { body: display, size: 4 } } as never)
    vi.mocked(putCloudflareR2DeliveryObject).mockImplementation(async ({ key }) => ({ key, url: `https://media.example/${key}` }))
    vi.mocked(fanoutStoryFollowerBatch).mockResolvedValue({ nextCursor: null, viewerCount: 1 })
  })
  afterAll(async () => {
    await db().delete(mediaBackgroundJobs).where(like(mediaBackgroundJobs.id, `%${prefix}%`))
    await db().delete(stories).where(eq(stories.creatorId, userId))
    await db().delete(mediaAssets).where(eq(mediaAssets.ownerUserId, userId))
    await db().delete(users).where(eq(users.id, userId))
  })
  it("bounds a burst of 20 workers at configured capacity", async () => {
    vi.stubEnv("MEDIA_WORKERS_FEED_FANOUT", "4")
    let active = 0, peak = 0
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => withMediaWorkerSlot("feedFanout", async () => {
      active += 1; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 500))
      active -= 1
    })))
    vi.unstubAllEnvs()
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(4)
    for (const result of results) if (result.status === "rejected") expect(result.reason).toBeInstanceOf(MediaWorkerCapacityUnavailable)
  })
  it("promotes once when duplicate messages race, retaining story approval", async () => {
    const id = await fixture()
    await Promise.all([runBackgroundMediaJob(id, "imageEnhancement"), runBackgroundMediaJob(id, "imageEnhancement").catch(() => undefined)])
    await runBackgroundMediaJob(id, "imageEnhancement")
    expect(encodeStoryImageDelivery).toHaveBeenCalledOnce()
    expect((await job(id)).status).toBe("ready")
    const [story] = await db().select().from(stories).where(eq(stories.id, id))
    expect(story.contentType).toBe("image/avif")
    expect(story.status).toBe("live")
    expect(story.moderationStatus).toBe("approved")
  })
  it("leaves pending moderation untouched without consuming an error attempt", async () => {
    const id = await fixture()
    await db().update(stories).set({ status: "processing", moderationStatus: "pending" }).where(eq(stories.id, id))
    await runBackgroundMediaJob(id, "imageEnhancement")
    expect(encodeStoryImageDelivery).not.toHaveBeenCalled()
    expect(await job(id)).toMatchObject({ status: "pending", attempts: 0 })
  })
  it("does not publish a late result after a story is removed", async () => {
    const id = await fixture()
    vi.mocked(putCloudflareR2DeliveryObject).mockImplementationOnce(async ({ key }) => {
      await db().update(stories).set({ status: "removed" }).where(eq(stories.id, id))
      await db().update(mediaAssets).set({ deletedAt: new Date(), processingStatus: "deleted" }).where(eq(mediaAssets.id, id))
      return { key, url: `https://media.example/${key}` }
    })
    await runBackgroundMediaJob(id, "imageEnhancement")
    const [story] = await db().select().from(stories).where(eq(stories.id, id))
    expect(story.status).toBe("removed")
    expect(story.storageKey).toContain("-fast-v1-display.webp")
  })
  it("rejects changed originals and retains the first display after failure", async () => {
    const id = await fixture()
    vi.mocked(readCloudflareR2Original).mockResolvedValueOnce(Buffer.from("changed"))
    await expect(runBackgroundMediaJob(id, "imageEnhancement")).rejects.toThrow("integrity")
    expect(await job(id)).toMatchObject({ status: "pending", attempts: 1 })
    expect(encodeStoryImageDelivery).not.toHaveBeenCalled()
  })
  it("fences an expired worker before changing a delivered image", async () => {
    const id = await fixture()
    vi.mocked(putCloudflareR2DeliveryObject).mockImplementationOnce(async ({ key }) => {
      await db().update(mediaBackgroundJobs).set({ ownerToken: "replacement" }).where(eq(mediaBackgroundJobs.id, id))
      return { key, url: `https://media.example/${key}` }
    })
    await runBackgroundMediaJob(id, "imageEnhancement")
    expect(await job(id)).toMatchObject({ ownerToken: "replacement", status: "processing" })
    const [asset] = await db().select().from(mediaAssets).where(eq(mediaAssets.id, id))
    expect(asset.contentType).toBe("image/webp")
  })
  it("persists the next follower page before completing the current one", async () => {
    const id = await fixture("feedFanout")
    vi.mocked(fanoutStoryFollowerBatch).mockResolvedValueOnce({ nextCursor: "follower-250", viewerCount: 250 })
    await runBackgroundMediaJob(id, "feedFanout")
    expect((await job(id)).status).toBe("ready")
    const rows = await db().select().from(mediaBackgroundJobs).where(and(eq(mediaBackgroundJobs.storyId, id), eq(mediaBackgroundJobs.status, "pending")))
    expect(rows).toHaveLength(1)
    expect(rows[0].payload.cursor).toBe("follower-250")
  })
  it("does not repeat completed jobs or consume a message from the wrong lane", async () => {
    const id = await fixture("feedFanout")
    await runBackgroundMediaJob(id, "imageEnhancement")
    expect((await job(id)).status).toBe("pending")
    await runBackgroundMediaJob(id, "feedFanout")
    await runBackgroundMediaJob(id, "feedFanout")
    expect(fanoutStoryFollowerBatch).toHaveBeenCalledOnce()
  })
})
