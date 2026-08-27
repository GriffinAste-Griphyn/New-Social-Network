import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm"
import { start } from "workflow/api"

import { getDb } from "@/lib/db"
import { stories, storyPublishJobs } from "@/lib/db/schema"
import { areDurableMediaWorkersEnabled } from "@/lib/media-pipeline/features"
import {
  completeStoryPublicationStep,
  failStoryPublicationStep,
  fanoutStoryPublicationStep,
  invalidateStoryPublicationSnapshotsStep,
  notifyStoryPublicationStep,
  processStoryPublicationEarningsStep,
  validateStoryPublicationStep,
} from "@/workflows/story-publication/steps"
import { publishStoryWorkflow } from "@/workflows/story-publication"

const activeDispatchWindowMs = 10 * 60 * 1_000
export const maxStoryPublicationAttempts = 4
const maxDispatchBackoffMs = 6 * 60 * 60 * 1_000

export function storyPublicationRetryDelayMs(attempts: number) {
  if (attempts <= 0) return 0

  return Math.min(
    activeDispatchWindowMs * 2 ** Math.max(0, attempts - 1),
    maxDispatchBackoffMs,
  )
}

export function isStoryPublicationDispatchDue(input: {
  status: string | null
  attempts: number | null
  updatedAt: Date | null
  now?: Date
}) {
  if (input.status === "completed") return false

  const attempts = input.attempts ?? 0
  if (attempts >= maxStoryPublicationAttempts) return false
  if (attempts === 0 || !input.updatedAt) return true

  const now = input.now ?? new Date()
  return (
    input.updatedAt.getTime() <=
    now.getTime() - storyPublicationRetryDelayMs(attempts)
  )
}

async function processStoryPublicationDirect(storyId: string) {
  const publication = await validateStoryPublicationStep(storyId)
  if (!publication) return false

  try {
    await Promise.all([
      processStoryPublicationEarningsStep(storyId),
      fanoutStoryPublicationStep(storyId),
      notifyStoryPublicationStep(storyId),
      invalidateStoryPublicationSnapshotsStep(storyId),
    ])
    await completeStoryPublicationStep(storyId)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failStoryPublicationStep(storyId, message)
    throw error
  }
}

export async function enqueueStoryPublication(
  storyId: string,
  options: { dispatch?: boolean } = {},
) {
  const db = getDb()
  const now = new Date()

  await db
    .insert(storyPublishJobs)
    .values({ storyId, updatedAt: now })
    .onConflictDoNothing({ target: storyPublishJobs.storyId })

  // Dispatch immediately so a successful upload reaches follower timelines even
  // when the scheduled reconciler is delayed. The durable outbox row remains the
  // recovery source, and callers can explicitly opt out during bulk operations.
  if (options.dispatch === false) {
    return null
  }

  const [dispatch] = await db
    .select({
      status: storyPublishJobs.status,
      attempts: storyPublishJobs.attempts,
      updatedAt: storyPublishJobs.updatedAt,
    })
    .from(storyPublishJobs)
    .where(eq(storyPublishJobs.storyId, storyId))
    .limit(1)

  if (dispatch?.status === "completed") return storyId

  if ((dispatch?.attempts ?? 0) >= maxStoryPublicationAttempts) {
    await db
      .update(storyPublishJobs)
      .set({ status: "failed", updatedAt: now })
      .where(eq(storyPublishJobs.storyId, storyId))
    return null
  }

  if (
    dispatch &&
    !isStoryPublicationDispatchDue({
      status: dispatch.status,
      attempts: dispatch.attempts,
      updatedAt: dispatch.updatedAt,
      now,
    })
  ) {
    return null
  }

  const currentStatus = dispatch?.status ?? "pending"
  const currentAttempts = dispatch?.attempts ?? 0
  let claimedAttempt: number | null = null
  try {
    const [claim] = await db
      .update(storyPublishJobs)
      .set({
        workflowRunId: null,
        status: "running",
        attempts: sql`${storyPublishJobs.attempts} + 1`,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(storyPublishJobs.storyId, storyId),
          eq(storyPublishJobs.status, currentStatus),
          eq(storyPublishJobs.attempts, currentAttempts),
        ),
      )
      .returning({ attempts: storyPublishJobs.attempts })

    if (!claim) return null
    claimedAttempt = claim.attempts

    if (!areDurableMediaWorkersEnabled()) {
      const completed = await processStoryPublicationDirect(storyId)
      return completed ? storyId : null
    }

    const run = await start(publishStoryWorkflow, [storyId])
    await db
      .update(storyPublishJobs)
      .set({ workflowRunId: run.runId, updatedAt: new Date() })
      .where(
        and(
          eq(storyPublishJobs.storyId, storyId),
          eq(storyPublishJobs.status, "running"),
          eq(storyPublishJobs.attempts, claimedAttempt),
        ),
      )
    return run.runId
  } catch (error) {
    await db
      .update(storyPublishJobs)
      .set({
        status: "pending",
        lastError: error instanceof Error ? error.message.slice(0, 2_000) : String(error),
        updatedAt: new Date(),
      })
      .where(eq(storyPublishJobs.storyId, storyId))
    if (
      claimedAttempt !== null &&
      claimedAttempt >= maxStoryPublicationAttempts
    ) {
      await db
        .update(storyPublishJobs)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(storyPublishJobs.storyId, storyId))
    }
    throw error
  }
}

export async function reconcileStoryPublications(input: { limit?: number } = {}) {
  const now = new Date()
  const requestedLimit = Math.min(Math.max(input.limit ?? 100, 1), 250)
  const rows = await getDb()
    .select({
      id: stories.id,
      publishStatus: storyPublishJobs.status,
      publishAttempts: storyPublishJobs.attempts,
      publishUpdatedAt: storyPublishJobs.updatedAt,
    })
    .from(stories)
    .leftJoin(
      storyPublishJobs,
      eq(storyPublishJobs.storyId, stories.id),
    )
    .where(
      and(
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, now),
        or(
          isNull(storyPublishJobs.storyId),
          and(
            ne(storyPublishJobs.status, "completed"),
            lt(storyPublishJobs.attempts, maxStoryPublicationAttempts),
          ),
        ),
      ),
    )
    .orderBy(desc(stories.createdAt))
    .limit(250)

  const dueRows = rows
    .filter((story) =>
      isStoryPublicationDispatchDue({
        status: story.publishStatus,
        attempts: story.publishAttempts,
        updatedAt: story.publishUpdatedAt,
        now,
      }),
    )
    .slice(0, requestedLimit)

  let enqueued = 0
  for (let index = 0; index < dueRows.length; index += 5) {
    const batch = dueRows.slice(index, index + 5)
    const results = await Promise.allSettled(
      batch.map((story) =>
        enqueueStoryPublication(story.id, { dispatch: true }),
      ),
    )
    enqueued += results.filter((result) => result.status === "fulfilled").length
  }

  return { scanned: rows.length, enqueued }
}
