import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import { getDb } from "@/lib/db"
import { feedImpressions, stories, users } from "@/lib/db/schema"
import { getBlockedPeerIds } from "@/lib/social-safety"

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

const storyViewerCursorSchema = z
  .object({
    lastViewedAt: z.iso.datetime(),
    viewerId: z.string().min(1).max(256),
  })
  .strict()

type StoryViewerCursor = z.infer<typeof storyViewerCursorSchema>

export type StoryViewer = {
  id: string
  name: string
  handle: string
  imageUrl: string | null
  viewCount: number
  lastViewedAt: string
}

export type StoryViewerPage = {
  viewers: StoryViewer[]
  totalViewers: number
  totalViews: number
  nextCursor: string | null
}

export class StoryViewersUnavailableError extends Error {}
export class InvalidStoryViewerCursorError extends Error {}

function toNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function encodeCursor(cursor: StoryViewerCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

function decodeCursor(value: string | undefined): StoryViewerCursor | undefined {
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    const cursor = storyViewerCursorSchema.safeParse(parsed)

    if (!cursor.success) {
      throw new InvalidStoryViewerCursorError("The viewer cursor is invalid.")
    }

    return cursor.data
  } catch (error) {
    if (error instanceof InvalidStoryViewerCursorError) {
      throw error
    }

    throw new InvalidStoryViewerCursorError("The viewer cursor is invalid.")
  }
}

export async function listStoryViewers(input: {
  creatorId: string
  storyId: string
  cursor?: string
  limit?: number
}): Promise<StoryViewerPage> {
  const db = getDb()
  const [story] = await db
    .select({ creatorId: stories.creatorId })
    .from(stories)
    .where(eq(stories.id, input.storyId))
    .limit(1)

  if (!story || story.creatorId !== input.creatorId) {
    throw new StoryViewersUnavailableError("That story is not available.")
  }

  const cursor = decodeCursor(input.cursor)
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
  const blockedPeerIds = [...(await getBlockedPeerIds(input.creatorId))]
  const impressionsByViewer = db
    .select({
      viewerId: feedImpressions.viewerId,
      viewCount: sql<number>`count(*)::int`.as("view_count"),
      lastViewedAt: sql<Date>`max(${feedImpressions.createdAt})`.as(
        "last_viewed_at",
      ),
      lastViewedAtCursor: sql<string>`to_char(
        max(${feedImpressions.createdAt}) at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )`.as("last_viewed_at_cursor"),
    })
    .from(feedImpressions)
    .where(eq(feedImpressions.storyId, input.storyId))
    .groupBy(feedImpressions.viewerId)
    .as("story_viewer_impressions")

  const visibleViewerFilter = and(
    isNotNull(users.displayName),
    isNotNull(users.handle),
    blockedPeerIds.length > 0
      ? notInArray(impressionsByViewer.viewerId, blockedPeerIds)
      : undefined,
  )
  const cursorFilter = cursor
    ? or(
        lt(
          impressionsByViewer.lastViewedAt,
          sql`${cursor.lastViewedAt}::timestamptz`,
        ),
        and(
          eq(
            impressionsByViewer.lastViewedAt,
            sql`${cursor.lastViewedAt}::timestamptz`,
          ),
          gt(impressionsByViewer.viewerId, cursor.viewerId),
        ),
      )
    : undefined

  const [rows, totalsRows] = await Promise.all([
    db
      .select({
        viewerId: impressionsByViewer.viewerId,
        displayName: users.displayName,
        handle: users.handle,
        avatarUrl: users.avatarUrl,
        viewCount: impressionsByViewer.viewCount,
        lastViewedAt: impressionsByViewer.lastViewedAt,
        lastViewedAtCursor: impressionsByViewer.lastViewedAtCursor,
      })
      .from(impressionsByViewer)
      .innerJoin(users, eq(users.id, impressionsByViewer.viewerId))
      .where(and(visibleViewerFilter, cursorFilter))
      .orderBy(
        desc(impressionsByViewer.lastViewedAt),
        asc(impressionsByViewer.viewerId),
      )
      .limit(limit + 1),
    db
      .select({
        totalViewers: sql<number>`count(*)::int`,
        totalViews: sql<number>`coalesce(sum(${impressionsByViewer.viewCount}), 0)::int`,
      })
      .from(impressionsByViewer)
      .innerJoin(users, eq(users.id, impressionsByViewer.viewerId))
      .where(visibleViewerFilter),
  ])

  const pageRows = rows.slice(0, limit)
  const viewers = pageRows.flatMap((row) => {
    if (!row.displayName || !row.handle) {
      return []
    }

    return [
      {
        id: row.viewerId,
        name: row.displayName,
        handle: row.handle,
        imageUrl: row.avatarUrl,
        viewCount: toNumber(row.viewCount),
        lastViewedAt: row.lastViewedAtCursor,
      },
    ]
  })
  const lastViewer = pageRows.at(-1)
  const nextCursor =
    rows.length > limit && lastViewer
      ? encodeCursor({
          lastViewedAt: lastViewer.lastViewedAtCursor,
          viewerId: lastViewer.viewerId,
        })
      : null
  const totals = totalsRows[0]

  return {
    viewers,
    totalViewers: toNumber(totals?.totalViewers),
    totalViews: toNumber(totals?.totalViews),
    nextCursor,
  }
}
