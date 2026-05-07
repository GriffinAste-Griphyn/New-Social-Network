import { randomUUID } from "node:crypto"

import { and, desc, eq, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  advertiserAccounts,
  advertiserMembers,
  advertiserWalletTransactions,
  brandMatchEvents,
  brandFundingProfiles,
  brandFundingTargets,
  stories,
  users,
} from "@/lib/db/schema"

type DbNumber = bigint | number | string | null

export type AdvertiserAccount = typeof advertiserAccounts.$inferSelect
export type BrandFundingProfile = typeof brandFundingProfiles.$inferSelect
export type BrandFundingTarget = typeof brandFundingTargets.$inferSelect
export type AdvertiserWalletTransaction =
  typeof advertiserWalletTransactions.$inferSelect
export type AdvertiserPayoutReport = {
  id: string
  creatorId: string
  creatorName: string | null
  creatorHandle: string | null
  storyId: string
  storyCaption: string | null
  amountCents: number | null
  status: typeof brandMatchEvents.$inferSelect.status
  createdAt: Date
}

export type AdvertiserWorkspace = {
  account: AdvertiserAccount
  profile: BrandFundingProfile | null
  targets: BrandFundingTarget[]
  balanceCents: number
  pendingCents: number
  totalPaidCents: number
  transactions: AdvertiserWalletTransaction[]
  payoutReports: AdvertiserPayoutReport[]
}

function toNumber(value: DbNumber) {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)

  return 0
}

export async function getAdvertiserWorkspaceForUser(
  userId: string,
): Promise<AdvertiserWorkspace | null> {
  const db = getDb()
  const [account] = await db
    .select()
    .from(advertiserAccounts)
    .innerJoin(
      advertiserMembers,
      eq(advertiserMembers.advertiserAccountId, advertiserAccounts.id),
    )
    .where(eq(advertiserMembers.userId, userId))
    .limit(1)

  if (!account) {
    return null
  }

  const advertiserAccount = account.advertiser_accounts
  const [profile] = await db
    .select()
    .from(brandFundingProfiles)
    .where(eq(brandFundingProfiles.advertiserAccountId, advertiserAccount.id))
    .orderBy(desc(brandFundingProfiles.createdAt))
    .limit(1)

  const [postedBalance] = await db
    .select({
      amountCents: sql<DbNumber>`coalesce(sum(${advertiserWalletTransactions.amountCents}), 0)::int`,
    })
    .from(advertiserWalletTransactions)
    .where(
      and(
        eq(advertiserWalletTransactions.advertiserAccountId, advertiserAccount.id),
        eq(advertiserWalletTransactions.status, "posted"),
      ),
    )

  const [pendingBalance] = await db
    .select({
      amountCents: sql<DbNumber>`coalesce(sum(${advertiserWalletTransactions.amountCents}), 0)::int`,
    })
    .from(advertiserWalletTransactions)
    .where(
      and(
        eq(advertiserWalletTransactions.advertiserAccountId, advertiserAccount.id),
        eq(advertiserWalletTransactions.status, "pending"),
      ),
    )

  const [paidTotal, targets, transactions, payoutReports] = await Promise.all([
    db
      .select({
        amountCents: sql<DbNumber>`coalesce(sum(${brandMatchEvents.systemPricedAmountCents}), 0)::int`,
      })
      .from(brandMatchEvents)
      .where(
        and(
          eq(brandMatchEvents.advertiserAccountId, advertiserAccount.id),
          eq(brandMatchEvents.status, "paid"),
        ),
      ),
    profile
      ? db
          .select()
          .from(brandFundingTargets)
          .where(eq(brandFundingTargets.profileId, profile.id))
          .orderBy(desc(brandFundingTargets.createdAt))
      : Promise.resolve([]),
    db
      .select()
      .from(advertiserWalletTransactions)
      .where(
        eq(advertiserWalletTransactions.advertiserAccountId, advertiserAccount.id),
      )
      .orderBy(desc(advertiserWalletTransactions.createdAt))
      .limit(12),
    db
      .select({
        id: brandMatchEvents.id,
        creatorId: users.id,
        creatorName: users.displayName,
        creatorHandle: users.handle,
        storyId: stories.id,
        storyCaption: stories.caption,
        amountCents: brandMatchEvents.systemPricedAmountCents,
        status: brandMatchEvents.status,
        createdAt: brandMatchEvents.createdAt,
      })
      .from(brandMatchEvents)
      .innerJoin(users, eq(users.id, brandMatchEvents.creatorId))
      .innerJoin(stories, eq(stories.id, brandMatchEvents.storyId))
      .where(eq(brandMatchEvents.advertiserAccountId, advertiserAccount.id))
      .orderBy(desc(brandMatchEvents.createdAt))
      .limit(12),
  ])

  return {
    account: advertiserAccount,
    profile: profile ?? null,
    targets,
    balanceCents: toNumber(postedBalance?.amountCents),
    pendingCents: toNumber(pendingBalance?.amountCents),
    totalPaidCents: toNumber(paidTotal[0]?.amountCents),
    transactions,
    payoutReports: payoutReports.map((report) => ({
      ...report,
      amountCents:
        report.amountCents === null ? null : toNumber(report.amountCents),
    })),
  }
}

