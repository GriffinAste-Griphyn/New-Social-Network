import { redirect } from "next/navigation"
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm"

import { isAdminSession } from "@/lib/admin-auth"
import { requireSession } from "@/lib/auth"
import {
  processStoryCreatorEarnings,
  reverseUnpaidStoryEarnings,
  settleCreatorPayouts,
} from "@/lib/creator-earnings"
import { getDb } from "@/lib/db"
import {
  advertiserAccounts,
  advertiserWalletTransactions,
  brandFundingProfiles,
  creatorProfiles,
  earningsLedger,
  feedImpressions,
  stories,
  storyElements,
  storyInteractions,
  users,
} from "@/lib/db/schema"
import { publicStoryMediaUrl } from "@/lib/story-storage"
import {
  countPendingSafetyReports,
  listPendingSafetyReports,
  type PendingSafetyReport,
} from "@/lib/social-safety"
import {
  listLatestModerationChecksForTargets,
  type ModerationCheckRecord,
} from "@/lib/safety/moderation-checks"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"

type DbNumber = bigint | number | string | null

export type AdminOverview = {
  advertiserCount: number
  activeAdvertiserCount: number
  userCount: number
  creatorCount: number
  fundedBudgetCents: number
  activeBudgetCents: number
  pendingBudgetCents: number
  flaggedStoryCount: number
  pendingReportCount: number
}

export type AdminModerationStory = {
  id: string
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  caption: string | null
  moderationReason: string | null
  createdAt: Date
  creatorId: string
  creatorName: string | null
  creatorHandle: string | null
  creatorEmail: string
  creatorAvatarUrl: string | null
  stats: AdminModerationStoryStats
  moderationCheck: ModerationCheckRecord | null
  elements: AdminModerationStoryElement[]
}

export type AdminModerationStoryStats = {
  views: number
  replies: number
  earningsCents: number
}

export type AdminModerationStoryElement = {
  id: string
  kind: "text" | "sticker" | "link"
  label: string
  href: string | null
  positionX: string | null
  positionY: string | null
}

export type AdminCreatorPayout = {
  userId: string
  creatorName: string | null
  creatorHandle: string | null
  creatorEmail: string
  amountCents: number
  ledgerCount: number
  oldestAvailableAt: Date | null
  latestCreatedAt: Date
  stripeConnectedAccountId: string | null
  stripePayoutsEnabled: boolean
  stripeOnboardingComplete: boolean
  stripeRequirementsStatus: string | null
}

function toNumber(value: DbNumber) {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)

  return 0
}

export async function requireAdminSession() {
  const session = await requireSession("/admin")

  if (!isAdminSession(session)) {
    redirect("/app")
  }

  return session
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const db = getDb()
  const [
    advertiserRows,
    activeAdvertiserRows,
    userRows,
    creatorRows,
    fundedBudgetRows,
    activeBudgetRows,
    pendingBudgetRows,
    flaggedStoryRows,
    pendingReportCount,
  ] = await Promise.all([
    db.select({ count: sql<DbNumber>`count(*)::int` }).from(advertiserAccounts),
    db
      .select({ count: sql<DbNumber>`count(distinct ${advertiserAccounts.id})::int` })
      .from(advertiserAccounts)
      .innerJoin(
        brandFundingProfiles,
        eq(brandFundingProfiles.advertiserAccountId, advertiserAccounts.id),
      )
      .where(eq(brandFundingProfiles.status, "active")),
    db.select({ count: sql<DbNumber>`count(*)::int` }).from(users),
    db
      .select({ count: sql<DbNumber>`count(*)::int` })
      .from(users)
      .where(eq(users.creatorStatus, "active")),
    db
      .select({
        amountCents: sql<DbNumber>`coalesce(sum(${advertiserWalletTransactions.amountCents}), 0)::int`,
      })
      .from(advertiserWalletTransactions)
      .where(
        and(
          eq(advertiserWalletTransactions.type, "funding"),
          eq(advertiserWalletTransactions.status, "posted"),
        ),
      ),
    db
      .select({
        amountCents: sql<DbNumber>`coalesce(sum(${advertiserWalletTransactions.amountCents}), 0)::int`,
      })
      .from(advertiserWalletTransactions)
      .where(eq(advertiserWalletTransactions.status, "posted")),
    db
      .select({
        amountCents: sql<DbNumber>`coalesce(sum(${advertiserWalletTransactions.amountCents}), 0)::int`,
      })
      .from(advertiserWalletTransactions)
      .where(eq(advertiserWalletTransactions.status, "pending")),
    db
      .select({ count: sql<DbNumber>`count(*)::int` })
      .from(stories)
      .where(eq(stories.moderationStatus, "flagged")),
    countPendingSafetyReports(),
  ])

  return {
    advertiserCount: toNumber(advertiserRows[0]?.count),
    activeAdvertiserCount: toNumber(activeAdvertiserRows[0]?.count),
    userCount: toNumber(userRows[0]?.count),
    creatorCount: toNumber(creatorRows[0]?.count),
    fundedBudgetCents: toNumber(fundedBudgetRows[0]?.amountCents),
    activeBudgetCents: toNumber(activeBudgetRows[0]?.amountCents),
    pendingBudgetCents: toNumber(pendingBudgetRows[0]?.amountCents),
    flaggedStoryCount: toNumber(flaggedStoryRows[0]?.count),
    pendingReportCount,
  }
}

