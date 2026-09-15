import { collectMediaDeliveryObservations } from "@/lib/media-delivery-observations"
import { desc, eq, gte, lt, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { mediaOperationsSnapshots, mobilePerformanceEvents } from "@/lib/db/schema"
import { evaluateMediaSlos, type MediaPipelineHealth, type MediaQoeSegment } from "@/lib/media-slo"

const windowMs = 15 * 60_000
const cadenceMs = 5 * 60_000

export function isMediaMonitoringStale(collectedAt: Date, now = new Date()) {
  return now.getTime() - collectedAt.getTime() > 15 * 60_000
}

export async function collectMediaOperations(now = new Date()) {
  const db = getDb()
  const windowEnd = new Date(Math.floor(now.getTime() / cadenceMs) * cadenceMs)
  const windowStart = new Date(windowEnd.getTime() - windowMs)
  const [events, health, previous, latest, phases, uploadCohorts, frameCadence] = await Promise.all([
    db.execute(sql`
      WITH events AS (
        SELECT name, duration_ms, metadata, created_at,
          COALESCE(metadata->>'build', 'unknown') AS build,
          COALESCE(metadata->>'network_class', 'unknown') AS network,
          COALESCE(metadata->>'device_class', 'unknown') AS device,
          user_id || ':' || COALESCE(metadata->>'playback', id::text) AS session,
          user_id || ':' || COALESCE(metadata->>'attempt', id::text) AS upload
        FROM mobile_performance_events
        WHERE created_at >= ${windowStart} AND created_at < ${windowEnd}
          -- The composer also echoes the detailed upload failure as a report.
          -- Count the canonical attempt event once, not that UI echo.
          AND NOT (name = 'video_upload_failed' AND metadata ? 'report')
          AND name IN ('video_startup', 'video_first_frame', 'video_stalled',
            'video_terminal_failure', 'video_access_log', 'video_upload_succeeded',
            'video_upload_failed', 'image_upload_succeeded', 'image_upload_failed', 'video_quality_ramp')
      ), enriched AS (
        SELECT *,
          COALESCE(MAX(metadata->>'delivery') OVER (PARTITION BY session), 'unknown') AS delivery,
          COALESCE(MAX(metadata->>'startup_profile') OVER (PARTITION BY session), 'unknown') AS profile,
          COALESCE(MAX(metadata->>'device_model') OVER (PARTITION BY session), 'unknown') AS model,
          COALESCE(MAX(metadata->>'startup_state') OVER (PARTITION BY session), 'unknown') AS startup,
          bool_or(name IN ('video_upload_succeeded', 'image_upload_succeeded')) OVER (PARTITION BY upload) AS upload_succeeded
        FROM events
      )
      SELECT build, network, device, delivery, profile, model AS "deviceModel", startup AS "startupState",
        count(DISTINCT session) FILTER (WHERE name IN ('video_startup', 'video_first_frame', 'video_stalled', 'video_terminal_failure'))::int AS sessions,
        count(DISTINCT session) FILTER (WHERE name = 'video_stalled')::int AS "stalledSessions",
        count(DISTINCT session) FILTER (WHERE name = 'video_terminal_failure')::int AS "failedSessions",
        count(*) FILTER (WHERE name = 'video_first_frame' AND duration_ms IS NOT NULL)::int AS "firstFrames",
        percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE name = 'video_first_frame') AS "firstFrameP50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE name = 'video_first_frame') AS "firstFrameP95Ms",
        count(DISTINCT upload) FILTER (WHERE name IN ('video_upload_succeeded', 'image_upload_succeeded'))::int AS "uploadsSucceeded",
        count(DISTINCT upload) FILTER (WHERE name IN ('video_upload_failed', 'image_upload_failed') AND NOT upload_succeeded)::int AS "uploadsFailed",
        COALESCE(sum(CASE WHEN name = 'video_access_log' AND metadata->>'bytes' ~ '^[0-9]{1,15}$' THEN (metadata->>'bytes')::bigint ELSE 0 END), 0)::float8 AS "downloadedBytes",
        COALESCE(sum(CASE WHEN name = 'video_access_log' AND metadata->>'watchedMs' ~ '^[0-9]{1,12}$' THEN (metadata->>'watchedMs')::bigint ELSE 0 END), 0)::float8 AS "watchedMs",
        count(DISTINCT session) FILTER (WHERE name = 'video_quality_ramp' AND metadata->>'target' = '720p' AND metadata->>'result' = 'reached')::int AS "hd720Reached",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE name = 'video_quality_ramp' AND metadata->>'target' = '720p' AND metadata->>'result' = 'reached') AS "hd720P95Ms",
        count(DISTINCT session) FILTER (WHERE name = 'video_quality_ramp' AND metadata->>'target' = '1080p')::int AS "hdSamples",
        count(DISTINCT session) FILTER (WHERE name = 'video_quality_ramp' AND metadata->>'target' = '1080p' AND metadata->>'result' = 'reached')::int AS "hdReached",
        percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE name = 'video_quality_ramp' AND metadata->>'target' = '1080p' AND metadata->>'result' = 'reached') AS "hdP50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE name = 'video_quality_ramp' AND metadata->>'target' = '1080p' AND metadata->>'result' = 'reached') AS "hdP95Ms"
      FROM enriched GROUP BY build, network, device, delivery, profile, model, startup
    `),
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM media_background_jobs WHERE status = 'error') AS "failedBackgroundJobs",
        (SELECT count(*)::int FROM media_background_jobs WHERE status IN ('pending', 'processing') AND created_at < ${new Date(now.getTime() - 10 * 60_000)}) AS "staleBackgroundJobs",
        count(*) FILTER (WHERE s.processing_status = 'processing')::int AS processing,
        count(*) FILTER (WHERE s.processing_status = 'processing' AND s.created_at < ${new Date(now.getTime() - 10 * 60_000)})::int AS "staleProcessing",
        max(EXTRACT(EPOCH FROM (${now}::timestamptz - s.created_at)) * 1000) FILTER (WHERE s.processing_status = 'processing')::float8 AS "oldestProcessingMs",
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM media_processing_jobs j WHERE j.media_asset_id = s.media_asset_id AND j.attempts >= 8 AND j.status <> 'ready'))::int AS "exhaustedVideoJobs",
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM image_processing_jobs j WHERE j.media_asset_id = s.media_asset_id AND j.attempts >= 6 AND j.status <> 'ready'))::int AS "exhaustedImageJobs",
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM story_publish_jobs j WHERE j.story_id = s.id AND j.status = 'failed'))::int AS "failedPublications",
        count(*) FILTER (WHERE s.moderation_status = 'pending')::int AS "pendingModeration",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (p.completed_at - s.created_at)) * 1000)
          FILTER (WHERE p.completed_at >= ${windowStart} AND p.completed_at < ${windowEnd}) AS "publishP95Ms"
      FROM stories s JOIN media_assets a ON a.id = s.media_asset_id
      LEFT JOIN story_publish_jobs p ON p.story_id = s.id
      WHERE s.expires_at > ${now} AND s.status <> 'removed'
    `),
    db.select().from(mediaOperationsSnapshots)
      .where(eq(mediaOperationsSnapshots.windowEnd, windowStart)).limit(1),
    db.select().from(mediaOperationsSnapshots)
      .where(lt(mediaOperationsSnapshots.windowEnd, windowEnd))
      .orderBy(desc(mediaOperationsSnapshots.windowEnd)).limit(1),
    db.execute(sql`
      WITH phases AS (
        SELECT CASE WHEN name = 'video_upload_phase' THEN 'video' ELSE 'image' END AS kind,
          COALESCE(metadata->>'phase', 'unknown') AS phase,
          COALESCE(metadata->>'build', 'unknown') AS build,
          COALESCE(metadata->>'network_class', 'unknown') AS network,
          COALESCE(metadata->>'device_model', 'unknown') AS model,
          CASE WHEN metadata->>'bytes' ~ '^[0-9]{1,12}$' THEN (metadata->>'bytes')::bigint ELSE NULL END AS bytes,
          duration_ms
        FROM mobile_performance_events
        WHERE created_at >= ${windowStart} AND created_at < ${windowEnd}
          AND name IN ('video_upload_phase', 'image_upload_phase') AND duration_ms IS NOT NULL
      ), sized AS (
        SELECT *, CASE WHEN bytes IS NULL OR bytes = 0 THEN 'unknown'
          WHEN bytes < 16777216 THEN '<16MiB' WHEN bytes < 67108864 THEN '16-64MiB' ELSE '>=64MiB' END AS size
        FROM phases
      )
      SELECT kind, phase, build, network, model, size, count(*)::int AS samples,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS "p50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS "p95Ms"
      FROM sized GROUP BY kind, phase, build, network, model, size
    `),
    db.execute(sql`
      WITH uploads AS (
        SELECT name, duration_ms,
          COALESCE(metadata->>'build', 'unknown') AS build,
          COALESCE(metadata->>'network_class', 'unknown') AS network,
          COALESCE(metadata->>'device_model', 'unknown') AS model,
          COALESCE(metadata->>'upload_experiment', 'baseline') AS experiment,
          user_id || ':' || COALESCE(metadata->>'attempt', id::text) AS attempt,
          CASE WHEN metadata->>'bytes' ~ '^[0-9]{1,12}$' THEN (metadata->>'bytes')::bigint ELSE NULL END AS bytes,
          CASE WHEN metadata->>'retries' = '0' AND metadata->>'effective_mbps' ~ '^[0-9]{1,5}(\\.[0-9]{1,3})?$'
            THEN (metadata->>'effective_mbps')::float8 ELSE NULL END AS mbps
        FROM mobile_performance_events
        WHERE created_at >= ${windowStart} AND created_at < ${windowEnd}
          AND name IN ('video_upload_succeeded', 'video_upload_failed')
          AND NOT (name = 'video_upload_failed' AND metadata ? 'report')
      ), outcomes AS (
        SELECT *, bool_or(name = 'video_upload_succeeded') OVER (PARTITION BY attempt) AS completed,
          CASE WHEN bytes IS NULL OR bytes = 0 THEN 'unknown'
               WHEN bytes < 16777216 THEN '<16MiB' WHEN bytes < 67108864 THEN '16-64MiB' ELSE '>=64MiB' END AS size
        FROM uploads
      )
      SELECT build, network, model, experiment, size,
        count(DISTINCT attempt) FILTER (WHERE name = 'video_upload_succeeded')::int AS succeeded,
        count(DISTINCT attempt) FILTER (WHERE name = 'video_upload_failed' AND NOT completed)::int AS failed,
        count(*) FILTER (WHERE name = 'video_upload_succeeded' AND duration_ms IS NOT NULL)::int AS samples,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE name = 'video_upload_succeeded') AS "p50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE name = 'video_upload_succeeded') AS "p95Ms",
        percentile_cont(0.50) WITHIN GROUP (ORDER BY mbps) FILTER (WHERE name = 'video_upload_succeeded') AS "mbpsP50"
      FROM outcomes GROUP BY build, network, model, experiment, size
    `),
    db.execute(sql`
      WITH cadence AS (
        SELECT metadata,
          CASE WHEN metadata->>'frames' ~ '^[0-9]{1,7}$' THEN (metadata->>'frames')::bigint END AS frames,
          CASE WHEN metadata->>'hitches' ~ '^[0-9]{1,7}$' THEN (metadata->>'hitches')::bigint END AS hitches,
          CASE WHEN metadata->>'hitch_ms' ~ '^[0-9]{1,7}$' THEN (metadata->>'hitch_ms')::bigint END AS hitch_ms,
          CASE WHEN metadata->>'elapsed_ms' ~ '^[0-9]{1,7}$' THEN (metadata->>'elapsed_ms')::bigint END AS elapsed_ms,
          CASE WHEN metadata->>'max_gap_ms' ~ '^[0-9]{1,8}$' THEN (metadata->>'max_gap_ms')::bigint END AS max_gap_ms
        FROM mobile_performance_events
        WHERE name = 'frame_pacing' AND created_at >= ${windowStart} AND created_at < ${windowEnd}
      )
      SELECT COALESCE(metadata->>'build', 'unknown') AS build,
        COALESCE(metadata->>'network_class', 'unknown') AS network,
        COALESCE(metadata->>'device_model', 'unknown') AS model,
        COALESCE(metadata->>'surface', 'unknown') AS surface,
        COALESCE(metadata->>'mode', 'unknown') AS mode,
        count(*)::int AS samples, sum(frames)::float8 AS frames, sum(hitches)::float8 AS hitches,
        sum(hitch_ms)::float8 AS "hitchMs", sum(elapsed_ms)::float8 AS "elapsedMs", max(max_gap_ms)::float8 AS "maxGapMs"
      FROM cadence WHERE frames >= 30 AND hitches BETWEEN 0 AND frames
        AND elapsed_ms > 0 AND hitch_ms BETWEEN 0 AND elapsed_ms AND max_gap_ms BETWEEN 0 AND 10000000
      GROUP BY metadata->>'build', metadata->>'network_class', metadata->>'device_model', metadata->>'surface', metadata->>'mode'
    `),
  ])
  const segments = events.rows as MediaQoeSegment[]
  const pipeline = { deliveryObservations: await collectMediaDeliveryObservations(now), ...health.rows[0], uploadPhases: phases.rows, uploadCohorts: uploadCohorts.rows, frameCadence: frameCadence.rows } as MediaPipelineHealth
  const alerts = evaluateMediaSlos(segments, pipeline, previous[0]?.segments ?? [])
  const snapshot = { windowStart, windowEnd, segments, pipeline, alerts, collectedAt: now }
  await db.insert(mediaOperationsSnapshots).values(snapshot).onConflictDoUpdate({
    target: mediaOperationsSnapshots.windowEnd, set: snapshot,
  })
  console.info(JSON.stringify({ level: alerts.length ? "warn" : "info", message: "media_qoe_rollup", service: "media_operations", ...snapshot }))
  const recent = latest[0] && windowEnd.getTime() - latest[0].windowEnd.getTime() <= 2 * cadenceMs
  const active = new Set(recent ? latest[0].alerts.map(alert => alert.key) : [])
  for (const alert of alerts.filter(alert => !active.has(alert.key))) {
    console.warn(JSON.stringify({ message: "media_slo_breach", service: "media_operations", key: alert.key, severity: alert.severity, alertMessage: alert.message, windowEnd }))
  }
  for (const alert of (recent ? latest[0].alerts : []).filter(alert => !alerts.some(current => current.key === alert.key))) {
    console.info(JSON.stringify({ message: "media_slo_recovered", service: "media_operations", key: alert.key, windowEnd }))
  }
  // Retain bounded operational history; raw events keep their existing lifecycle.
  await db.delete(mediaOperationsSnapshots).where(lt(mediaOperationsSnapshots.windowEnd, new Date(now.getTime() - 30 * 24 * 60 * 60_000)))
  return snapshot
}

export async function getLatestMediaOperations() {
  const [snapshot] = await getDb().select().from(mediaOperationsSnapshots)
    .orderBy(desc(mediaOperationsSnapshots.windowEnd)).limit(1)
  return snapshot ?? null
}

export async function getMediaEventVolume(now = new Date()) {
  const [row] = await getDb().select({ count: sql<number>`count(*)::int` })
    .from(mobilePerformanceEvents).where(gte(mobilePerformanceEvents.createdAt, new Date(now.getTime() - 24 * 60 * 60_000)))
  return row?.count ?? 0
}
