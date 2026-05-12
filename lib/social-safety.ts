import { randomUUID } from "node:crypto"

import { and, desc, eq, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { getDb } from "@/lib/db"
import {
  creatorNotificationPreferences,
  follows,
  safetyReports,
  stories,
  storyInteractions,
  userBlocks,
  users,
} from "@/lib/db/schema"

export const safetyReportReasons = [
  "spam",
  "harassment",
  "hate",
  "sexual_content",
  "violence",
  "self_harm",
  "illegal_goods",
  "impersonation",
  "intellectual_property",
  "other",
] as const

export type SafetyReportReason = (typeof safetyReportReasons)[number]
export type SafetyReportTargetKind = "story" | "user" | "interaction"
export type SafetyReportReviewStatus = "reviewed" | "actioned" | "dismissed"

export type BlockedProfile = {
  id: string
  name: string
  handle: string
  imageUrl: string | null
  createdAt: Date
}

export type PendingSafetyReport = {
  id: string
  targetKind: SafetyReportTargetKind
  reason: SafetyReportReason
  details: string | null
  createdAt: Date
  reporter: {
    id: string
    name: string | null
    handle: string | null
    email: string
  }
  targetUser: {
    id: string
    name: string | null
    handle: string | null
    email: string | null
  } | null
  story: {
    id: string
    caption: string | null
  } | null
  interaction: {
    id: string
    kind: "reply" | "comment" | "reaction"
    body: string | null
    reaction: string | null
  } | null
}

export function formatSafetyReportReason(reason: SafetyReportReason) {
  return reason
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ")
}

async function ensureCompleteUserExists(userId: string) {
  const [user] = await getDb()
    .select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return Boolean(user?.displayName && user.handle)
}

export async function getBlockedPeerIds(userId: string) {
  const rows = await getDb()
    .select({
      blockerId: userBlocks.blockerId,
      blockedId: userBlocks.blockedId,
    })
    .from(userBlocks)
    .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)))

  return new Set(
    rows.map((row) =>
      row.blockerId === userId ? row.blockedId : row.blockerId,
    ),
  )
}

export async function isBlockedBetween(leftUserId: string, rightUserId: string) {
  if (leftUserId === rightUserId) {
    return false
  }

  const [block] = await getDb()
    .select({ blockerId: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(
          eq(userBlocks.blockerId, leftUserId),
          eq(userBlocks.blockedId, rightUserId),
        ),
        and(
          eq(userBlocks.blockerId, rightUserId),
          eq(userBlocks.blockedId, leftUserId),
        ),
      ),
    )
    .limit(1)

  return Boolean(block)
}

export async function assertUsersCanConnect(input: {
  actorId: string
  targetUserId: string
}) {
  if (await isBlockedBetween(input.actorId, input.targetUserId)) {
    throw new Error("This account is not available.")
  }
}

export async function listBlockedProfiles(userId: string): Promise<BlockedProfile[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
      createdAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, userId))
    .orderBy(desc(userBlocks.createdAt))

  return rows.flatMap((row) => {
    if (!row.displayName || !row.handle) {
      return []
    }

    return [
      {
        id: row.id,
        name: row.displayName,
        handle: row.handle,
        imageUrl: row.avatarUrl,
        createdAt: row.createdAt,
      },
    ]
  })
}

export async function blockUser(input: {
  blockerId: string
  blockedId: string
  reason?: string | null
}) {
  if (input.blockerId === input.blockedId) {
    throw new Error("You cannot block yourself.")
  }

  const targetExists = await ensureCompleteUserExists(input.blockedId)

  if (!targetExists) {
    throw new Error("That account does not exist.")
  }

  const now = new Date()
  const db = getDb()

  await db
    .insert(userBlocks)
    .values({
      blockerId: input.blockerId,
      blockedId: input.blockedId,
      reason: input.reason?.trim() || null,
      createdAt: now,
    })
    .onConflictDoNothing()

  await Promise.all([
    db
      .delete(follows)
      .where(
        or(
          and(
            eq(follows.followerId, input.blockerId),
            eq(follows.followeeId, input.blockedId),
          ),
          and(
            eq(follows.followerId, input.blockedId),
            eq(follows.followeeId, input.blockerId),
          ),
        ),
      ),
    db
      .update(creatorNotificationPreferences)
      .set({ enabled: false, updatedAt: now })
      .where(
        or(
          and(
            eq(creatorNotificationPreferences.subscriberId, input.blockerId),
            eq(creatorNotificationPreferences.creatorId, input.blockedId),
          ),
          and(
            eq(creatorNotificationPreferences.subscriberId, input.blockedId),
            eq(creatorNotificationPreferences.creatorId, input.blockerId),
          ),
        ),
      ),
  ])
}

