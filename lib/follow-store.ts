import { and, asc, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { follows, stories, users } from "@/lib/db/schema"
import {
  assertUsersCanConnect,
  getBlockedPeerIds,
} from "@/lib/social-safety"

export type FollowProfile = {
  id: string
  name: string
  handle: string
  imageUrl: string | null
}

export type DiscoverProfileSearchResult = FollowProfile & {
  activeStoryId: string | null
  hasActiveStory: boolean
}

function mapProfile(row: {
  id: string
  displayName: string | null
  handle: string | null
  avatarUrl: string | null
}): FollowProfile | null {
  if (!row.displayName || !row.handle) {
    return null
  }

  return {
    id: row.id,
    name: row.displayName,
    handle: row.handle,
    imageUrl: row.avatarUrl,
  }
}

function normalizeProfileSearchQuery(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase()
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

async function ensureTargetExists(targetUserId: string) {
  const db = getDb()
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, targetUserId),
        isNotNull(users.displayName),
        isNotNull(users.handle),
      ),
    )
    .limit(1)

  return Boolean(target)
}

export async function listFollowingProfiles(userId: string): Promise<FollowProfile[]> {
  const db = getDb()
  const blockedPeerIds = await getBlockedPeerIds(userId)
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
    })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followeeId))
    .where(
      and(
        eq(follows.followerId, userId),
        isNotNull(users.displayName),
        isNotNull(users.handle),
      ),
    )
    .orderBy(desc(follows.createdAt))

  return rows.flatMap((row) => {
    if (blockedPeerIds.has(row.id)) {
      return []
    }

    const profile = mapProfile(row)

    return profile ? [profile] : []
  })
}

export async function listFollowerProfiles(userId: string): Promise<FollowProfile[]> {
  const db = getDb()
  const blockedPeerIds = await getBlockedPeerIds(userId)
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
    })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followerId))
    .where(
      and(
        eq(follows.followeeId, userId),
        isNotNull(users.displayName),
        isNotNull(users.handle),
      ),
    )
    .orderBy(desc(follows.createdAt))

  return rows.flatMap((row) => {
    if (blockedPeerIds.has(row.id)) {
      return []
    }

    const profile = mapProfile(row)

    return profile ? [profile] : []
  })
}

export async function searchDiscoverProfiles(input: {
  viewerId: string
  query: string
  limit?: number
}): Promise<DiscoverProfileSearchResult[]> {
  const normalizedQuery = normalizeProfileSearchQuery(input.query)

  const limit = Math.min(Math.max(input.limit ?? 12, 1), 25)
  const db = getDb()
  const blockedPeerIds = await getBlockedPeerIds(input.viewerId)
  const likeQuery = `%${escapeLikePattern(normalizedQuery)}%`
  const prefixQuery = `${escapeLikePattern(normalizedQuery)}%`
  const filters = [
    sql`${users.id} <> ${input.viewerId}`,
    isNotNull(users.displayName),
    isNotNull(users.handle),
  ]

  if (normalizedQuery) {
    filters.push(
      or(
        sql`lower(${users.handle}) like ${likeQuery} escape '\\'`,
        sql`lower(${users.displayName}) like ${likeQuery} escape '\\'`,
      )!,
    )
  }

  const queryBuilder = db
    .select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(and(...filters))

  const rows = normalizedQuery
    ? await queryBuilder
        .orderBy(
          sql`case
        when lower(${users.handle}) = ${normalizedQuery} then 0
        when lower(${users.handle}) like ${prefixQuery} escape '\\' then 1
        when lower(${users.displayName}) like ${prefixQuery} escape '\\' then 2
        else 3
      end`,
          asc(users.handle),
        )
        .limit(limit * 2)
    : await queryBuilder.orderBy(desc(users.createdAt)).limit(limit * 2)

  const profiles = rows.flatMap((row) => {
    if (blockedPeerIds.has(row.id)) {
      return []
    }

    const profile = mapProfile(row)

    return profile ? [profile] : []
  }).slice(0, limit)
  const profileIds = profiles.map((profile) => profile.id)
  const liveStoryRows =
    profileIds.length > 0
      ? await db
          .select({
            id: stories.id,
            creatorId: stories.creatorId,
          })
          .from(stories)
          .where(
            and(
              inArray(stories.creatorId, profileIds),
              eq(stories.status, "live"),
              eq(stories.moderationStatus, "approved"),
              gt(stories.expiresAt, new Date()),
            ),
          )
          .orderBy(desc(stories.createdAt))
      : []
  const liveStoryByCreatorId = new Map<string, string>()

  liveStoryRows.forEach((story) => {
    if (!liveStoryByCreatorId.has(story.creatorId)) {
      liveStoryByCreatorId.set(story.creatorId, story.id)
    }
  })

  return profiles.map((profile) => {
    const activeStoryId = liveStoryByCreatorId.get(profile.id) ?? null

    return {
      ...profile,
      activeStoryId,
      hasActiveStory: Boolean(activeStoryId),
    }
  })
}

export async function followUser(input: {
  followerId: string
  followeeId: string
}) {
  const { followerId, followeeId } = input

  if (followerId === followeeId) {
    throw new Error("You cannot follow yourself.")
  }

  const targetExists = await ensureTargetExists(followeeId)

  if (!targetExists) {
    throw new Error("That account does not exist.")
  }

  await assertUsersCanConnect({
    actorId: followerId,
    targetUserId: followeeId,
  })

  const db = getDb()

  await db
    .insert(follows)
    .values({
      followerId,
      followeeId,
    })
    .onConflictDoNothing()
}

export async function unfollowUser(input: {
  followerId: string
  followeeId: string
}) {
  const { followerId, followeeId } = input
  const db = getDb()

  await db
    .delete(follows)
    .where(
      and(
        eq(follows.followerId, followerId),
        eq(follows.followeeId, followeeId),
      ),
    )
}
