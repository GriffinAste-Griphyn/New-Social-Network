import { randomUUID } from "node:crypto"

import { and, eq, gt } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { feedEvents, feedImpressions, stories } from "@/lib/db/schema"
import { isBlockedBetween } from "@/lib/social-safety"

function clampViewedMs(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(Math.round(value), 10 * 60 * 1000))
}

export async function recordStoryImpression(input: {
  storyId: string
  viewerId: string
  viewedMs: number
  completed: boolean
  hidden?: boolean
}) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
    })
    .from(stories)
    .where(
      and(
        eq(stories.id, input.storyId),
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (!story || story.creatorId === input.viewerId) {
    return { recorded: false }
  }

  if (await isBlockedBetween(input.viewerId, story.creatorId)) {
    return { recorded: false }
  }

  const viewedMs = clampViewedMs(input.viewedMs)
  const [previousImpression] = await db
    .select({ id: feedImpressions.id })
    .from(feedImpressions)
    .where(
      and(
        eq(feedImpressions.viewerId, input.viewerId),
        eq(feedImpressions.storyId, story.id),
      ),
    )
    .limit(1)

  await db.insert(feedImpressions).values({
    id: `feed-impression-${randomUUID()}`,
    viewerId: input.viewerId,
    storyId: story.id,
    score: "0.0000",
    rank: 0,
    completed: input.completed,
    hidden: input.hidden ?? false,
    viewedMs,
  })

  const kinds: Array<"impression" | "completion" | "skip" | "hide" | "rewatch"> = [
    "impression",
  ]
  if (input.completed) {
    kinds.push("completion")
  } else if (viewedMs < 3_000) {
    kinds.push("skip")
  }
  if (input.hidden) {
    kinds.push("hide")
  }
  if (previousImpression) {
    kinds.push("rewatch")
  }

  await db.insert(feedEvents).values(
    kinds.map((kind) => ({
      id: `feed-event-${randomUUID()}`,
      viewerId: input.viewerId,
      storyId: story.id,
      creatorId: story.creatorId,
      kind,
      viewedMs,
      metadata: { completed: input.completed, hidden: input.hidden ?? false },
    })),
  )

  return { recorded: true, events: kinds }
}
