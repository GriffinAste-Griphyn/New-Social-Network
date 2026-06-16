import { randomInt, randomUUID } from "node:crypto"

import { and, asc, desc, eq, gt, lt, lte, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  advertiserWalletTransactions,
  dailyAdViews,
  dailyCampaigns,
  dailyPoolEntries,
  dailyPools,
  dailySessionAds,
  dailySessions,
  dailyWinners,
  earningsLedger,
} from "@/lib/db/schema"

type DbNumber = bigint | number | string | null

export const dailyAdsRequired = 5
export const dailyWinnerCount = 5
export const dailyPoolSharePercent = 75
export const dailyTimeZone = "America/New_York"
export const dailyRolloverHour = 21
export const dailyDrawDelayMinutes = 10

const oneDayMs = 24 * 60 * 60 * 1000
const easternFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: dailyTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})

type EasternParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

type DailyCampaignRow = typeof dailyCampaigns.$inferSelect
type DailySessionRow = typeof dailySessions.$inferSelect

export class DailyError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "DailyError"
    this.status = status
  }
}

function toNumber(value: DbNumber) {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)

  return 0
}

function easternParts(date: Date): EasternParts {
  const values = Object.fromEntries(
    easternFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  )

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  }
}

function calendarKey(parts: Pick<EasternParts, "year" | "month" | "day">) {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-")
}

function previousCalendarDay(parts: Pick<EasternParts, "year" | "month" | "day">) {
  const previous = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) - oneDayMs,
  )

  return {
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
    day: previous.getUTCDate(),
  }
}

function parsePoolDate(poolDate: string) {
  const [year, month, day] = poolDate.split("-").map(Number)

  if (!year || !month || !day) {
    throw new DailyError("Invalid Daily pool date.", 400)
  }

  return { year, month, day }
}

function zonedDateTimeToUtc(input: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second?: number
}) {
  const targetUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second ?? 0,
  )
  let guess = targetUtc

  for (let index = 0; index < 4; index += 1) {
    const parts = easternParts(new Date(guess))
    const apparentUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    )
    const delta = apparentUtc - targetUtc

    if (delta === 0) {
      break
    }

    guess -= delta
  }

  return new Date(guess)
}

export function getDailyPeriod(now = new Date()) {
  const local = easternParts(now)
  const startDate =
    local.hour >= dailyRolloverHour ? local : previousCalendarDay(local)
  const poolDate = calendarKey(startDate)
  const periodStartsAt = zonedDateTimeToUtc({
    ...startDate,
    hour: dailyRolloverHour,
    minute: 0,
  })
  const periodEndsAt = new Date(periodStartsAt.getTime() + oneDayMs)
  const drawAt = new Date(periodEndsAt.getTime() + dailyDrawDelayMinutes * 60 * 1000)

  return {
    poolDate,
    periodStartsAt,
    periodEndsAt,
    drawAt,
    timeZone: dailyTimeZone,
    rolloverLabel: "9:00 PM ET",
    drawLabel: "9:10 PM ET",
  }
}

export function getDailyPeriodForPoolDate(poolDate: string) {
  const startDate = parsePoolDate(poolDate)
  const periodStartsAt = zonedDateTimeToUtc({
    ...startDate,
    hour: dailyRolloverHour,
    minute: 0,
  })
  const periodEndsAt = new Date(periodStartsAt.getTime() + oneDayMs)
  const drawAt = new Date(periodEndsAt.getTime() + dailyDrawDelayMinutes * 60 * 1000)

  return {
    poolDate,
    periodStartsAt,
    periodEndsAt,
    drawAt,
    timeZone: dailyTimeZone,
    rolloverLabel: "9:00 PM ET",
    drawLabel: "9:10 PM ET",
  }
}

async function campaignCompletedImpressionsForDate(
  campaignId: string,
  poolDate: string,
) {
  const [row] = await getDb()
    .select({
      count: sql<DbNumber>`count(*)::int`,
    })
    .from(dailyAdViews)
    .innerJoin(dailySessions, eq(dailySessions.id, dailyAdViews.sessionId))
    .where(
      and(
        eq(dailyAdViews.campaignId, campaignId),
        eq(dailyAdViews.status, "completed"),
        eq(dailySessions.poolDate, poolDate),
      ),
    )

  return toNumber(row?.count)
}