export async function createAdvertiserAccount(input: {
  ownerUserId: string
  name: string
  websiteUrl?: string | null
  billingEmail: string
}) {
  const db = getDb()
  const accountId = `advertiser-${randomUUID()}`
  const profileId = `brand-funding-profile-${randomUUID()}`

  const [account] = await db
    .insert(advertiserAccounts)
    .values({
      id: accountId,
      ownerUserId: input.ownerUserId,
      name: input.name,
      websiteUrl: input.websiteUrl,
      billingEmail: input.billingEmail,
    })
    .returning()

  await db.insert(advertiserMembers).values({
    advertiserAccountId: account.id,
    userId: input.ownerUserId,
    role: "owner",
  })

  await db.insert(brandFundingProfiles).values({
    id: profileId,
    advertiserAccountId: account.id,
    displayName: account.name,
    status: "draft",
    approvalMode: "auto",
  })

  return account
}

export async function updateAdvertiserStripeCustomer(input: {
  advertiserAccountId: string
  stripeCustomerId: string
}) {
  const db = getDb()

  await db
    .update(advertiserAccounts)
    .set({
      stripeCustomerId: input.stripeCustomerId,
      updatedAt: new Date(),
    })
    .where(eq(advertiserAccounts.id, input.advertiserAccountId))
}

export async function updateAdvertiserAccount(input: {
  advertiserAccountId: string
  name: string
  websiteUrl: string | null
  billingEmail: string
}) {
  const db = getDb()

  await db
    .update(advertiserAccounts)
    .set({
      name: input.name,
      websiteUrl: input.websiteUrl,
      billingEmail: input.billingEmail,
      updatedAt: new Date(),
    })
    .where(eq(advertiserAccounts.id, input.advertiserAccountId))
}

export async function updateBrandFundingProfile(input: {
  profileId: string
  advertiserAccountId: string
  status: "draft" | "active" | "paused"
  displayName: string
  approvalMode: string
  payoutAmountCents: number | null
  dailyCapCents: number | null
  monthlyCapCents: number | null
  allowedCategories: string | null
  blockedCategories: string | null
  notes: string | null
  targets: Array<{
    kind: typeof brandFundingTargets.$inferInsert.kind
    value: string
  }>
}) {
  const db = getDb()

  await db
    .update(brandFundingProfiles)
    .set({
      status: input.status,
      displayName: input.displayName,
      approvalMode: input.approvalMode,
      payoutAmountCents: input.payoutAmountCents,
      dailyCapCents: input.dailyCapCents,
      monthlyCapCents: input.monthlyCapCents,
      allowedCategories: input.allowedCategories,
      blockedCategories: input.blockedCategories,
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(brandFundingProfiles.id, input.profileId),
        eq(brandFundingProfiles.advertiserAccountId, input.advertiserAccountId),
      ),
    )

  await db
    .delete(brandFundingTargets)
    .where(eq(brandFundingTargets.profileId, input.profileId))

  if (input.targets.length > 0) {
    await db.insert(brandFundingTargets).values(
      input.targets.map((target) => ({
        id: `brand-funding-target-${randomUUID()}`,
        profileId: input.profileId,
        kind: target.kind,
        value: target.value,
      })),
    )
  }
}

export async function createPendingWalletFunding(input: {
  advertiserAccountId: string
  amountCents: number
  currency: string
  stripeCheckoutSessionId: string
}) {
  const db = getDb()

  await db.insert(advertiserWalletTransactions).values({
    id: `advertiser-wallet-${randomUUID()}`,
    advertiserAccountId: input.advertiserAccountId,
    type: "funding",
    status: "pending",
    amountCents: input.amountCents,
    currency: input.currency,
    description: "Stripe Checkout wallet funding",
    stripeCheckoutSessionId: input.stripeCheckoutSessionId,
  })
}

export async function postWalletFundingFromStripe(input: {
  advertiserAccountId: string
  amountCents: number
  currency: string
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
}) {
  const db = getDb()
  const [existing] = await db
    .select({ id: advertiserWalletTransactions.id })
    .from(advertiserWalletTransactions)
    .where(
      eq(
        advertiserWalletTransactions.stripeCheckoutSessionId,
        input.stripeCheckoutSessionId,
      ),
    )
    .limit(1)

  if (existing) {
    await db
      .update(advertiserWalletTransactions)
      .set({
        status: "posted",
        amountCents: input.amountCents,
        currency: input.currency,
        stripePaymentIntentId: input.stripePaymentIntentId,
        postedAt: new Date(),
      })
      .where(eq(advertiserWalletTransactions.id, existing.id))
    return
  }

  await db.insert(advertiserWalletTransactions).values({
    id: `advertiser-wallet-${randomUUID()}`,
    advertiserAccountId: input.advertiserAccountId,
    type: "funding",
    status: "posted",
    amountCents: input.amountCents,
    currency: input.currency,
    description: "Stripe Checkout wallet funding",
    stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    stripePaymentIntentId: input.stripePaymentIntentId,
    postedAt: new Date(),
  })
}