export async function unblockUser(input: {
  blockerId: string
  blockedId: string
}) {
  await getDb()
    .delete(userBlocks)
    .where(
      and(
        eq(userBlocks.blockerId, input.blockerId),
        eq(userBlocks.blockedId, input.blockedId),
      ),
    )
}

function normalizeReportDetails(value: string | null | undefined) {
  const details = value?.trim()

  return details ? details.slice(0, 1_000) : null
}

async function upsertSafetyReport(input: {
  reporterId: string
  targetKind: SafetyReportTargetKind
  targetUserId?: string | null
  targetStoryId?: string | null
  targetInteractionId?: string | null
  reason: SafetyReportReason
  details?: string | null
}) {
  const reportId = `safety-report-${randomUUID()}`
  const now = new Date()

  await getDb()
    .insert(safetyReports)
    .values({
      id: reportId,
      reporterId: input.reporterId,
      targetKind: input.targetKind,
      targetUserId: input.targetUserId ?? null,
      targetStoryId: input.targetStoryId ?? null,
      targetInteractionId: input.targetInteractionId ?? null,
      reason: input.reason,
      details: normalizeReportDetails(input.details),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target:
        input.targetKind === "story"
          ? [
              safetyReports.targetKind,
              safetyReports.reporterId,
              safetyReports.targetStoryId,
            ]
          : input.targetKind === "interaction"
            ? [
                safetyReports.targetKind,
                safetyReports.reporterId,
                safetyReports.targetInteractionId,
              ]
            : [
                safetyReports.targetKind,
                safetyReports.reporterId,
                safetyReports.targetUserId,
              ],
      set: {
        reason: input.reason,
        details: normalizeReportDetails(input.details),
        status: "pending",
        reviewedAt: null,
        reviewedByUserId: null,
        resolutionNote: null,
        updatedAt: now,
      },
    })

  return reportId
}

export async function reportStory(input: {
  reporterId: string
  storyId: string
  reason: SafetyReportReason
  details?: string | null
}) {
  const [story] = await getDb()
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      status: stories.status,
    })
    .from(stories)
    .where(eq(stories.id, input.storyId))
    .limit(1)

  if (!story) {
    throw new Error("That story is no longer available.")
  }

  if (story.creatorId === input.reporterId) {
    throw new Error("You cannot report your own story.")
  }

  await assertUsersCanConnect({
    actorId: input.reporterId,
    targetUserId: story.creatorId,
  })

  const reportId = await upsertSafetyReport({
    reporterId: input.reporterId,
    targetKind: "story",
    targetUserId: story.creatorId,
    targetStoryId: story.id,
    reason: input.reason,
    details: input.details,
  })

  await getDb()
    .update(stories)
    .set({
      status: story.status === "live" ? "processing" : story.status,
      moderationStatus: "flagged",
      moderationReason: `User report: ${formatSafetyReportReason(input.reason)}`,
      reviewedAt: null,
      reviewedByUserId: null,
    })
    .where(eq(stories.id, story.id))

  return reportId
}

export async function reportUser(input: {
  reporterId: string
  targetUserId: string
  reason: SafetyReportReason
  details?: string | null
}) {
  if (input.reporterId === input.targetUserId) {
    throw new Error("You cannot report yourself.")
  }

  const targetExists = await ensureCompleteUserExists(input.targetUserId)

  if (!targetExists) {
    throw new Error("That account does not exist.")
  }

  return upsertSafetyReport({
    reporterId: input.reporterId,
    targetKind: "user",
    targetUserId: input.targetUserId,
    reason: input.reason,
    details: input.details,
  })
}

export async function reportInteraction(input: {
  reporterId: string
  interactionId: string
  reason: SafetyReportReason
  details?: string | null
}) {
  const [interaction] = await getDb()
    .select({
      id: storyInteractions.id,
      actorId: storyInteractions.actorId,
      creatorId: storyInteractions.creatorId,
      storyId: storyInteractions.storyId,
    })
    .from(storyInteractions)
    .where(eq(storyInteractions.id, input.interactionId))
    .limit(1)

  if (!interaction) {
    throw new Error("That reply is no longer available.")
  }

  if (interaction.actorId === input.reporterId) {
    throw new Error("You cannot report your own reply.")
  }

  const targetUserId = interaction.actorId

  await assertUsersCanConnect({
    actorId: input.reporterId,
    targetUserId,
  })

  return upsertSafetyReport({
    reporterId: input.reporterId,
    targetKind: "interaction",
    targetUserId,
    targetStoryId: interaction.storyId,
    targetInteractionId: interaction.id,
    reason: input.reason,
    details: input.details,
  })
}