export type AdminSafetyReport = PendingSafetyReport

export async function listAdminSafetyReports() {
  return listPendingSafetyReports()
}

export async function listAdminCreatorPayouts(): Promise<AdminCreatorPayout[]> {
  const rows = await getDb()
    .select({
      userId: earningsLedger.userId,
      creatorName: users.displayName,
      creatorHandle: users.handle,
      creatorEmail: users.email,
      amountCents: sql<DbNumber>`coalesce(sum(${earningsLedger.amountCents}), 0)::int`,
      ledgerCount: sql<DbNumber>`count(*)::int`,
      oldestAvailableAt: sql<Date | null>`min(${earningsLedger.availableAt})`,
      latestCreatedAt: sql<Date>`max(${earningsLedger.createdAt})`,
      stripeConnectedAccountId: creatorProfiles.stripeConnectedAccountId,
      stripePayoutsEnabled: creatorProfiles.stripePayoutsEnabled,
      stripeOnboardingComplete: creatorProfiles.stripeOnboardingComplete,
      stripeRequirementsStatus: creatorProfiles.stripeRequirementsStatus,
    })
    .from(earningsLedger)
    .innerJoin(users, eq(users.id, earningsLedger.userId))
    .leftJoin(creatorProfiles, eq(creatorProfiles.userId, earningsLedger.userId))
    .where(
      and(
        eq(earningsLedger.status, "approved"),
        isNull(earningsLedger.stripeTransferId),
        or(
          isNull(earningsLedger.availableAt),
          lte(earningsLedger.availableAt, new Date()),
        ),
      ),
    )
    .groupBy(
      earningsLedger.userId,
      users.displayName,
      users.handle,
      users.email,
      creatorProfiles.stripeConnectedAccountId,
      creatorProfiles.stripePayoutsEnabled,
      creatorProfiles.stripeOnboardingComplete,
      creatorProfiles.stripeRequirementsStatus,
    )
    .orderBy(desc(sql`sum(${earningsLedger.amountCents})`))
    .limit(50)

  return rows.map((row) => ({
    userId: row.userId,
    creatorName: row.creatorName,
    creatorHandle: row.creatorHandle,
    creatorEmail: row.creatorEmail,
    amountCents: toNumber(row.amountCents),
    ledgerCount: toNumber(row.ledgerCount),
    oldestAvailableAt: row.oldestAvailableAt,
    latestCreatedAt: row.latestCreatedAt,
    stripeConnectedAccountId: row.stripeConnectedAccountId,
    stripePayoutsEnabled: row.stripePayoutsEnabled ?? false,
    stripeOnboardingComplete: row.stripeOnboardingComplete ?? false,
    stripeRequirementsStatus: row.stripeRequirementsStatus,
  }))
}

