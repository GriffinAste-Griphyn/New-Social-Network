import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { like } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { mediaAssets, mobilePerformanceEvents, stories, users } from "@/lib/db/schema"
import { collectMediaDeliveryObservations } from "@/lib/media-delivery-observations"

describe.skipIf(process.env.MEDIA_TEST_ISOLATED !== "codex-media-delivery-440")("delivery observation database integration", () => {
  const prefix = `test443-${randomUUID()}`, owner = `${prefix}-owner`, viewer = `${prefix}-viewer`
  const story = `${prefix}-story`, now = new Date(), acceptedAt = new Date(now.getTime() - 10_000)
  const db = () => getDb()
  beforeAll(async () => {
    await db().insert(users).values([owner, viewer].map(id => ({ id, email: `${id}@example.invalid`, passwordHash: "not-a-login", displayName: "Isolated fixture" })))
    await db().insert(mediaAssets).values({ id: story, ownerUserId: owner, purpose: "story", assetKind: "image", storageProvider: "cloudflare-r2", storageKey: story, mediaUrl: "https://example.invalid/fixture.webp", contentType: "image/webp", byteSize: 100, checksum: "synthetic-fixture", processingStatus: "ready" })
    await db().insert(stories).values({ id: story, creatorId: owner, mediaAssetId: story, assetKind: "image", mediaUrl: "https://example.invalid/fixture.webp", storageKey: story, status: "live", moderationStatus: "approved", expiresAt: new Date(now.getTime() + 60_000) })
  })
  afterAll(async () => {
    await db().delete(mobilePerformanceEvents).where(like(mobilePerformanceEvents.id, `${prefix}%`))
    await db().delete(stories).where(like(stories.id, `${prefix}%`))
    await db().delete(mediaAssets).where(like(mediaAssets.id, `${prefix}%`))
    await db().delete(users).where(like(users.id, `${prefix}%`))
  })
  it("joins distinct devices, ignores self observations, and preserves independent timing fields", async () => {
    const metadata = { story, installation: "creator-install", build: "443", network_class: "standard" }
    await db().insert(mobilePerformanceEvents).values([
      { id: `${prefix}-accept`, userId: owner, name: "media_delivery_accepted", durationMs: 123, metadata, createdAt: acceptedAt },
      { id: `${prefix}-ready`, userId: owner, name: "media_delivery_ready", durationMs: 456, metadata, createdAt: new Date(acceptedAt.getTime() + 1000) },
      { id: `${prefix}-self`, userId: owner, name: "media_delivery_observed", durationMs: 9, metadata: { ...metadata, phase: "first_frame" }, createdAt: new Date(acceptedAt.getTime() + 2000) },
      { id: `${prefix}-same-install`, userId: viewer, name: "media_delivery_observed", durationMs: 9, metadata: { ...metadata, phase: "first_frame" }, createdAt: new Date(acceptedAt.getTime() + 2000) },
      { id: `${prefix}-feed`, userId: viewer, name: "media_delivery_observed", metadata: { ...metadata, installation: "viewer-install", phase: "feed_visible" }, createdAt: new Date(acceptedAt.getTime() + 3000) },
      { id: `${prefix}-frame`, userId: viewer, name: "media_delivery_observed", durationMs: 78, metadata: { ...metadata, installation: "viewer-install", phase: "first_frame" }, createdAt: new Date(acceptedAt.getTime() + 4000) },
    ])
    const observed = (await collectMediaDeliveryObservations(now)).find(row => row.storyId === story)
    expect(observed).toMatchObject({ tapToAcceptedMs: 123, acceptedToReadyMs: 456, viewerOpenToFrameMs: 78, feedObserved: true })
    expect(observed?.receiptToViewerMs).toBe(4000)
  })
})