async function listAvailableCampaigns(now: Date, poolDate: string) {
  const rows = await getDb()
    .select()
    .from(dailyCampaigns)
    .where(
      and(
        eq(dailyCampaigns.status, "active"),
        lte(dailyCampaigns.startsAt, now),
        gt(dailyCampaigns.endsAt, now),
      ),
    )
    .orderBy(asc(dailyCampaigns.createdAt))

  const available: DailyCampaignRow[] = []

  for (const row of rows) {
    if (row.maxDailyImpressions === null) {
      available.push(row)
      continue
    }

    const impressions = await campaignCompletedImpressionsForDate(
      row.id,
      poolDate,
    )

    if (impressions < row.maxDailyImpressions) {
      available.push(row)
    }
  }

  return available.slice(0, dailyAdsRequired)
}

async function getEstimatedPoolCents(now: Date, poolDate: string) {
  const campaigns = await listAvailableCampaigns(now, poolDate)
  const fundsCents = campaigns.reduce(
    (total, campaign) => total + campaign.dailyBudgetCents,
    0,
  )

  return Math.floor((fundsCents * dailyPoolSharePercent) / 100)
}

async function getEntryForDate(userId: string, poolDate: string) {
  const [entry] = await getDb()
    .select()
    .from(dailyPoolEntries)
    .where(
      and(
        eq(dailyPoolEntries.userId, userId),
        eq(dailyPoolEntries.poolDate, poolDate),
      ),
    )
    .limit(1)

  return entry ?? null
}

async function getSessionForDate(userId: string, poolDate: string) {
  const [session] = await getDb()
    .select()
    .from(dailySessions)
    .where(
      and(eq(dailySessions.userId, userId), eq(dailySessions.poolDate, poolDate)),
    )
    .orderBy(desc(dailySessions.createdAt))
    .limit(1)

  return session ?? null
}

export async function getDailySessionPayload(sessionId: string, userId: string) {
  const [session] = await getDb()
    .select()
    .from(dailySessions)
    .where(and(eq(dailySessions.id, sessionId), eq(dailySessions.userId, userId)))
    .limit(1)

  if (!session) {
    return null
  }

  const rows = await getDb()
    .select({
      position: dailySessionAds.position,
      campaignId: dailyCampaigns.id,
      brandName: dailyCampaigns.brandName,
      videoUrl: dailyCampaigns.videoUrl,
      thumbnailUrl: dailyCampaigns.thumbnailUrl,
      destinationUrl: dailyCampaigns.destinationUrl,
      ctaText: dailyCampaigns.ctaText,
      viewStatus: dailyAdViews.status,
      lastPositionMs: dailyAdViews.lastPositionMs,
      durationMs: dailyAdViews.durationMs,
    })
    .from(dailySessionAds)
    .innerJoin(dailyCampaigns, eq(dailyCampaigns.id, dailySessionAds.campaignId))
    .innerJoin(
      dailyAdViews,
      and(
        eq(dailyAdViews.sessionId, dailySessionAds.sessionId),
        eq(dailyAdViews.position, dailySessionAds.position),
      ),
    )
    .where(eq(dailySessionAds.sessionId, session.id))
    .orderBy(asc(dailySessionAds.position))

  return {
    id: session.id,
    poolDate: session.poolDate,
    status: session.status,
    currentAdIndex: session.currentAdIndex,
    currentPositionMs: session.currentPositionMs,
    ads: rows.map((row) => ({
      campaignId: row.campaignId,
      position: row.position,
      brandName: row.brandName,
      videoUrl: row.videoUrl,
      thumbnailUrl: row.thumbnailUrl,
      destinationUrl: row.destinationUrl,
      ctaText: row.ctaText,
      viewStatus: row.viewStatus,
      lastPositionMs: row.lastPositionMs,
      durationMs: row.durationMs,
    })),
  }
}

export async function getDailyStatusForUser(userId: string, now = new Date()) {
  const period = getDailyPeriod(now)
  const [session, entry, estimatedPoolCents] = await Promise.all([
    getSessionForDate(userId, period.poolDate),
    getEntryForDate(userId, period.poolDate),
    getEstimatedPoolCents(now, period.poolDate),
  ])

  const activeSession = session
    ? await getDailySessionPayload(session.id, userId)
    : null
  const status = entry
    ? "entered"
    : activeSession?.status === "started" || activeSession?.status === "paused"
      ? "in_progress"
      : "available"

  return {
    ok: true,
    daily: {
      poolDate: period.poolDate,
      status,
      adsRequired: dailyAdsRequired,
      winnerCount: dailyWinnerCount,
      poolSharePercent: dailyPoolSharePercent,
      estimatedPoolCents,
      periodStartsAt: period.periodStartsAt.toISOString(),
      periodEndsAt: period.periodEndsAt.toISOString(),
      drawAt: period.drawAt.toISOString(),
      timeZone: period.timeZone,
      rolloverLabel: period.rolloverLabel,
      drawLabel: period.drawLabel,
      officialRulesUrl: "/daily-rules",
      appleDisclaimer:
        "Apple is not a sponsor of, involved in, or responsible for The Daily, winner selection, entries, or payouts.",
    },
    activeSession,
    entry: entry
      ? {
          id: entry.id,
          poolDate: entry.poolDate,
          status: entry.status,
          createdAt: entry.createdAt.toISOString(),
        }
      : null,
  }
}

