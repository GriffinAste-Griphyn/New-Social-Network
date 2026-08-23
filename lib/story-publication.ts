import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm"
import { start } from "workflow/api"

import { getDb } from "@/lib/db"
import { stories, storyPublishJobs } from "@/lib/db/schema"
import { publishStoryWorkflow } from "@/workflows/story-publication"

const activeDispatchWindowMs = 10 * 60 * 1_000

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
      workflowRunId: storyPublishJobs.workflowRunId,
      updatedAt: storyPublishJobs.updatedAt,
    })
    .from(storyPublishJobs)
    .where(eq(storyPublishJobs.storyId, storyId))
    .limit(1)

  if (
    dispatch?.status === "completed" ||
    (dispatch?.status === "running" &&
      dispatch.workflowRunId &&
      dispatch.updatedAt.getTime() > now.getTime() - activeDispatchWindowMs)
  ) {
    return dispatch.workflowRunId
  }

  try {
    const run = await start(publishStoryWorkflow, [storyId])

    await db
      .update(storyPublishJobs)
      .set({
        workflowRunId: run.runId,
        status: "running",
        attempts: sql`${storyPublishJobs.attempts} + 1`,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(storyPublishJobs.storyId, storyId))

    return run.runId
  } catch (error) {
    await db
      .update(storyPublishJobs)
      .set({
        status: "pending",
        lastError: (error instanceof Error ? error.message : String(error)).slice(
          0,
          2_000,
        ),
        updatedAt: now,
      })
      .where(eq(storyPublishJobs.storyId, storyId))
    throw error
  }
}

export async function reconcileStoryPublications(input: { limit?: number } = {}) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - activeDispatchWindowMs)
  const rows = await getDb()
    .select({ id: stories.id })
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
            or(
              ne(storyPublishJobs.status, "running"),
              lt(storyPublishJobs.updatedAt, staleBefore),
            ),
          ),
        ),
      ),
    )
    .orderBy(desc(stories.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 250))

  let enqueued = 0
  for (let index = 0; index < rows.length; index += 5) {
    const batch = rows.slice(index, index + 5)
    const results = await Promise.allSettled(
      batch.map((story) =>
        enqueueStoryPublication(story.id, { dispatch: true }),
      ),
    )
    enqueued += results.filter((result) => result.status === "fulfilled").length
  }

  return { scanned: rows.length, enqueued }
}
