import { gt, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  creatorScores,
  feedEvents,
  mobileFeedSnapshots,
  mobilePerformanceEvents,
} from "@/lib/db/schema"

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function numeric(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function aggregateCreatorFeedScores() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000)
  const rows = await getDb()
    .select({
      creatorId: feedEvents.creatorId,
      impressions: sql<number>`count(*) filter (where ${feedEvents.kind} = 'impression')`,
      completions: sql<number>`count(*) filter (where ${feedEvents.kind} = 'completion')`,
      skips: sql<number>`count(*) filter (where ${feedEvents.kind} = 'skip')`,
      hides: sql<number>`count(*) filter (where ${feedEvents.kind} = 'hide')`,
      rewatches: sql<number>`count(*) filter (where ${feedEvents.kind} = 'rewatch')`,
      latestEventAt: sql<Date>`max(${feedEvents.createdAt})`,
    })
    .from(feedEvents)
    .where(gt(feedEvents.createdAt, since))
    .groupBy(feedEvents.creatorId)

  const now = new Date()
  for (const row of rows) {
    const impressions = Math.max(1, numeric(row.impressions))
    const positive = numeric(row.completions) + numeric(row.rewatches) * 0.5
    const negative = numeric(row.skips) * 0.7 + numeric(row.hides) * 2
    const qualityScore = clamp(0.5 + (positive - negative) / impressions / 2, 0.05, 0.95)
    const ageHours = Math.max(
      0,
      (now.getTime() - new Date(row.latestEventAt).getTime()) / 3_600_000,
    )
    const freshnessScore = clamp(Math.exp(-ageHours / 36), 0.05, 0.95)

    await getDb()
      .insert(creatorScores)
      .values({
        creatorId: row.creatorId,
        freshnessScore: freshnessScore.toFixed(3),
        affinityScore: "0.350",
        qualityScore: qualityScore.toFixed(3),
        monetizationScore: "0.250",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: creatorScores.creatorId,
        set: {
          freshnessScore: freshnessScore.toFixed(3),
          qualityScore: qualityScore.toFixed(3),
          updatedAt: now,
        },
      })
  }

  if (rows.length > 0) {
    await getDb().delete(mobileFeedSnapshots)
  }
  return { creatorsUpdated: rows.length, windowDays: 7 }
}

export async function rollupRecentMediaQoe() {
  const since = new Date(Date.now() - 15 * 60 * 1_000)
  const [summary] = await getDb()
    .select({
      firstFrames: sql<number>`count(*) filter (where ${mobilePerformanceEvents.name} = 'video_first_frame')`,
      stalls: sql<number>`count(*) filter (where ${mobilePerformanceEvents.name} = 'video_stalled')`,
      terminalFailures: sql<number>`count(*) filter (where ${mobilePerformanceEvents.name} = 'video_terminal_failure')`,
      uploadsSucceeded: sql<number>`count(*) filter (where ${mobilePerformanceEvents.name} = 'video_upload_succeeded')`,
      uploadsFailed: sql<number>`count(*) filter (where ${mobilePerformanceEvents.name} = 'video_upload_failed')`,
      firstFrameP95Ms: sql<number | null>`percentile_cont(0.95) within group (order by ${mobilePerformanceEvents.durationMs}) filter (where ${mobilePerformanceEvents.name} = 'video_first_frame' and ${mobilePerformanceEvents.durationMs} is not null)`,
    })
    .from(mobilePerformanceEvents)
    .where(gt(mobilePerformanceEvents.createdAt, since))

  const rollup = {
    windowMinutes: 15,
    firstFrames: numeric(summary?.firstFrames),
    stalls: numeric(summary?.stalls),
    terminalFailures: numeric(summary?.terminalFailures),
    uploadsSucceeded: numeric(summary?.uploadsSucceeded),
    uploadsFailed: numeric(summary?.uploadsFailed),
    firstFrameP95Ms:
      summary?.firstFrameP95Ms == null
        ? null
        : Math.round(numeric(summary.firstFrameP95Ms)),
  }
  console.info(JSON.stringify({
    level:
      rollup.terminalFailures > 0 || rollup.uploadsFailed > rollup.uploadsSucceeded
        ? "warn"
        : "info",
    message: "media_qoe_rollup",
    service: "media_operations",
    at: new Date().toISOString(),
    ...rollup,
  }))
  return rollup
}