export async function startDailySession(input: {
  userId: string
  eligibilityAccepted: boolean
  now?: Date
}) {
  if (!input.eligibilityAccepted) {
    throw new DailyError("Confirm Daily eligibility before starting.", 400)
  }

  const now = input.now ?? new Date()
  const period = getDailyPeriod(now)
  const existingEntry = await getEntryForDate(input.userId, period.poolDate)

  if (existingEntry) {
    return getDailyStatusForUser(input.userId, now)
  }

  const existingSession = await getSessionForDate(input.userId, period.poolDate)

  if (existingSession && existingSession.status !== "completed") {
    return getDailyStatusForUser(input.userId, now)
  }

  const campaigns = await listAvailableCampaigns(now, period.poolDate)

  if (campaigns.length < dailyAdsRequired) {
    throw new DailyError(
      "The Daily is waiting on enough approved video ads for today.",
      409,
    )
  }

  const sessionId = `daily-session-${randomUUID()}`

  await getDb().transaction(async (tx) => {
    await tx.insert(dailySessions).values({
      id: sessionId,
      userId: input.userId,
      poolDate: period.poolDate,
      status: "started",
      eligibilityAcceptedAt: now,
      startedAt: now,
      lastHeartbeatAt: now,
      updatedAt: now,
    })

    await tx.insert(dailySessionAds).values(
      campaigns.map((campaign, index) => ({
        id: `daily-session-ad-${randomUUID()}`,
        sessionId,
        campaignId: campaign.id,
        position: index,
      })),
    )

    await tx.insert(dailyAdViews).values(
      campaigns.map((campaign, index) => ({
        id: `daily-ad-view-${randomUUID()}`,
        sessionId,
        campaignId: campaign.id,
        position: index,
        status: "pending" as const,
      })),
    )
  })

  return getDailyStatusForUser(input.userId, now)
}

function quartilesFor(positionMs: number, durationMs: number | null | undefined) {
  if (!durationMs || durationMs <= 0) {
    return {}
  }

  const ratio = Math.max(0, Math.min(1, positionMs / durationMs))

  return {
    q25: ratio >= 0.25,
    q50: ratio >= 0.5,
    q75: ratio >= 0.75,
    q100: ratio >= 1,
  }
}

