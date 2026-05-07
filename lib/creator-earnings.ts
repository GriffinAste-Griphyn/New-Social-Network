import { randomUUID } from "node:crypto"

import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm"
import type Stripe from "stripe"

import { getDb } from "@/lib/db"
import {
  advertiserAccounts,
  advertiserWalletTransactions,
  brandFundingProfiles,
  brandFundingTargets,
  brandMatchEvents,
  earningsLedger,
  stories,
  storyMentions,
} from "@/lib/db/schema"
import { getStripeClient } from "@/lib/stripe"
import { getCreatorStripeStatus } from "@/lib/stripe-connect"

type DbNumber = bigint | number | string | null

type EligibleFundingRow = {
  advertiserAccountId: string
  ownerUserId: string
  profileId: string
  payoutAmountCents: number | null
  dailyCapCents: number | null
  monthlyCapCents: number | null
  targetId: string
  targetKind: typeof brandFundingTargets.$inferSelect.kind
  targetValue: string
}

function toNumber(value: DbNumber) {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)

  return 0
}

function startOfDay() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function startOfMonth() {
  const date = new Date()
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date
}

function normalizeMatchValue(value: string) {
  return value
    .trim()
    .replace(/^[@#]+/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
}

async function getAdvertiserBalanceCents(advertiserAccountId: string) {
  const [row] = await getDb()
    .select({
      amountCents: sql<DbNumber>`coalesce(sum(${advertiserWalletTransactions.amountCents}), 0)::int`,
    })
    .from(advertiserWalletTransactions)
    .where(
      and(
        eq(advertiserWalletTransactions.advertiserAccountId, advertiserAccountId),
        eq(advertiserWalletTransactions.status, "posted"),
      ),
    )

  return toNumber(row?.amountCents)
}

async function getCapturedTotalSince(input: {
  advertiserAccountId: string
  from: Date
}) {
  const [row] = await getDb()
    .select({
      amountCents: sql<DbNumber>`coalesce(sum(${brandMatchEvents.systemPricedAmountCents}), 0)::int`,
    })
    .from(brandMatchEvents)
    .where(
      and(
        eq(brandMatchEvents.advertiserAccountId, input.advertiserAccountId),
        inArray(brandMatchEvents.status, ["charged", "paid"]),
        gte(brandMatchEvents.createdAt, input.from),
      ),
    )

  return toNumber(row?.amountCents)
}

async function hasCapCapacity(row: EligibleFundingRow, amountCents: number) {
  if (row.dailyCapCents !== null) {
    const dailyTotal = await getCapturedTotalSince({
      advertiserAccountId: row.advertiserAccountId,
      from: startOfDay(),
    })

    if (dailyTotal + amountCents > row.dailyCapCents) {
      return false
    }
  }

  if (row.monthlyCapCents !== null) {
    const monthlyTotal = await getCapturedTotalSince({
      advertiserAccountId: row.advertiserAccountId,
      from: startOfMonth(),
    })

    if (monthlyTotal + amountCents > row.monthlyCapCents) {
      return false
    }
  }

  return true
}

async function listEligibleFundingRows(mentionValues: Set<string>) {
  if (mentionValues.size === 0) {
    return []
  }

  const rows = await getDb()
    .select({
      advertiserAccountId: advertiserAccounts.id,
      ownerUserId: advertiserAccounts.ownerUserId,
      profileId: brandFundingProfiles.id,
      payoutAmountCents: brandFundingProfiles.payoutAmountCents,
      dailyCapCents: brandFundingProfiles.dailyCapCents,
      monthlyCapCents: brandFundingProfiles.monthlyCapCents,
      targetId: brandFundingTargets.id,
      targetKind: brandFundingTargets.kind,
      targetValue: brandFundingTargets.value,
    })
    .from(brandFundingProfiles)
    .innerJoin(
      advertiserAccounts,
      eq(advertiserAccounts.id, brandFundingProfiles.advertiserAccountId),
    )
    .innerJoin(
      brandFundingTargets,
      eq(brandFundingTargets.profileId, brandFundingProfiles.id),
    )
    .where(eq(brandFundingProfiles.status, "active"))

  const seenProfiles = new Set<string>()

  return rows.flatMap((row) => {
    if (
      row.targetKind === "exclusion" ||
      row.payoutAmountCents === null ||
      row.payoutAmountCents <= 0 ||
      seenProfiles.has(row.profileId)
    ) {
      return []
    }

    if (!mentionValues.has(normalizeMatchValue(row.targetValue))) {
      return []
    }

    seenProfiles.add(row.profileId)
    return [row]
  })
}

async function createBrandMatchLedgerEntry(input: {
  storyId: string
  creatorId: string
  funding: EligibleFundingRow
}) {
  const amountCents = input.funding.payoutAmountCents ?? 0

  if (amountCents <= 0 || input.funding.ownerUserId === input.creatorId) {
    return null
  }

  const [existing] = await getDb()
    .select({
      id: brandMatchEvents.id,
      status: brandMatchEvents.status,
    })
    .from(brandMatchEvents)
    .where(
      and(
        eq(brandMatchEvents.storyId, input.storyId),
        eq(brandMatchEvents.fundingProfileId, input.funding.profileId),
      ),
    )
    .limit(1)

  if (existing && existing.status !== "rejected") {
    return existing.id
  }

  const [balanceCents, hasCapacity] = await Promise.all([
    getAdvertiserBalanceCents(input.funding.advertiserAccountId),
    hasCapCapacity(input.funding, amountCents),
  ])

  if (!hasCapacity || balanceCents < amountCents) {
    return null
  }

  const walletTransactionId = `advertiser-wallet-${randomUUID()}`
  const eventId = `brand-match-${randomUUID()}`
  const ledgerId = `earnings-ledger-${randomUUID()}`
  const now = new Date()

  await getDb().insert(advertiserWalletTransactions).values({
    id: walletTransactionId,
    advertiserAccountId: input.funding.advertiserAccountId,
    type: "capture",
    status: "posted",
    amountCents: -amountCents,
    currency: "usd",
    description: "Creator payout for qualified brand story match",
    postedAt: now,
  })

  const event = existing
    ? existing
    : (
        await getDb()
          .insert(brandMatchEvents)
          .values({
            id: eventId,
            advertiserAccountId: input.funding.advertiserAccountId,
            fundingProfileId: input.funding.profileId,
            storyId: input.storyId,
            creatorId: input.creatorId,
            matchedTargetId: input.funding.targetId,
            status: "charged",
            confidence: "1.00",
            systemPricedAmountCents: amountCents,
            walletTransactionId,
          })
          .onConflictDoNothing()
          .returning({ id: brandMatchEvents.id })
      )[0]

  if (!event) {
    await releaseDuplicateCapture({
      advertiserAccountId: input.funding.advertiserAccountId,
      amountCents,
    })
    return null
  }

  if (existing) {
    await getDb()
      .update(brandMatchEvents)
      .set({
        advertiserAccountId: input.funding.advertiserAccountId,
        matchedTargetId: input.funding.targetId,
        status: "charged",
        confidence: "1.00",
        systemPricedAmountCents: amountCents,
        walletTransactionId,
      })
      .where(eq(brandMatchEvents.id, existing.id))
  }

  const [ledger] = await getDb()
    .select({ id: earningsLedger.id })
    .from(earningsLedger)
    .where(
      and(
        eq(earningsLedger.source, "brand_match"),
        eq(earningsLedger.sourceId, event.id),
        eq(earningsLedger.userId, input.creatorId),
      ),
    )
    .limit(1)

  if (ledger) {
    await getDb()
      .update(earningsLedger)
      .set({
        storyId: input.storyId,
        status: "approved",
        amountCents,
        availableAt: now,
        stripeTransferStatus: null,
        paidAt: null,
        updatedAt: now,
      })
      .where(eq(earningsLedger.id, ledger.id))
  } else {
    await getDb()
      .insert(earningsLedger)
      .values({
        id: ledgerId,
        userId: input.creatorId,
        storyId: input.storyId,
        source: "brand_match",
        sourceId: event.id,
        status: "approved",
        amountCents,
        availableAt: now,
      })
      .onConflictDoNothing()
  }

  return event.id
}

async function releaseDuplicateCapture(input: {
  advertiserAccountId: string
  amountCents: number
}) {
  await getDb().insert(advertiserWalletTransactions).values({
    id: `advertiser-wallet-${randomUUID()}`,
    advertiserAccountId: input.advertiserAccountId,
    type: "release",
    status: "posted",
    amountCents: input.amountCents,
    currency: "usd",
    description: "Released duplicate creator payout capture",
    postedAt: new Date(),
  })
}

export async function processStoryCreatorEarnings(storyId: string) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      status: stories.status,
    })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1)

  if (!story || story.status === "removed") {
    return { matched: 0, settled: 0 }
  }

  const mentions = await db
    .select({ brandSlug: storyMentions.brandSlug })
    .from(storyMentions)
    .where(eq(storyMentions.storyId, story.id))

  const mentionValues = new Set(
    mentions.map((mention) => normalizeMatchValue(mention.brandSlug)),
  )
  const fundingRows = await listEligibleFundingRows(mentionValues)
  const eventIds: string[] = []

  for (const funding of fundingRows) {
    const eventId = await createBrandMatchLedgerEntry({
      storyId: story.id,
      creatorId: story.creatorId,
      funding,
    })

    if (eventId) {
      eventIds.push(eventId)
    }
  }

  const settlement = await settleCreatorPayouts(story.creatorId)

  return {
    matched: eventIds.length,
    settled: settlement.paidCount,
  }
}

