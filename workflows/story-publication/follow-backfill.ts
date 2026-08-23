import { createHook } from "workflow"

import { invalidateMobileFeedSnapshot } from "@/lib/feed-snapshot-store"
import { backfillTimelineForFollow } from "@/lib/feed-timeline-store"

async function backfillFollowTimelineStep(
  followerId: string,
  followeeId: string,
) {
  "use step"

  await Promise.all([
    backfillTimelineForFollow({ followerId, followeeId }),
    invalidateMobileFeedSnapshot(followerId),
  ])
}

export async function backfillFollowTimelineWorkflow(
  followerId: string,
  followeeId: string,
) {
  "use workflow"

  using claim = createHook({
    token: `follow-timeline:${followerId}:${followeeId}`,
  })
  const conflict = await claim.getConflict()
  if (conflict) {
    return { status: "deduplicated" as const, runId: conflict.runId }
  }

  await backfillFollowTimelineStep(followerId, followeeId)
  return { status: "completed" as const }
}
