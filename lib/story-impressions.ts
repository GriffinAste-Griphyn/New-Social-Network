import { randomUUID } from "node:crypto"

import { and, eq, gt } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { feedImpressions, stories } from "@/lib/db/schema"
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

  await db.insert(feedImpressions).values({
    id: `feed-impression-${randomUUID()}`,
    viewerId: input.viewerId,
    storyId: story.id,
    score: "0.0000",
    rank: 0,
    completed: input.completed,
    hidden: false,
    viewedMs: clampViewedMs(input.viewedMs),
  })

  return { recorded: true }
}
