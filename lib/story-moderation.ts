import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm"
import { after } from "next/server"
import { start } from "workflow/api"

import { getDb } from "@/lib/db"
import { stories } from "@/lib/db/schema"
import { isWorkflowDispatchEnabled } from "@/lib/media-pipeline/features"
import { retryableStoryModerationReasons } from "@/lib/safety/moderation-retry"
import { moderatePendingStory } from "@/lib/story-moderation-core"
import { moderateStoryWorkflow } from "@/workflows/story-moderation"
import { claimStoryModerationDispatch } from "@/lib/story-moderation-dispatch"

export async function enqueueStoryModeration(storyId: string) {
  const claim = await claimStoryModerationDispatch(storyId)
  if (!claim) return { storyId, runId: null, deduplicated: true }
  try {
    if (!isWorkflowDispatchEnabled()) {
      after(async () => {
        try {
          const result = await moderatePendingStory(storyId)
          console.info("story_moderation_direct_finished", { storyId, result })
        } catch (error) {
          console.error("story_moderation_direct_failed", { storyId, error })
        }
      })
      return { storyId, runId: null }
    }
    const run = await start(moderateStoryWorkflow, [storyId])
    console.info("story_moderation_workflow_started", { storyId, runId: run.runId })
    return { storyId, runId: run.runId }
  } catch (error) {
    await claim.release().catch((releaseError) => {
      console.error("story_moderation_dispatch_release_failed", { storyId, error: releaseError })
    })
    throw error
  }
}

export async function reconcilePendingStoryModeration(
  input: { limit?: number } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  // Completed work removes its own lease. Reap only expired crash leftovers.
  await getDb().execute(sql`DELETE FROM media_worker_leases
    WHERE (lane LIKE 'storyModeration:%' OR lane LIKE 'storyModerationDispatch:%')
      AND expires_at <= now()`)
    .catch((error) => console.error("story_moderation_lease_cleanup_failed", { error }))
  const rows = await getDb()
    .select({ id: stories.id })
    .from(stories)
    .where(
      and(
        or(
          eq(stories.moderationStatus, "pending"),
          and(
            eq(stories.moderationStatus, "flagged"),
            inArray(
              stories.moderationReason,
              [...retryableStoryModerationReasons],
            ),
          ),
        ),
        gt(stories.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(stories.createdAt))
    .limit(limit)

  const results = []
  for (let index = 0; index < rows.length; index += 5) {
    results.push(
      ...(await Promise.allSettled(
        rows
          .slice(index, index + 5)
          .map(({ id }) => enqueueStoryModeration(id)),
      )),
    )
  }

  return {
    scanned: rows.length,
    dispatched: results.filter(({ status }) => status === "fulfilled").length,
    failed: results.filter(({ status }) => status === "rejected").length,
  }
}
