import { randomUUID } from "node:crypto"

import { and, eq, or } from "drizzle-orm"

import { reverseUnpaidStoryEarnings } from "@/lib/creator-earnings"
import { getDb } from "@/lib/db"
import {
  contentReports,
  creatorNotificationPreferences,
  follows,
  stories,
  userBlocks,
  users,
} from "@/lib/db/schema"

export type BlockedUserProfile = {
  id: string
  name: string
  handle: string
  imageUrl: string | null
  blockedAt: string
}

export type ReportReason =
  | "harassment"
  | "bullying"
  | "hate"
  | "nudity"
  | "sexual"
  | "profanity"
  | "violence"
  | "dangerous_organizations"
  | "scam"
  | "spam"
  | "false_information"
  | "illegal_goods"
  | "self_harm"
  | "child_safety"
  | "intellectual_property"
  | "other"

const reportReasonLabels: Record<ReportReason, string> = {
  harassment: "Harassment or bullying",
  bullying: "Bullying",
  hate: "Hate or abusive behavior",
  nudity: "Nudity or sexual activity",
  sexual: "Sexual content",
  profanity: "Profanity or abusive language",
  violence: "Violence or threats",
  dangerous_organizations: "Dangerous organizations or extremism",
  scam: "Scam or misleading content",
  spam: "Spam",
  false_information: "False information",
  illegal_goods: "Illegal or regulated goods",
  self_harm: "Self-harm concern",
  child_safety: "Child safety",
  intellectual_property: "Intellectual property",
  other: "Other",
}

function normalizeNote(value: string | null | undefined) {
  const trimmed = value?.trim()

  return trimmed ? trimmed.slice(0, 1_000) : null
}

export function reportReasonLabel(reason: string) {
  return reportReasonLabels[reason as ReportReason] ?? "User report"
}

export async function getBlockedAccountIds(userId: string) {
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

export async function hasBlockBetween(leftUserId: string, rightUserId: string) {
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

export async function reportStory(input: {
  reporterId: string
  storyId: string
  reason: ReportReason
  note?: string | null
}) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      status: stories.status,
    })
    .from(stories)
    .where(eq(stories.id, input.storyId))
    .limit(1)

  if (!story || story.status === "removed") {
    throw new Error("That story is no longer available.")
  }

  if (story.creatorId === input.reporterId) {
    throw new Error("You cannot report your own story.")
  }

  const now = new Date()
  const reasonLabel = reportReasonLabel(input.reason)

  await db
    .insert(contentReports)
    .values({
      id: `content-report-${randomUUID()}`,
      reporterId: input.reporterId,
      storyId: story.id,
      targetUserId: story.creatorId,
      reason: input.reason,
      note: normalizeNote(input.note),
      status: "open",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [contentReports.reporterId, contentReports.storyId],
      set: {
        reason: input.reason,
        note: normalizeNote(input.note),
        status: "open",
        updatedAt: now,
      },
    })

  await db
    .update(stories)
    .set({
      status: "processing",
      moderationStatus: "flagged",
      moderationReason: `User report: ${reasonLabel}.`,
    })
    .where(eq(stories.id, story.id))

  await reverseUnpaidStoryEarnings(story.id)
}

export async function blockUser(input: {
  blockerId: string
  blockedUserId: string
}) {
  const { blockedUserId, blockerId } = input

  if (blockerId === blockedUserId) {
    throw new Error("You cannot block yourself.")
  }

  const db = getDb()
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, blockedUserId))
    .limit(1)

  if (!target) {
    throw new Error("That account does not exist.")
  }

  await db
    .insert(userBlocks)
    .values({
      blockerId,
      blockedUserId,
    })
    .onConflictDoNothing()

  await db
    .delete(follows)
    .where(
      or(
        and(eq(follows.followerId, blockerId), eq(follows.followeeId, blockedUserId)),
        and(eq(follows.followerId, blockedUserId), eq(follows.followeeId, blockerId)),
      ),
    )

  await db
    .delete(creatorNotificationPreferences)
    .where(
      or(
        and(
          eq(creatorNotificationPreferences.subscriberId, blockerId),
          eq(creatorNotificationPreferences.creatorId, blockedUserId),
        ),
        and(
          eq(creatorNotificationPreferences.subscriberId, blockedUserId),
          eq(creatorNotificationPreferences.creatorId, blockerId),
        ),
      ),
    )
}

export async function unblockUser(input: {
  blockerId: string
  blockedUserId: string
}) {
  await getDb()
    .delete(userBlocks)
    .where(
      and(
        eq(userBlocks.blockerId, input.blockerId),
        eq(userBlocks.blockedUserId, input.blockedUserId),
      ),
    )
}

export async function listBlockedUsers(
  blockerId: string,
): Promise<BlockedUserProfile[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
      blockedAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedUserId))
    .where(eq(userBlocks.blockerId, blockerId))
    .orderBy(userBlocks.createdAt)

  return rows.flatMap((row) => {
    if (!row.displayName || !row.handle) {
      return []
    }

    return {
      id: row.id,
      name: row.displayName,
      handle: row.handle,
      imageUrl: row.avatarUrl,
      blockedAt: row.blockedAt.toISOString(),
    }
  })
}
