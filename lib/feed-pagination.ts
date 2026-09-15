import { and, asc, desc, eq, gt, isNotNull, lt, notInArray, or } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { follows, stories, users } from "@/lib/db/schema"

export type CreatorFeedCursor = { createdAt: Date; id: string }

/** Choose each creator's latest visible story BEFORE applying the cursor/limit.
 * Applying a cursor inside DISTINCT ON would reintroduce a creator's older posts.
 */
export function followingCreatorPageQuery(
  viewerId: string,
  blockedPeerIds: Set<string>,
  cursor: CreatorFeedCursor | null | undefined,
  limit: number,
) {
  const db = getDb()
  const latest = db.selectDistinctOn([stories.creatorId], {
    id: stories.id,
    creatorId: stories.creatorId,
    createdAt: stories.createdAt,
  }).from(stories)
    .innerJoin(follows, and(eq(follows.followeeId, stories.creatorId), eq(follows.followerId, viewerId)))
    .innerJoin(users, eq(users.id, stories.creatorId))
    .where(and(
      eq(stories.status, "live"), eq(stories.moderationStatus, "approved"),
      gt(stories.expiresAt, new Date()),
      isNotNull(users.displayName), isNotNull(users.handle),
      blockedPeerIds.size ? notInArray(stories.creatorId, [...blockedPeerIds]) : undefined,
    ))
    .orderBy(asc(stories.creatorId), desc(stories.createdAt), desc(stories.id))
    .as("latest_creator_stories")

  return db.select().from(latest)
    .where(cursor ? or(
      lt(latest.createdAt, cursor.createdAt),
      and(eq(latest.createdAt, cursor.createdAt), lt(latest.id, cursor.id)),
    ) : undefined)
    .orderBy(desc(latest.createdAt), desc(latest.id))
    .limit(Math.max(1, Math.min(limit, 51)))
}
