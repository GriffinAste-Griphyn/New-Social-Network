import { redirect } from "next/navigation"
import { and, desc, eq, sql } from "drizzle-orm"

import { requireSession, type CompleteAuthSession } from "@/lib/auth"
import { processStoryCreatorEarnings, reverseUnpaidStoryEarnings } from "@/lib/creator-earnings"
import { getDb } from "@/lib/db"
import {
  advertiserAccounts,
  advertiserWalletTransactions,
  brandFundingProfiles,
  stories,
  users,
} from "@/lib/db/schema"
import { env } from "@/lib/env"

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
}

function toNumber(value: DbNumber) {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)

  return 0
}

function getAdminEmails() {
  const configuredEmails = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  return Array.from(
    new Set(["griffin.aste@gmail.com", ...configuredEmails]),
  )
}

export function isAdminSession(session: CompleteAuthSession) {
  const adminEmails = getAdminEmails()

  if (adminEmails.length === 0) {
    return process.env.NODE_ENV !== "production"
  }

  return adminEmails.includes(session.email.toLowerCase())
}

export async function requireAdminSession() {
  const session = await requireSession("/admin")

  if (!isAdminSession(session)) {
    redirect("/feed")
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
  }
}

export async function listFlaggedStories(): Promise<AdminModerationStory[]> {
  return getDb()
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
    })
    .from(stories)
    .innerJoin(users, eq(users.id, stories.creatorId))
    .where(eq(stories.moderationStatus, "flagged"))
    .orderBy(desc(stories.createdAt))
    .limit(50)
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