async function createEntryIfSessionComplete(
  userId: string,
  session: DailySessionRow,
  now: Date,
) {
  const [row] = await getDb()
    .select({ count: sql<DbNumber>`count(*)::int` })
    .from(dailyAdViews)
    .where(
      and(
        eq(dailyAdViews.sessionId, session.id),
        eq(dailyAdViews.status, "completed"),
      ),
    )

  if (toNumber(row?.count) < dailyAdsRequired) {
    return null
  }

  await getDb()
    .update(dailySessions)
    .set({
      status: "completed",
      currentAdIndex: dailyAdsRequired,
      currentPositionMs: 0,
      completedAt: now,
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(eq(dailySessions.id, session.id))

  const [entry] = await getDb()
    .insert(dailyPoolEntries)
    .values({
      id: `daily-entry-${randomUUID()}`,
      poolDate: session.poolDate,
      userId,
      sessionId: session.id,
      status: "eligible",
    })
    .onConflictDoNothing()
    .returning()

  return entry ?? (await getEntryForDate(userId, session.poolDate))
}

export async function recordDailyProgress(input: {
  userId: string
  sessionId: string
  position: number
  positionMs: number
  durationMs?: number | null
  event: "started" | "heartbeat" | "completed" | "exited"
  now?: Date
}) {
  const now = input.now ?? new Date()

  if (input.position < 0 || input.position >= dailyAdsRequired) {
    throw new DailyError("Invalid Daily ad position.", 400)
  }

  const [session] = await getDb()
    .select()
    .from(dailySessions)
    .where(
      and(eq(dailySessions.id, input.sessionId), eq(dailySessions.userId, input.userId)),
    )
    .limit(1)

  if (!session) {
    throw new DailyError("Daily session not found.", 404)
  }

  if (session.status === "completed") {
    return getDailyStatusForUser(input.userId, now)
  }

  const [view] = await getDb()
    .select()
    .from(dailyAdViews)
    .where(
      and(
        eq(dailyAdViews.sessionId, session.id),
        eq(dailyAdViews.position, input.position),
      ),
    )
    .limit(1)

  if (!view) {
    throw new DailyError("Daily ad view not found.", 404)
  }

  const durationMs = input.durationMs ?? view.durationMs
  const quartiles = {
    ...((view.quartiles ?? {}) as Record<string, boolean>),
    ...quartilesFor(input.positionMs, durationMs),
  }
  const nextStatus =
    input.event === "completed"
      ? "completed"
      : view.status === "completed"
        ? "completed"
        : input.event === "exited"
          ? view.status === "pending"
            ? "started"
            : view.status
          : "started"
  const nextAdIndex =
    input.event === "completed"
      ? Math.min(input.position + 1, dailyAdsRequired)
      : input.position

  await getDb()
    .update(dailyAdViews)
    .set({
      status: nextStatus,
      lastPositionMs: input.event === "completed" ? durationMs ?? input.positionMs : input.positionMs,
      durationMs,
      quartiles,
      startedAt: view.startedAt ?? now,
      completedAt: input.event === "completed" ? now : view.completedAt,
      updatedAt: now,
    })
    .where(eq(dailyAdViews.id, view.id))

  await getDb()
    .update(dailySessions)
    .set({
      status: input.event === "exited" ? "paused" : "started",
      currentAdIndex: nextAdIndex,
      currentPositionMs: input.event === "completed" ? 0 : input.positionMs,
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(eq(dailySessions.id, session.id))

  if (input.event === "completed") {
    await createEntryIfSessionComplete(input.userId, session, now)
  }

  return getDailyStatusForUser(input.userId, now)
}

export async function recordDailyClick(input: {
  userId: string
  sessionId: string
  position: number
  positionMs: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  const [row] = await getDb()
    .select({
      sessionId: dailySessions.id,
      userId: dailySessions.userId,
      campaignId: dailyCampaigns.id,
      destinationUrl: dailyCampaigns.destinationUrl,
      viewId: dailyAdViews.id,
    })
    .from(dailySessions)
    .innerJoin(
      dailyAdViews,
      and(
        eq(dailyAdViews.sessionId, dailySessions.id),
        eq(dailyAdViews.position, input.position),
      ),
    )
    .innerJoin(dailyCampaigns, eq(dailyCampaigns.id, dailyAdViews.campaignId))
    .where(
      and(eq(dailySessions.id, input.sessionId), eq(dailySessions.userId, input.userId)),
    )
    .limit(1)

  if (!row) {
    throw new DailyError("Daily ad click target not found.", 404)
  }

  await getDb()
    .update(dailyAdViews)
    .set({
      clickCount: sql`${dailyAdViews.clickCount} + 1`,
      clickedAt: now,
      lastPositionMs: input.positionMs,
      updatedAt: now,
    })
    .where(eq(dailyAdViews.id, row.viewId))

  await getDb()
    .update(dailySessions)
    .set({
      status: "paused",
      currentAdIndex: input.position,
      currentPositionMs: input.positionMs,
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(eq(dailySessions.id, input.sessionId))

  return {
    ok: true,
    destinationUrl: row.destinationUrl,
  }
}

async function advertiserBalanceCents(advertiserAccountId: string) {
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

function shuffled<T>(items: T[]) {
  const copy = [...items]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1)
    const current = copy[index]
    copy[index] = copy[swapIndex]
    copy[swapIndex] = current
  }

  return copy
}

export async function drawDailyPool(input: {
  poolDate?: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const period = input.poolDate
    ? getDailyPeriodForPoolDate(input.poolDate)
    : getDailyPeriod(new Date(now.getTime() - oneDayMs))
  const db = getDb()
  const existing = await db
    .select()
    .from(dailyPools)
    .where(eq(dailyPools.poolDate, period.poolDate))
    .limit(1)

  if (existing[0]?.status === "drawn") {
    return {
      ok: true,
      pool: existing[0],
      winnersCreated: 0,
      alreadyDrawn: true,
    }
  }

  const [pool] =
    existing.length > 0
      ? await db
          .update(dailyPools)
          .set({ status: "drawing", updatedAt: now })
          .where(eq(dailyPools.id, existing[0].id))
          .returning()
      : await db
          .insert(dailyPools)
          .values({
            id: `daily-pool-${randomUUID()}`,
            poolDate: period.poolDate,
            status: "drawing",
            periodStartsAt: period.periodStartsAt,
            periodEndsAt: period.periodEndsAt,
            drawAt: period.drawAt,
          })
          .returning()

  const campaigns = await db
    .select()
    .from(dailyCampaigns)
    .where(
      and(
        eq(dailyCampaigns.status, "active"),
        lt(dailyCampaigns.startsAt, period.periodEndsAt),
        gt(dailyCampaigns.endsAt, period.periodStartsAt),
      ),
    )

  let fundsCents = 0
  const balances = new Map<string, number>()

  for (const campaign of campaigns) {
    const existingBalance =
      balances.get(campaign.advertiserAccountId) ??
      (await advertiserBalanceCents(campaign.advertiserAccountId))
    const captureCents = Math.min(campaign.dailyBudgetCents, existingBalance)

    if (captureCents <= 0) {
      balances.set(campaign.advertiserAccountId, existingBalance)
      continue
    }

    await db.insert(advertiserWalletTransactions).values({
      id: `advertiser-wallet-${randomUUID()}`,
      advertiserAccountId: campaign.advertiserAccountId,
      type: "capture",
      status: "posted",
      amountCents: -captureCents,
      currency: "usd",
      description: `The Daily pool funding for ${period.poolDate}`,
      postedAt: now,
    })

    balances.set(campaign.advertiserAccountId, existingBalance - captureCents)
    fundsCents += captureCents
  }

  const payoutPoolCents = Math.floor((fundsCents * dailyPoolSharePercent) / 100)
  const entries = await db
    .select()
    .from(dailyPoolEntries)
    .where(
      and(
        eq(dailyPoolEntries.poolDate, period.poolDate),
        eq(dailyPoolEntries.status, "eligible"),
      ),
    )
    .orderBy(asc(dailyPoolEntries.createdAt))

  const selectedEntries = shuffled(entries).slice(
    0,
    Math.min(dailyWinnerCount, entries.length),
  )
  const winnerAmountCents =
    selectedEntries.length > 0
      ? Math.floor(payoutPoolCents / selectedEntries.length)
      : 0
  let winnersCreated = 0

  for (const entry of selectedEntries) {
    if (winnerAmountCents <= 0) {
      break
    }

    const winnerId = `daily-winner-${randomUUID()}`
    const ledgerId = `earnings-ledger-${randomUUID()}`

    await db
      .insert(earningsLedger)
      .values({
        id: ledgerId,
        userId: entry.userId,
        source: "ad_share",
        sourceId: winnerId,
        status: "approved",
        amountCents: winnerAmountCents,
        availableAt: now,
      })
      .onConflictDoNothing()

    const [winner] = await db
      .insert(dailyWinners)
      .values({
        id: winnerId,
        poolId: pool.id,
        poolDate: period.poolDate,
        userId: entry.userId,
        entryId: entry.id,
        amountCents: winnerAmountCents,
        status: "approved",
        earningsLedgerId: ledgerId,
      })
      .onConflictDoNothing()
      .returning({ id: dailyWinners.id })

    if (winner) {
      winnersCreated += 1
    }
  }

  const [updatedPool] = await db
    .update(dailyPools)
    .set({
      status: "drawn",
      fundsCents,
      payoutPoolCents,
      winnerCount: selectedEntries.length,
      drawnAt: now,
      updatedAt: now,
    })
    .where(eq(dailyPools.id, pool.id))
    .returning()

  return {
    ok: true,
    pool: updatedPool,
    winnersCreated,
    alreadyDrawn: false,
  }
}

export async function listDailyCampaignsForAdvertiser(advertiserAccountId: string) {
  return getDb()
    .select()
    .from(dailyCampaigns)
    .where(eq(dailyCampaigns.advertiserAccountId, advertiserAccountId))
    .orderBy(desc(dailyCampaigns.createdAt))
}

export async function createDailyCampaign(input: {
  advertiserAccountId: string
  name: string
  brandName: string
  status: typeof dailyCampaigns.$inferInsert.status
  videoUrl: string
  thumbnailUrl: string | null
  destinationUrl: string
  ctaText: string
  targetingSummary: string | null
  dailyBudgetCents: number
  totalBudgetCents: number | null
  maxDailyImpressions: number | null
  startsAt: Date
  endsAt: Date
}) {
  const [campaign] = await getDb()
    .insert(dailyCampaigns)
    .values({
      id: `daily-campaign-${randomUUID()}`,
      ...input,
      updatedAt: new Date(),
    })
    .returning()

  return campaign
}
