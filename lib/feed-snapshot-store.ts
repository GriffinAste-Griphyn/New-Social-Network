import { and, eq, gt, inArray } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { follows, mobileFeedSnapshots } from "@/lib/db/schema"
import type { FeedData } from "@/lib/story-store"

const mobileFeedSnapshotTtlMs = 60 * 1000
const mobileFeedSnapshotVersion = "mobile-feed:v2-playback-renditions"
let snapshotTableUnavailableUntil = 0

function snapshotExpiresAt() {
  return new Date(Date.now() + mobileFeedSnapshotTtlMs)
}

function serializeFeedData(feed: FeedData) {
  return JSON.parse(JSON.stringify(feed)) as FeedData
}

function snapshotsAreTemporarilyDisabled() {
  return Date.now() < snapshotTableUnavailableUntil
}

function disableSnapshotsBriefly() {
  snapshotTableUnavailableUntil = Date.now() + 5 * 60 * 1000
}

function isMissingSnapshotTableError(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    return (error as { code?: string }).code === "42P01"
  }

  return error instanceof Error && error.message.includes("mobile_feed_snapshots")
}

export async function readMobileFeedSnapshot(viewerId: string) {
  if (snapshotsAreTemporarilyDisabled()) {
    return null
  }

  try {
    const [snapshot] = await getDb()
      .select({
        payload: mobileFeedSnapshots.payload,
      })
      .from(mobileFeedSnapshots)
      .where(eq(mobileFeedSnapshots.viewerId, viewerId))
      .limit(1)

    if (!snapshot) {
      return null
    }

    return snapshot.payload as FeedData
  } catch (error) {
    if (isMissingSnapshotTableError(error)) {
      disableSnapshotsBriefly()
      return null
    }

    throw error
  }
}

export async function readFreshMobileFeedSnapshot(viewerId: string) {
  if (snapshotsAreTemporarilyDisabled()) {
    return null
  }

  try {
    const [snapshot] = await getDb()
      .select({
        payload: mobileFeedSnapshots.payload,
      })
      .from(mobileFeedSnapshots)
      .where(
        and(
          eq(mobileFeedSnapshots.viewerId, viewerId),
          eq(mobileFeedSnapshots.sourceFingerprint, mobileFeedSnapshotVersion),
          gt(mobileFeedSnapshots.expiresAt, new Date()),
        ),
      )
      .limit(1)

    if (!snapshot) {
      return null
    }

    return snapshot.payload as FeedData
  } catch (error) {
    if (isMissingSnapshotTableError(error)) {
      disableSnapshotsBriefly()
      return null
    }

    throw error
  }
}

export async function writeMobileFeedSnapshot(viewerId: string, feed: FeedData) {
  if (snapshotsAreTemporarilyDisabled()) {
    return
  }

  const now = new Date()

  try {
    await getDb()
      .insert(mobileFeedSnapshots)
      .values({
        viewerId,
        payload: serializeFeedData(feed),
        sourceFingerprint: mobileFeedSnapshotVersion,
        createdAt: now,
        updatedAt: now,
        expiresAt: snapshotExpiresAt(),
      })
      .onConflictDoUpdate({
        target: mobileFeedSnapshots.viewerId,
        set: {
          payload: serializeFeedData(feed),
          sourceFingerprint: mobileFeedSnapshotVersion,
          updatedAt: now,
          expiresAt: snapshotExpiresAt(),
        },
      })
  } catch (error) {
    if (isMissingSnapshotTableError(error)) {
      disableSnapshotsBriefly()
      return
    }

    throw error
  }
}

export async function invalidateMobileFeedSnapshots(viewerIds: string[]) {
  if (snapshotsAreTemporarilyDisabled()) {
    return
  }

  const uniqueViewerIds = [...new Set(viewerIds.filter(Boolean))]

  if (uniqueViewerIds.length === 0) {
    return
  }

  try {
    await getDb()
      .delete(mobileFeedSnapshots)
      .where(inArray(mobileFeedSnapshots.viewerId, uniqueViewerIds))
  } catch (error) {
    if (isMissingSnapshotTableError(error)) {
      disableSnapshotsBriefly()
      return
    }

    throw error
  }
}

export async function invalidateMobileFeedSnapshot(viewerId: string) {
  await invalidateMobileFeedSnapshots([viewerId])
}

export async function invalidateMobileFeedSnapshotsForCreator(creatorId: string) {
  if (snapshotsAreTemporarilyDisabled()) {
    return
  }

  const followerRows = await getDb()
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(eq(follows.followeeId, creatorId))

  await invalidateMobileFeedSnapshots([
    creatorId,
    ...followerRows.map((row) => row.followerId),
  ])
}
