import { and, asc, eq, gt } from "drizzle-orm"
import { start } from "workflow/api"

import { getDb } from "@/lib/db"
import { stories } from "@/lib/db/schema"
import { areDurableMediaWorkersEnabled } from "@/lib/media-pipeline/features"
import { moderatePendingStory } from "@/lib/story-moderation-core"
import { moderateStoryWorkflow } from "@/workflows/story-moderation"

export async function enqueueStoryModeration(storyId: string) {
  if (!areDurableMediaWorkersEnabled()) {
    const result = await moderatePendingStory(storyId)
    console.info("story_moderation_direct_finished", { storyId, result })
    return { storyId, runId: null, result }
  }

  const run = await start(moderateStoryWorkflow, [storyId])
  console.info("story_moderation_workflow_started", {
    storyId,
    runId: run.runId,
  })
  return { storyId, runId: run.runId }
}

export async function reconcilePendingStoryModeration(
  input: { limit?: number } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const rows = await getDb()
    .select({ id: stories.id })
    .from(stories)
    .where(
      and(
        eq(stories.moderationStatus, "pending"),
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
