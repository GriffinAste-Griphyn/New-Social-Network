import { and, desc, eq, gt } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { follows, stories } from "@/lib/db/schema"
import { redisCommand, redisPipeline } from "@/lib/upstash-redis"

const timelineRetentionSeconds = 48 * 60 * 60
const timelineMaxStories = 500

function timelineKey(viewerId: string) {
  return `mobile-feed:timeline:v1:${viewerId}`
}

export async function readTimelineStoryIds(
  viewerId: string,
  limit = 100,
  beforeScore?: number | null,
) {
  const result = await redisCommand<string[]>([
    "ZREVRANGEBYSCORE",
    timelineKey(viewerId),
    beforeScore ? String(beforeScore) : "+inf",
    "-inf",
    "LIMIT",
    0,
    Math.max(1, Math.min(limit, timelineMaxStories)),
  ]).catch(() => null)

  return result ?? []
}

export async function fanoutStoryToFollowers(input: {
  creatorId: string
  storyId: string
  createdAt: Date
}) {
  const followerRows = await getDb()
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(eq(follows.followeeId, input.creatorId))

  const viewerIds = [
    input.creatorId,
    ...followerRows.map((row) => row.followerId),
  ]
  const score = input.createdAt.getTime()

  try {
    for (let index = 0; index < viewerIds.length; index += 250) {
      const viewerBatch = viewerIds.slice(index, index + 250)
      await redisPipeline(
        viewerBatch.flatMap((viewerId) => {
          const key = timelineKey(viewerId)
          return [
            ["ZADD", key, score, input.storyId],
            ["ZREMRANGEBYRANK", key, 0, -(timelineMaxStories + 1)],
            ["EXPIRE", key, timelineRetentionSeconds],
          ]
        }),
      )
    }
    return { cached: true, viewerCount: viewerIds.length }
  } catch (error) {
    // Timelines are derived acceleration data. The relational feed remains the
    // source of truth, so a cache outage must not fail or repeatedly replay the
    // complete publication workflow.
    console.warn("Story timeline cache fanout failed.", error)
    return { cached: false, viewerCount: viewerIds.length }
  }
}

export async function backfillTimelineForFollow(input: {
  followerId: string
  followeeId: string
}) {
  const recentStories = await getDb()
    .select({ id: stories.id, createdAt: stories.createdAt })
    .from(stories)
    .where(
      and(
        eq(stories.creatorId, input.followeeId),
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(stories.createdAt))
    .limit(24)

  const key = timelineKey(input.followerId)
  await redisPipeline([
    ...recentStories.map((story) => [
      "ZADD",
      key,
      story.createdAt.getTime(),
      story.id,
    ]),
    ["ZREMRANGEBYRANK", key, 0, -(timelineMaxStories + 1)],
    ["EXPIRE", key, timelineRetentionSeconds],
  ]).catch(() => undefined)
}

export async function removeCreatorStoriesFromTimeline(input: {
  followerId: string
  followeeId: string
}) {
  const storyRows = await getDb()
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.creatorId, input.followeeId))
    .limit(timelineMaxStories)

  if (storyRows.length === 0) {
    return
  }

  await redisCommand([
    "ZREM",
    timelineKey(input.followerId),
    ...storyRows.map((story) => story.id),
  ]).catch(() => undefined)
}