export async function settleCreatorPayouts(userId: string) {
  const stripe = getStripeClient()

  if (!stripe) {
    return { paidCount: 0, skippedReason: "stripe_not_configured" as const }
  }

  const status = await getCreatorStripeStatus(userId)

  if (
    !status.stripeConnectedAccountId ||
    !status.stripePayoutsEnabled ||
    !status.stripeOnboardingComplete
  ) {
    return { paidCount: 0, skippedReason: "stripe_not_ready" as const }
  }

  const rows = await getDb()
    .select({
      id: earningsLedger.id,
      userId: earningsLedger.userId,
      storyId: earningsLedger.storyId,
      sourceId: earningsLedger.sourceId,
      amountCents: earningsLedger.amountCents,
    })
    .from(earningsLedger)
    .where(
      and(
        eq(earningsLedger.userId, userId),
        eq(earningsLedger.status, "approved"),
        isNull(earningsLedger.stripeTransferId),
        or(isNull(earningsLedger.availableAt), lte(earningsLedger.availableAt, new Date())),
      ),
    )
    .orderBy(desc(earningsLedger.createdAt))
    .limit(25)

  let paidCount = 0

  for (const row of rows) {
    if (row.amountCents <= 0) {
      continue
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: row.amountCents,
          currency: "usd",
          destination: status.stripeConnectedAccountId,
          metadata: {
            ledgerId: row.id,
            userId: row.userId,
            storyId: row.storyId ?? "",
            sourceId: row.sourceId,
          },
        },
        {
          idempotencyKey: `creator-payout-${row.id}`,
        },
      )

      await markLedgerTransferPaid({
        ledgerId: row.id,
        brandMatchEventId: row.sourceId,
        stripeTransferId: transfer.id,
        stripeTransferStatus: "succeeded",
      })
      paidCount += 1
    } catch (error) {
      await getDb()
        .update(earningsLedger)
        .set({
          stripeTransferStatus:
            error instanceof Error ? error.message.slice(0, 200) : "failed",
          updatedAt: new Date(),
        })
        .where(eq(earningsLedger.id, row.id))
    }
  }

  return { paidCount, skippedReason: null }
}

