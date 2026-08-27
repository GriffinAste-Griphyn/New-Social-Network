import { and, eq, gt, isNull, lt, or } from "drizzle-orm"

import { processStoryCreatorEarnings } from "@/lib/creator-earnings"
import { notifyCreatorStoryPosted } from "@/lib/creator-notifications"
import { getDb } from "@/lib/db"
import { stories, storyPublishJobs, users } from "@/lib/db/schema"
import { invalidateMobileFeedSnapshotsForCreator } from "@/lib/feed-snapshot-store"
import { fanoutStoryToFollowers } from "@/lib/feed-timeline-store"

async function readPublication(storyId: string) {
  const [publication] = await getDb()
    .select({
      storyId: stories.id,
      creatorId: stories.creatorId,
      creatorName: users.displayName,
      caption: stories.caption,
      createdAt: stories.createdAt,
    })
    .from(stories)
    .innerJoin(users, eq(stories.creatorId, users.id))
    .where(
      and(
        eq(stories.id, storyId),
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, new Date()),
      ),
    )
    .limit(1)

  return publication ?? null
}

async function readDispatch(storyId: string) {
  const [dispatch] = await getDb()
    .select()
    .from(storyPublishJobs)
    .where(eq(storyPublishJobs.storyId, storyId))
    .limit(1)

  return dispatch ?? null
}

export async function validateStoryPublicationStep(storyId: string) {
  "use step"

  const publication = await readPublication(storyId)

  if (!publication) {
    await getDb()
      .update(storyPublishJobs)
      .set({
        status: "skipped",
        lastError: "Story is not live, approved, and unexpired.",
        updatedAt: new Date(),
      })
      .where(eq(storyPublishJobs.storyId, storyId))
  }

  return publication
}

export async function processStoryPublicationEarningsStep(storyId: string) {
  "use step"

  const dispatch = await readDispatch(storyId)
  if (dispatch?.earningsCompletedAt || !(await readPublication(storyId))) return

  await processStoryCreatorEarnings(storyId)
  await getDb()
    .update(storyPublishJobs)
    .set({ earningsCompletedAt: new Date(), updatedAt: new Date() })
    .where(eq(storyPublishJobs.storyId, storyId))
}

export async function fanoutStoryPublicationStep(storyId: string) {
  "use step"

  const [dispatch, publication] = await Promise.all([
    readDispatch(storyId),
    readPublication(storyId),
  ])
  if (dispatch?.fanoutCompletedAt || !publication) return

  await fanoutStoryToFollowers({
    creatorId: publication.creatorId,
    storyId,
    createdAt: publication.createdAt,
  })
  await getDb()
    .update(storyPublishJobs)
    .set({ fanoutCompletedAt: new Date(), updatedAt: new Date() })
    .where(eq(storyPublishJobs.storyId, storyId))
}

export async function notifyStoryPublicationStep(storyId: string) {
  "use step"

  const publication = await readPublication(storyId)
  if (!publication) return

  const claimedAt = new Date()
  const staleClaimBefore = new Date(claimedAt.getTime() - 5 * 60 * 1_000)
  const [claim] = await getDb()
    .update(storyPublishJobs)
    .set({ notificationClaimedAt: claimedAt, updatedAt: claimedAt })
    .where(
      and(
        eq(storyPublishJobs.storyId, storyId),
        isNull(storyPublishJobs.notificationCompletedAt),
        or(
          isNull(storyPublishJobs.notificationClaimedAt),
          lt(storyPublishJobs.notificationClaimedAt, staleClaimBefore),
        ),
      ),
    )
    .returning({ storyId: storyPublishJobs.storyId })

  if (!claim) return

  try {
    await notifyCreatorStoryPosted({
      creatorId: publication.creatorId,
      creatorName: publication.creatorName ?? "Creator",
      storyId,
      caption: publication.caption,
    })
    await getDb()
      .update(storyPublishJobs)
      .set({ notificationCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(storyPublishJobs.storyId, storyId))
  } catch (error) {
    await getDb()
      .update(storyPublishJobs)
      .set({ notificationClaimedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(storyPublishJobs.storyId, storyId),
          eq(storyPublishJobs.notificationClaimedAt, claimedAt),
          isNull(storyPublishJobs.notificationCompletedAt),
        ),
      )
    throw error
  }
}

export async function invalidateStoryPublicationSnapshotsStep(storyId: string) {
  "use step"

  const [dispatch, publication] = await Promise.all([
    readDispatch(storyId),
    readPublication(storyId),
  ])
  if (dispatch?.snapshotInvalidatedAt || !publication) return

  await invalidateMobileFeedSnapshotsForCreator(publication.creatorId)
  await getDb()
    .update(storyPublishJobs)
    .set({ snapshotInvalidatedAt: new Date(), updatedAt: new Date() })
    .where(eq(storyPublishJobs.storyId, storyId))
}

export async function completeStoryPublicationStep(storyId: string) {
  "use step"

  const now = new Date()
  await getDb()
    .update(storyPublishJobs)
    .set({
      status: "completed",
      completedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(storyPublishJobs.storyId, storyId))
}

export async function failStoryPublicationStep(storyId: string, message: string) {
  "use step"

  await getDb()
    .update(storyPublishJobs)
    .set({
      status: "pending",
      lastError: message.slice(0, 2_000),
      updatedAt: new Date(),
    })
    .where(eq(storyPublishJobs.storyId, storyId))
}
