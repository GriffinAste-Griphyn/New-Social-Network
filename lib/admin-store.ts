import { redirect } from "next/navigation"
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm"

import { isAdminSession } from "@/lib/admin-auth"
import { requireSession } from "@/lib/auth"
import {
  reverseUnpaidStoryEarnings,
  settleCreatorPayouts,
} from "@/lib/creator-earnings"
import { getDb } from "@/lib/db"
import { applyMediaModerationResult } from "@/lib/media-assets"
import {
  advertiserAccounts,
  advertiserWalletTransactions,
  brandFundingProfiles,
  creatorProfiles,
  earningsLedger,
  mediaAssets,
  stories,
  storyElements,
  users,
} from "@/lib/db/schema"
import { publicStoryMediaUrl } from "@/lib/story-storage"
import { enqueueStoryPublication } from "@/lib/story-publication"
import {
  countPendingSafetyReports,
  listPendingSafetyReports,
  type PendingSafetyReport,
} from "@/lib/social-safety"
import {
  listLatestModerationChecksForTargets,
  recordModerationCheck,
  type ModerationCheckRecord,
} from "@/lib/safety/moderation-checks"
import { moderateUserContent } from "@/lib/safety/moderate-content"
import { resultFromSignals } from "@/lib/safety/policy"
import {
  deriveStoryPublicationStatus,
} from "@/lib/stories/cloudflare-status"
import { isCloudflareStreamFullyReady as isProviderReady } from "@/lib/media-upload-sessions"

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
  moderationCheck: ModerationCheckRecord | null
  elements: AdminModerationStoryElement[]
}

export type AdminModerationStoryElement = {
  id: string
  kind: "text" | "sticker" | "link" | "quote_reply"
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
  const elementsByStoryId = new Map<string, AdminModerationStoryElement[]>()

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
    moderationCheck: latestChecks.get(story.id) ?? null,
    elements: elementsByStoryId.get(story.id) ?? [],
  }))
}

export async function approveModeratedStory(input: {
  storyId: string
  reviewerId: string
}) {
  const db = getDb()
  const [row] = await db
    .select({
      id: stories.id,
      status: stories.status,
      processingStatus: stories.processingStatus,
      moderationStatus: stories.moderationStatus,
      storageProvider: stories.storageProvider,
      expiresAt: stories.expiresAt,
      mediaAssetId: stories.mediaAssetId,
      scanStatus: mediaAssets.scanStatus,
      assetProcessingStatus: mediaAssets.processingStatus,
      providerStatus: mediaAssets.providerStatus,
      providerPctComplete: mediaAssets.providerPctComplete,
    })
    .from(stories)
    .innerJoin(mediaAssets, eq(stories.mediaAssetId, mediaAssets.id))
    .where(eq(stories.id, input.storyId))
    .limit(1)

  if (!row) {
    return
  }

  const now = new Date()
  let nextStatus: "live" | "processing" | "expired" | "removed"

  if (row.expiresAt.getTime() <= now.getTime()) {
    nextStatus = "expired"
  } else {
    const isCf = row.storageProvider === "cloudflare-stream"
    let providerReady: boolean

    if (isCf) {
      const pct = row.providerPctComplete
      const providerState = row.providerStatus
      providerReady = isProviderReady({
        readyToStream:
          row.assetProcessingStatus === "ready" || providerState === "ready",
        state: providerState ?? null,
        pctComplete: pct ?? null,
      })

      nextStatus = deriveStoryPublicationStatus({
        currentStatus: row.status as "processing" | "live" | "expired" | "removed",
        moderationStatus: "approved",
        providerReady,
        expiresAt: row.expiresAt,
        now,
        scanStatus: row.scanStatus,
      })
    } else {
      providerReady = row.processingStatus === "ready"
      nextStatus = deriveStoryPublicationStatus({
        currentStatus: row.status as "processing" | "live" | "expired" | "removed",
        moderationStatus: "approved",
        providerReady,
        expiresAt: row.expiresAt,
        now,
        scanStatus: row.scanStatus,
      })
    }
  }

  const updatedStories = await db
    .update(stories)
    .set({
      status: nextStatus,
      moderationStatus: "approved",
      moderationReason: null,
      reviewedAt: new Date(),
      reviewedByUserId: input.reviewerId,
    })
    .where(
      and(
        eq(stories.id, input.storyId),
        eq(stories.status, row.status),
        eq(stories.processingStatus, row.processingStatus),
        eq(stories.moderationStatus, row.moderationStatus),
      ),
    )
    .returning({ id: stories.id })

  if (updatedStories.length > 0 && nextStatus === "live" && row.status !== "live") {
    await enqueueStoryPublication(input.storyId).catch((error) => {
      console.error("story_publication_enqueue_failed", {
        storyId: input.storyId,
        error,
      })
    })
  }
}

