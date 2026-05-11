import { and, desc, eq, isNotNull, or } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { follows, userBlocks, users } from "@/lib/db/schema"

export type FollowProfile = {
  id: string
  name: string
  handle: string
  imageUrl: string | null
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

async function getBlockedAccountIds(userId: string) {
  const db = getDb()
  const [outgoing, incoming] = await Promise.all([
    db
      .select({ id: userBlocks.blockedUserId })
      .from(userBlocks)
      .where(eq(userBlocks.blockerId, userId)),
    db
      .select({ id: userBlocks.blockerId })
      .from(userBlocks)
      .where(eq(userBlocks.blockedUserId, userId)),
  ])

  return new Set([...outgoing, ...incoming].map((row) => row.id))
}

async function hasBlockBetween(leftUserId: string, rightUserId: string) {
  const [block] = await getDb()
    .select({ blockerId: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(
          eq(userBlocks.blockerId, leftUserId),
          eq(userBlocks.blockedUserId, rightUserId),
        ),
        and(
          eq(userBlocks.blockerId, rightUserId),
          eq(userBlocks.blockedUserId, leftUserId),
        ),
      ),
    )
    .limit(1)

  return Boolean(block)
}

export async function listFollowingProfiles(userId: string): Promise<FollowProfile[]> {
  const db = getDb()
  const blockedAccountIds = await getBlockedAccountIds(userId)
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
    if (blockedAccountIds.has(row.id)) {
      return []
    }

    const profile = mapProfile(row)

    return profile ? [profile] : []
  })
}

export async function listFollowerProfiles(userId: string): Promise<FollowProfile[]> {
  const db = getDb()
  const blockedAccountIds = await getBlockedAccountIds(userId)
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
    if (blockedAccountIds.has(row.id)) {
      return []
    }

    const profile = mapProfile(row)

    return profile ? [profile] : []
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

  if (await hasBlockBetween(followerId, followeeId)) {
    throw new Error("Unblock this account before following.")
  }

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
