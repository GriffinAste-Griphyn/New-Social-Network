import { desc, eq, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  feedImpressions,
  follows,
  stories,
  storyInteractions,
} from "@/lib/db/schema"

type DbNumber = bigint | number | string | null

export type CreatorStoryStats = {
  id: string
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  caption: string | null
  status: "processing" | "live" | "expired" | "removed"
  createdAt: string
  expiresAt: string
  views: number
  uniqueViewers: number
  completedViews: number
  completionRate: number
  averageViewedSeconds: number
  comments: number
  replies: number
}

export type CreatorStats = {
  followerCount: number
  followingCount: number
  totalStories: number
  liveStories: number
  expiredStories: number
  removedStories: number
  totalViews: number
  uniqueViewers: number
  completedViews: number
  completionRate: number
  averageViewedSeconds: number
  totalViewedSeconds: number
  comments: number
  replies: number
  stories: CreatorStoryStats[]
}

function toNumber(value: DbNumber) {
  if (typeof value === "bigint") {
    return Number(value)
  }

  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    return Number(value)
  }

  return 0
}

function calculateRate(count: number, total: number) {
  if (total <= 0) {
    return 0
  }

  return Math.round((count / total) * 100)
}

function calculateAverageSeconds(totalViewedMs: number, views: number) {
  if (views <= 0) {
    return 0
  }

  return Math.round((totalViewedMs / views / 1000) * 10) / 10
}

export async function getCreatorStats(creatorId: string): Promise<CreatorStats> {
  const db = getDb()

  const [
    followerCountRows,
    followingCountRows,
    storyRows,
    impressionRows,
    interactionRows,
    totalUniqueViewerRows,
  ] = await Promise.all([
    db
      .select({ count: sql<DbNumber>`count(*)::int` })
      .from(follows)
      .where(eq(follows.followeeId, creatorId)),
    db
      .select({ count: sql<DbNumber>`count(*)::int` })
      .from(follows)
      .where(eq(follows.followerId, creatorId)),
    db
      .select({
        id: stories.id,
        assetKind: stories.assetKind,
        mediaUrl: stories.mediaUrl,
        thumbnailUrl: stories.thumbnailUrl,
        caption: stories.caption,
        status: stories.status,
        createdAt: stories.createdAt,
        expiresAt: stories.expiresAt,
      })
      .from(stories)
      .where(eq(stories.creatorId, creatorId))
      .orderBy(desc(stories.createdAt)),
    db
      .select({
        storyId: feedImpressions.storyId,
        views: sql<DbNumber>`count(*)::int`,
        uniqueViewers: sql<DbNumber>`count(distinct ${feedImpressions.viewerId})::int`,
        completedViews: sql<DbNumber>`coalesce(sum(case when ${feedImpressions.completed} then 1 else 0 end), 0)::int`,
        totalViewedMs: sql<DbNumber>`coalesce(sum(${feedImpressions.viewedMs}), 0)::int`,
      })
      .from(feedImpressions)
      .innerJoin(stories, eq(stories.id, feedImpressions.storyId))
      .where(eq(stories.creatorId, creatorId))
      .groupBy(feedImpressions.storyId),
    db
      .select({
        storyId: storyInteractions.storyId,
        comments: sql<DbNumber>`coalesce(sum(case when ${storyInteractions.kind} = 'comment' then 1 else 0 end), 0)::int`,
        replies: sql<DbNumber>`coalesce(sum(case when ${storyInteractions.kind} = 'reply' then 1 else 0 end), 0)::int`,
      })
      .from(storyInteractions)
      .where(eq(storyInteractions.creatorId, creatorId))
      .groupBy(storyInteractions.storyId),
    db
      .select({
        uniqueViewers: sql<DbNumber>`count(distinct ${feedImpressions.viewerId})::int`,
      })
      .from(feedImpressions)
      .innerJoin(stories, eq(stories.id, feedImpressions.storyId))
      .where(eq(stories.creatorId, creatorId)),
  ])

  const impressionsByStory = new Map(
    impressionRows.map((row) => [
      row.storyId,
      {
        views: toNumber(row.views),
        uniqueViewers: toNumber(row.uniqueViewers),
        completedViews: toNumber(row.completedViews),
        totalViewedMs: toNumber(row.totalViewedMs),
      },
    ]),
  )
  const interactionsByStory = new Map(
    interactionRows.map((row) => [
      row.storyId,
      {
        comments: toNumber(row.comments),
        replies: toNumber(row.replies),
      },
    ]),
  )

  let totalViews = 0
  let completedViews = 0
  let totalViewedMs = 0
  let comments = 0
  let replies = 0

  const storyStats = storyRows.map((story) => {
    const impressions = impressionsByStory.get(story.id) ?? {
      views: 0,
      uniqueViewers: 0,
      completedViews: 0,
      totalViewedMs: 0,
    }
    const interactions = interactionsByStory.get(story.id) ?? {
      comments: 0,
      replies: 0,
    }

    totalViews += impressions.views
    completedViews += impressions.completedViews
    totalViewedMs += impressions.totalViewedMs
    comments += interactions.comments
    replies += interactions.replies

    return {
      id: story.id,
      assetKind: story.assetKind,
      mediaUrl: story.mediaUrl,
      thumbnailUrl: story.thumbnailUrl,
      caption: story.caption,
      status: story.status,
      createdAt: story.createdAt.toISOString(),
      expiresAt: story.expiresAt.toISOString(),
      views: impressions.views,
      uniqueViewers: impressions.uniqueViewers,
      completedViews: impressions.completedViews,
      completionRate: calculateRate(impressions.completedViews, impressions.views),
      averageViewedSeconds: calculateAverageSeconds(
        impressions.totalViewedMs,
        impressions.views,
      ),
      comments: interactions.comments,
      replies: interactions.replies,
    }
  })

  return {
    followerCount: toNumber(followerCountRows[0]?.count),
    followingCount: toNumber(followingCountRows[0]?.count),
    totalStories: storyRows.length,
    liveStories: storyRows.filter((story) => story.status === "live").length,
    expiredStories: storyRows.filter((story) => story.status === "expired").length,
    removedStories: storyRows.filter((story) => story.status === "removed").length,
    totalViews,
    uniqueViewers: toNumber(totalUniqueViewerRows[0]?.uniqueViewers),
    completedViews,
    completionRate: calculateRate(completedViews, totalViews),
    averageViewedSeconds: calculateAverageSeconds(totalViewedMs, totalViews),
    totalViewedSeconds: Math.round(totalViewedMs / 1000),
    comments,
    replies,
    stories: storyStats,
  }
}