export async function rescanModeratedStory(input: {
  storyId: string
  reviewerId: string
}) {
  const db = getDb()
  const [row] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      assetKind: stories.assetKind,
      mediaUrl: stories.mediaUrl,
      thumbnailUrl: stories.thumbnailUrl,
      contentType: stories.contentType,
      byteSize: stories.byteSize,
      durationMs: stories.durationMs,
      caption: stories.caption,
      status: stories.status,
      processingStatus: stories.processingStatus,
      moderationStatus: stories.moderationStatus,
      storageProvider: stories.storageProvider,
      expiresAt: stories.expiresAt,
      mediaAssetId: stories.mediaAssetId,
      assetProcessingStatus: mediaAssets.processingStatus,
      providerStatus: mediaAssets.providerStatus,
      providerPctComplete: mediaAssets.providerPctComplete,
    })
    .from(stories)
    .innerJoin(mediaAssets, eq(stories.mediaAssetId, mediaAssets.id))
    .where(
      and(
        eq(stories.id, input.storyId),
        eq(stories.moderationStatus, "flagged"),
      ),
    )
    .limit(1)

  if (!row) {
    return { status: "missing" as const }
  }

  const elements = await db
    .select({
      kind: storyElements.kind,
      label: storyElements.label,
      href: storyElements.href,
    })
    .from(storyElements)
    .where(eq(storyElements.storyId, row.id))
    .orderBy(asc(storyElements.createdAt))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ubeye.ai"
  const signingRequest = new Request(new URL("/admin", appUrl))
  const moderationResult = await moderateUserContent({
    textParts: [row.caption, ...elements.map((element) => element.label)],
    linkUrls: elements
      .filter((element) => element.kind === "link")
      .map((element) => element.href),
    media: {
      assetKind: row.assetKind,
      contentType:
        row.contentType ?? (row.assetKind === "image" ? "image/jpeg" : "video/mp4"),
      byteSize: row.byteSize ?? 0,
      durationMs: row.durationMs,
      mediaUrl:
        publicStoryMediaUrl(row.mediaUrl, signingRequest, { signed: true }) ??
        row.mediaUrl,
      thumbnailUrl: publicStoryMediaUrl(row.thumbnailUrl, signingRequest, {
        signed: true,
      }),
    },
  })
  const moderation =
    moderationResult.action === "approve" && moderationResult.error
      ? resultFromSignals({
          provider: moderationResult.provider,
          signals: [
            {
              key: "scanner_unavailable",
              confidence: 1,
              reason: "Moderation scanner was unavailable; content requires review.",
              source: "system",
            },
          ],
          rawResult: moderationResult.rawResult,
          error: moderationResult.error,
        })
      : moderationResult
  const now = new Date()
  const scanStatus =
    moderation.action === "approve"
      ? "passed"
      : moderation.action === "reject"
        ? "failed"
        : "flagged"
  const moderationStatus =
    moderation.action === "approve"
      ? "approved"
      : moderation.action === "reject"
        ? "rejected"
        : "flagged"
  let nextStatus: "live" | "processing" | "expired" | "removed"

  if (moderation.action === "reject") {
    nextStatus = "removed"
  } else if (moderation.action === "hold") {
    nextStatus = row.expiresAt.getTime() <= now.getTime() ? "expired" : "processing"
  } else if (row.expiresAt.getTime() <= now.getTime()) {
    nextStatus = "expired"
  } else {
    const providerReady =
      row.storageProvider === "cloudflare-stream"
        ? isProviderReady({
            readyToStream:
              row.assetProcessingStatus === "ready" || row.providerStatus === "ready",
            state: row.providerStatus ?? null,
            pctComplete: row.providerPctComplete ?? null,
          })
        : row.assetProcessingStatus === "ready"

    nextStatus = deriveStoryPublicationStatus({
      currentStatus: row.status as "processing" | "live" | "expired" | "removed",
      moderationStatus,
      providerReady,
      expiresAt: row.expiresAt,
      now,
      scanStatus,
    })
  }

  await applyMediaModerationResult({
    mediaAssetId: row.mediaAssetId,
    actorUserId: input.reviewerId,
    result: moderation,
  })

  const updatedStories = await db
    .update(stories)
    .set({
      status: nextStatus,
      moderationStatus,
      moderationReason: moderation.reason,
      reviewedAt: moderation.action === "hold" ? null : now,
      reviewedByUserId: moderation.action === "hold" ? null : input.reviewerId,
    })
    .where(
      and(
        eq(stories.id, row.id),
        eq(stories.status, row.status),
        eq(stories.moderationStatus, row.moderationStatus),
      ),
    )
    .returning({ id: stories.id })

  if (updatedStories.length === 0) {
    return { status: "stale" as const }
  }

  await recordModerationCheck({
    targetKind: "story",
    targetId: row.id,
    actorUserId: input.reviewerId,
    mediaAssetId: row.mediaAssetId,
    result: moderation,
  }).catch(() => undefined)

  if (moderation.action === "reject") {
    await reverseUnpaidStoryEarnings(row.id)
  }

  if (nextStatus === "live" && row.status !== "live") {
    await enqueueStoryPublication(row.id).catch((error) => {
      console.error("story_publication_enqueue_failed", {
        storyId: row.id,
        error,
      })
    })
  }

  return { status: moderation.action as "approve" | "hold" | "reject" }
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