export async function listFlaggedStories(): Promise<AdminModerationStory[]> {
  const flaggedStories = await getDb()
    .select({
      id: stories.id,
      assetKind: stories.assetKind,
      mediaUrl: stories.mediaUrl,
      thumbnailUrl: stories.thumbnailUrl,
      caption: stories.caption,
      moderationReason: stories.moderationReason,
      createdAt: stories.createdAt,
      creatorId: users.id,
      creatorName: users.displayName,
      creatorHandle: users.handle,
      creatorEmail: users.email,
      creatorAvatarUrl: users.avatarUrl,
    })
    .from(stories)
    .innerJoin(users, eq(users.id, stories.creatorId))
    .where(eq(stories.moderationStatus, "flagged"))
    .orderBy(desc(stories.createdAt))
    .limit(50)
  const storyIds = flaggedStories.map((story) => story.id)
  const latestChecks = await listLatestModerationChecksForTargets({
    targetKind: "story",
    targetIds: storyIds,
  })
  const elementRows =
    storyIds.length > 0
      ? await getDb()
          .select({
            id: storyElements.id,
            storyId: storyElements.storyId,
            kind: storyElements.kind,
            label: storyElements.label,
            href: storyElements.href,
            positionX: storyElements.positionX,
            positionY: storyElements.positionY,
          })
          .from(storyElements)
          .where(inArray(storyElements.storyId, storyIds))
          .orderBy(asc(storyElements.createdAt))
      : []
  const [impressionRows, interactionRows, earningsRows] =
    storyIds.length > 0
      ? await Promise.all([
          getDb()
            .select({
              storyId: feedImpressions.storyId,
              views: sql<DbNumber>`count(*)::int`,
            })
            .from(feedImpressions)
            .where(inArray(feedImpressions.storyId, storyIds))
            .groupBy(feedImpressions.storyId),
          getDb()
            .select({
              storyId: storyInteractions.storyId,
              replies: sql<DbNumber>`coalesce(sum(case when ${storyInteractions.kind} = 'reply' then 1 else 0 end), 0)::int`,
            })
            .from(storyInteractions)
            .where(inArray(storyInteractions.storyId, storyIds))
            .groupBy(storyInteractions.storyId),
          getDb()
            .select({
              storyId: earningsLedger.storyId,
              earningsCents: sql<DbNumber>`coalesce(sum(${earningsLedger.amountCents}), 0)::int`,
            })
            .from(earningsLedger)
            .where(inArray(earningsLedger.storyId, storyIds))
            .groupBy(earningsLedger.storyId),
        ])
      : [[], [], []]
  const elementsByStoryId = new Map<string, AdminModerationStoryElement[]>()
  const viewsByStoryId = new Map(
    impressionRows.map((row) => [row.storyId, toNumber(row.views)]),
  )
  const repliesByStoryId = new Map(
    interactionRows.map((row) => [row.storyId, toNumber(row.replies)]),
  )
  const earningsByStoryId = new Map(
    earningsRows.map((row) => [row.storyId, toNumber(row.earningsCents)]),
  )

  for (const element of elementRows) {
    const current = elementsByStoryId.get(element.storyId) ?? []

    current.push({
      id: element.id,
      kind: element.kind,
      label: element.label,
      href: element.href,
      positionX: element.positionX,
      positionY: element.positionY,
    })
    elementsByStoryId.set(element.storyId, current)
  }

  return flaggedStories.map((story) => ({
    ...story,
    mediaUrl: publicStoryMediaUrl(story.mediaUrl) ?? story.mediaUrl,
    thumbnailUrl: publicStoryMediaUrl(story.thumbnailUrl),
    creatorAvatarUrl: publicProfileAvatarUrl(story.creatorAvatarUrl),
    stats: {
      views: viewsByStoryId.get(story.id) ?? 0,
      replies: repliesByStoryId.get(story.id) ?? 0,
      earningsCents: earningsByStoryId.get(story.id) ?? 0,
    },
    moderationCheck: latestChecks.get(story.id) ?? null,
    elements: elementsByStoryId.get(story.id) ?? [],
  }))
}

export async function approveModeratedStory(input: {
  storyId: string
  reviewerId: string
}) {
  await getDb()
    .update(stories)
    .set({
      status: "live",
      moderationStatus: "approved",
      moderationReason: null,
      reviewedAt: new Date(),
      reviewedByUserId: input.reviewerId,
    })
    .where(eq(stories.id, input.storyId))

  await processStoryCreatorEarnings(input.storyId)
}

export async function rejectModeratedStory(input: {
  storyId: string
  reviewerId: string
}) {
  await reverseUnpaidStoryEarnings(input.storyId)

  await getDb()
    .update(stories)
    .set({
      status: "removed",
      moderationStatus: "rejected",
      reviewedAt: new Date(),
      reviewedByUserId: input.reviewerId,
    })
    .where(eq(stories.id, input.storyId))
}

export async function settleAdminCreatorPayout(userId: string) {
  return settleCreatorPayouts(userId)
}
