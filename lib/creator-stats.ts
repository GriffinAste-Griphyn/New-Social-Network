import { and, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  earningsLedger,
  feedImpressions,
  follows,
  stories,
  storyInteractions,
  users,
} from "@/lib/db/schema"
import { getBlockedPeerIds } from "@/lib/social-safety"
import { publicStoryMediaUrl } from "@/lib/story-storage"

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
  earningsCents: number
  pendingEarningsCents: number
  paidEarningsCents: number
  commentItems: CreatorStoryComment[]
}

export type CreatorStoryComment = {
  id: string
  storyId: string
  actor: {
    id: string
    name: string
    handle: string
    imageUrl: string | null
  }
  body: string | null
  mediaUrl: string | null
  mediaThumbnailUrl: string | null
  mediaAssetKind: "image" | "video" | null
  createdAt: string
}

export type CreatorEarningsStats = {
  totalCents: number
  pendingCents: number
  approvedCents: number
  paidCents: number
  reversedCents: number
  availableCents: number
  nextAvailableAt: string | null
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
  earnings: CreatorEarningsStats
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

export type CreatorStatsRange = {
  from?: Date
  to?: Date
  storyScope?: "all" | "active"
  includeStoryComments?: boolean
  storyCommentLimit?: number
}

async function listCreatorStoryComments(input: {
  creatorId: string
  storyIds: string[]
  limitPerStory: number
}) {
  if (input.storyIds.length === 0 || input.limitPerStory <= 0) {
    return new Map<string, CreatorStoryComment[]>()
  }

  const db = getDb()
  const blockedPeerIds = await getBlockedPeerIds(input.creatorId)
  const limitPerStory = Math.min(Math.max(input.limitPerStory, 1), 50)
  const rows = await db
    .select({
      id: storyInteractions.id,
      storyId: storyInteractions.storyId,
      actorId: storyInteractions.actorId,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
      body: storyInteractions.body,
      mediaUrl: storyInteractions.mediaUrl,
      mediaThumbnailUrl: storyInteractions.mediaThumbnailUrl,
      mediaAssetKind: storyInteractions.mediaAssetKind,
      createdAt: storyInteractions.createdAt,
    })
    .from(storyInteractions)
    .innerJoin(users, eq(users.id, storyInteractions.actorId))
    .where(
      and(
        eq(storyInteractions.creatorId, input.creatorId),
        inArray(storyInteractions.storyId, input.storyIds),
        eq(storyInteractions.kind, "comment"),
        eq(storyInteractions.moderationStatus, "approved"),
      ),
    )
    .orderBy(desc(storyInteractions.createdAt))
    .limit(Math.min(input.storyIds.length * limitPerStory, 500))

  const commentsByStory = new Map<string, CreatorStoryComment[]>()

  rows.forEach((row) => {
    if (!row.displayName || !row.handle || blockedPeerIds.has(row.actorId)) {
      return
    }

    const storyComments = commentsByStory.get(row.storyId) ?? []

    if (storyComments.length >= limitPerStory) {
      return
    }

    storyComments.push({
      id: row.id,
      storyId: row.storyId,
      actor: {
        id: row.actorId,
        name: row.displayName,
        handle: row.handle,
        imageUrl: row.avatarUrl,
      },
      body: row.body,
      mediaUrl: row.mediaUrl,
      mediaThumbnailUrl: row.mediaThumbnailUrl,
      mediaAssetKind: row.mediaAssetKind,
      createdAt: row.createdAt.toISOString(),
    })
    commentsByStory.set(row.storyId, storyComments)
  })

  return commentsByStory
}

export async function getCreatorStats(
  creatorId: string,
  range: CreatorStatsRange = {},
): Promise<CreatorStats> {
  const db = getDb()
  const activeStoriesOnly = range.storyScope === "active"
  const now = new Date()
  const storyScopeFilters = activeStoriesOnly
    ? [
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, now),
      ]
    : []
  const storyFilters = [eq(stories.creatorId, creatorId), ...storyScopeFilters]
  const impressionFilters = [
    eq(stories.creatorId, creatorId),
    ...storyScopeFilters,
  ]
  const interactionFilters = [eq(storyInteractions.creatorId, creatorId)]
  const earningsFilters = [eq(earningsLedger.userId, creatorId)]

  if (range.from) {
    storyFilters.push(gte(stories.createdAt, range.from))
    impressionFilters.push(gte(feedImpressions.createdAt, range.from))
    interactionFilters.push(gte(storyInteractions.createdAt, range.from))
    earningsFilters.push(gte(earningsLedger.createdAt, range.from))
  }

  if (range.to) {
    storyFilters.push(lte(stories.createdAt, range.to))
    impressionFilters.push(lte(feedImpressions.createdAt, range.to))
    interactionFilters.push(lte(storyInteractions.createdAt, range.to))
    earningsFilters.push(lte(earningsLedger.createdAt, range.to))
  }

  const interactionRowsPromise = activeStoriesOnly
    ? db
        .select({
          storyId: storyInteractions.storyId,
          comments: sql<DbNumber>`coalesce(sum(case when ${storyInteractions.kind} = 'comment' then 1 else 0 end), 0)::int`,
          replies: sql<DbNumber>`coalesce(sum(case when ${storyInteractions.kind} = 'reply' then 1 else 0 end), 0)::int`,
        })
        .from(storyInteractions)
        .innerJoin(stories, eq(stories.id, storyInteractions.storyId))
        .where(and(...interactionFilters, ...storyScopeFilters))
        .groupBy(storyInteractions.storyId)
    : db
        .select({
          storyId: storyInteractions.storyId,
          comments: sql<DbNumber>`coalesce(sum(case when ${storyInteractions.kind} = 'comment' then 1 else 0 end), 0)::int`,
          replies: sql<DbNumber>`coalesce(sum(case when ${storyInteractions.kind} = 'reply' then 1 else 0 end), 0)::int`,
        })
        .from(storyInteractions)
        .where(and(...interactionFilters))
        .groupBy(storyInteractions.storyId)
  const earningsRowsPromise = activeStoriesOnly
    ? db
        .select({
          status: earningsLedger.status,
          amountCents: sql<DbNumber>`coalesce(sum(${earningsLedger.amountCents}), 0)::int`,
          nextAvailableAt: sql<Date | null>`min(${earningsLedger.availableAt}) filter (where ${earningsLedger.status} in ('pending', 'approved') and ${earningsLedger.availableAt} > now())`,
        })
        .from(earningsLedger)
        .innerJoin(stories, eq(stories.id, earningsLedger.storyId))
        .where(and(...earningsFilters, ...storyScopeFilters))
        .groupBy(earningsLedger.status)
    : db
        .select({
          status: earningsLedger.status,
          amountCents: sql<DbNumber>`coalesce(sum(${earningsLedger.amountCents}), 0)::int`,
          nextAvailableAt: sql<Date | null>`min(${earningsLedger.availableAt}) filter (where ${earningsLedger.status} in ('pending', 'approved') and ${earningsLedger.availableAt} > now())`,
        })
        .from(earningsLedger)
        .where(and(...earningsFilters))
        .groupBy(earningsLedger.status)
  const earningsByStoryRowsPromise = activeStoriesOnly
    ? db
        .select({
          storyId: earningsLedger.storyId,
          amountCents: sql<DbNumber>`coalesce(sum(${earningsLedger.amountCents}), 0)::int`,
          pendingCents: sql<DbNumber>`coalesce(sum(case when ${earningsLedger.status} = 'pending' then ${earningsLedger.amountCents} else 0 end), 0)::int`,
          paidCents: sql<DbNumber>`coalesce(sum(case when ${earningsLedger.status} = 'paid' then ${earningsLedger.amountCents} else 0 end), 0)::int`,
        })
        .from(earningsLedger)
        .innerJoin(stories, eq(stories.id, earningsLedger.storyId))
        .where(and(...earningsFilters, ...storyScopeFilters))
        .groupBy(earningsLedger.storyId)
    : db
        .select({
          storyId: earningsLedger.storyId,
          amountCents: sql<DbNumber>`coalesce(sum(${earningsLedger.amountCents}), 0)::int`,
          pendingCents: sql<DbNumber>`coalesce(sum(case when ${earningsLedger.status} = 'pending' then ${earningsLedger.amountCents} else 0 end), 0)::int`,
          paidCents: sql<DbNumber>`coalesce(sum(case when ${earningsLedger.status} = 'paid' then ${earningsLedger.amountCents} else 0 end), 0)::int`,
        })
        .from(earningsLedger)
        .where(and(...earningsFilters))
        .groupBy(earningsLedger.storyId)

  const [
    followerCountRows,
    followingCountRows,
    storyRows,
    impressionRows,
    interactionRows,
    earningsRows,
    earningsByStoryRows,
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
      .where(and(...storyFilters))
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
      .where(and(...impressionFilters))
      .groupBy(feedImpressions.storyId),
    interactionRowsPromise,
    earningsRowsPromise,
    earningsByStoryRowsPromise,
    db
      .select({
        uniqueViewers: sql<DbNumber>`count(distinct ${feedImpressions.viewerId})::int`,
      })
      .from(feedImpressions)
      .innerJoin(stories, eq(stories.id, feedImpressions.storyId))
      .where(and(...impressionFilters)),
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
  const earningsByStory = new Map(
    earningsByStoryRows.map((row) => [
      row.storyId,
      {
        amountCents: toNumber(row.amountCents),
        pendingCents: toNumber(row.pendingCents),
        paidCents: toNumber(row.paidCents),
      },
    ]),
  )

  const earningsByStatus = new Map(
    earningsRows.map((row) => [
      row.status,
      {
        amountCents: toNumber(row.amountCents),
        nextAvailableAt: row.nextAvailableAt,
      },
    ]),
  )
  const pendingCents = earningsByStatus.get("pending")?.amountCents ?? 0
  const approvedCents = earningsByStatus.get("approved")?.amountCents ?? 0
  const paidCents = earningsByStatus.get("paid")?.amountCents ?? 0
  const reversedCents = earningsByStatus.get("reversed")?.amountCents ?? 0
  const nextAvailableAt =
    earningsRows
      .map((row) => row.nextAvailableAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null

  let totalViews = 0
  let completedViews = 0
  let totalViewedMs = 0
  let comments = 0
  let replies = 0
  const storyCommentsByStory = range.includeStoryComments
    ? await listCreatorStoryComments({
        creatorId,
        storyIds: storyRows.map((story) => story.id),
        limitPerStory: range.storyCommentLimit ?? 20,
      })
    : new Map<string, CreatorStoryComment[]>()

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
    const storyEarnings = earningsByStory.get(story.id) ?? {
      amountCents: 0,
      pendingCents: 0,
      paidCents: 0,
    }

    totalViews += impressions.views
    completedViews += impressions.completedViews
    totalViewedMs += impressions.totalViewedMs
    comments += interactions.comments
    replies += interactions.replies

    return {
      id: story.id,
      assetKind: story.assetKind,
      mediaUrl: publicStoryMediaUrl(story.mediaUrl) ?? story.mediaUrl,
      thumbnailUrl: publicStoryMediaUrl(story.thumbnailUrl),
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
      earningsCents: storyEarnings.amountCents,
      pendingEarningsCents: storyEarnings.pendingCents,
      paidEarningsCents: storyEarnings.paidCents,
      commentItems: storyCommentsByStory.get(story.id) ?? [],
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
    earnings: {
      totalCents: pendingCents + approvedCents + paidCents - reversedCents,
      pendingCents,
      approvedCents,
      paidCents,
      reversedCents,
      availableCents: approvedCents,
      nextAvailableAt: nextAvailableAt?.toISOString() ?? null,
    },
    stories: storyStats,
  }
}