export async function createSafetyReport(input: {
  reporterId: string
  targetKind: SafetyReportTargetKind
  targetId: string
  reason: SafetyReportReason
  details?: string | null
}) {
  if (input.targetKind === "story") {
    return reportStory({
      reporterId: input.reporterId,
      storyId: input.targetId,
      reason: input.reason,
      details: input.details,
    })
  }

  if (input.targetKind === "interaction") {
    return reportInteraction({
      reporterId: input.reporterId,
      interactionId: input.targetId,
      reason: input.reason,
      details: input.details,
    })
  }

  return reportUser({
    reporterId: input.reporterId,
    targetUserId: input.targetId,
    reason: input.reason,
    details: input.details,
  })
}

export async function listPendingSafetyReports(): Promise<PendingSafetyReport[]> {
  const reporterUsers = alias(users, "reporter_users")
  const targetUsers = alias(users, "target_users")

  const rows = await getDb()
    .select({
      id: safetyReports.id,
      targetKind: safetyReports.targetKind,
      reason: safetyReports.reason,
      details: safetyReports.details,
      createdAt: safetyReports.createdAt,
      reporterId: reporterUsers.id,
      reporterName: reporterUsers.displayName,
      reporterHandle: reporterUsers.handle,
      reporterEmail: reporterUsers.email,
      targetUserId: targetUsers.id,
      targetUserName: targetUsers.displayName,
      targetUserHandle: targetUsers.handle,
      targetUserEmail: targetUsers.email,
      storyId: stories.id,
      storyCaption: stories.caption,
      interactionId: storyInteractions.id,
      interactionKind: storyInteractions.kind,
      interactionBody: storyInteractions.body,
      interactionReaction: storyInteractions.reaction,
    })
    .from(safetyReports)
    .innerJoin(reporterUsers, eq(reporterUsers.id, safetyReports.reporterId))
    .leftJoin(targetUsers, eq(targetUsers.id, safetyReports.targetUserId))
    .leftJoin(stories, eq(stories.id, safetyReports.targetStoryId))
    .leftJoin(
      storyInteractions,
      eq(storyInteractions.id, safetyReports.targetInteractionId),
    )
    .where(eq(safetyReports.status, "pending"))
    .orderBy(desc(safetyReports.createdAt))
    .limit(100)

  return rows.map((row) => ({
    id: row.id,
    targetKind: row.targetKind,
    reason: row.reason,
    details: row.details,
    createdAt: row.createdAt,
    reporter: {
      id: row.reporterId,
      name: row.reporterName,
      handle: row.reporterHandle,
      email: row.reporterEmail,
    },
    targetUser: row.targetUserId
      ? {
          id: row.targetUserId,
          name: row.targetUserName,
          handle: row.targetUserHandle,
          email: row.targetUserEmail,
        }
      : null,
    story: row.storyId
      ? {
          id: row.storyId,
          caption: row.storyCaption,
        }
      : null,
    interaction: row.interactionId && row.interactionKind
      ? {
          id: row.interactionId,
          kind: row.interactionKind,
          body: row.interactionBody,
          reaction: row.interactionReaction,
        }
      : null,
  }))
}

export async function reviewSafetyReport(input: {
  reportId: string
  reviewerId: string
  status: SafetyReportReviewStatus
  resolutionNote?: string | null
}) {
  const now = new Date()
  const [report] = await getDb()
    .update(safetyReports)
    .set({
      status: input.status,
      reviewedAt: now,
      reviewedByUserId: input.reviewerId,
      resolutionNote: input.resolutionNote?.trim() || null,
      updatedAt: now,
    })
    .where(eq(safetyReports.id, input.reportId))
    .returning({
      targetKind: safetyReports.targetKind,
      targetStoryId: safetyReports.targetStoryId,
    })

  if (
    input.status === "actioned" &&
    report?.targetKind === "story" &&
    report.targetStoryId
  ) {
    await getDb()
      .update(stories)
      .set({
        status: "removed",
        moderationStatus: "rejected",
        reviewedAt: now,
        reviewedByUserId: input.reviewerId,
      })
      .where(eq(stories.id, report.targetStoryId))
  }
}

export async function countPendingSafetyReports() {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(safetyReports)
    .where(eq(safetyReports.status, "pending"))

  return Number(row?.count ?? 0)
}