async function markLedgerTransferPaid(input: {
  ledgerId: string
  brandMatchEventId: string
  stripeTransferId: string
  stripeTransferStatus: string
}) {
  const now = new Date()

  await getDb()
    .update(earningsLedger)
    .set({
      status: "paid",
      stripeTransferId: input.stripeTransferId,
      stripeTransferStatus: input.stripeTransferStatus,
      paidAt: now,
      updatedAt: now,
    })
    .where(eq(earningsLedger.id, input.ledgerId))

  await getDb()
    .update(brandMatchEvents)
    .set({ status: "paid" })
    .where(eq(brandMatchEvents.id, input.brandMatchEventId))
}

export async function syncCreatorLedgerTransferFromWebhook(
  transfer: Stripe.Transfer,
) {
  const ledgerId = transfer.metadata?.ledgerId

  if (!ledgerId) {
    return
  }

  if (transfer.amount_reversed && transfer.amount_reversed > 0) {
    const [ledger] = await getDb()
      .select({ sourceId: earningsLedger.sourceId })
      .from(earningsLedger)
      .where(eq(earningsLedger.id, ledgerId))
      .limit(1)

    await getDb()
      .update(earningsLedger)
      .set({
        status: "reversed",
        stripeTransferId: transfer.id,
        stripeTransferStatus: "reversed",
        updatedAt: new Date(),
      })
      .where(eq(earningsLedger.id, ledgerId))

    if (ledger?.sourceId) {
      await getDb()
        .update(brandMatchEvents)
        .set({ status: "rejected" })
        .where(eq(brandMatchEvents.id, ledger.sourceId))
    }
    return
  }

  await markLedgerTransferPaid({
    ledgerId,
    brandMatchEventId: transfer.metadata?.sourceId ?? "",
    stripeTransferId: transfer.id,
    stripeTransferStatus: "succeeded",
  })
}

export async function reverseUnpaidStoryEarnings(storyId: string) {
  const rows = await getDb()
    .select({
      id: earningsLedger.id,
      sourceId: earningsLedger.sourceId,
      amountCents: earningsLedger.amountCents,
      advertiserAccountId: brandMatchEvents.advertiserAccountId,
    })
    .from(earningsLedger)
    .innerJoin(brandMatchEvents, eq(brandMatchEvents.id, earningsLedger.sourceId))
    .where(
      and(
        eq(earningsLedger.storyId, storyId),
        inArray(earningsLedger.status, ["pending", "approved"]),
      ),
    )

  for (const row of rows) {
    await getDb().insert(advertiserWalletTransactions).values({
      id: `advertiser-wallet-${randomUUID()}`,
      advertiserAccountId: row.advertiserAccountId,
      type: "release",
      status: "posted",
      amountCents: row.amountCents,
      currency: "usd",
      description: "Released unpaid creator payout after story removal",
      postedAt: new Date(),
    })

    await getDb()
      .update(earningsLedger)
      .set({
        status: "reversed",
        updatedAt: new Date(),
      })
      .where(eq(earningsLedger.id, row.id))

    await getDb()
      .update(brandMatchEvents)
      .set({ status: "rejected" })
      .where(eq(brandMatchEvents.id, row.sourceId))
  }
}
