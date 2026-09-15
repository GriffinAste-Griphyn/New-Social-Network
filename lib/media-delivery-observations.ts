import { sql } from "drizzle-orm"
import { getDb } from "@/lib/db"

export type MediaDeliveryObservation = {
  storyId: string; build: string; network: string; viewerBuild: string
  tapToAcceptedMs: number | null; acceptedToReadyMs: number | null
  viewerOpenToFrameMs: number | null; receiptToViewerMs: number
  feedObserved: boolean
}

/** Same-clock receipt interval; includes telemetry batching and viewer wait time.
 * Never interpret this interval as an upload/processing latency SLO. Client-local
 * durations are reported separately, avoiding subtraction of two device clocks. */
export function validDeliveryPair(input: { owner: string; viewer: string; ownerInstallation: string | null;
  viewerInstallation: string | null; acceptedAt: number; observedAt: number }) {
  return input.owner !== input.viewer && Boolean(input.ownerInstallation && input.viewerInstallation) &&
    input.ownerInstallation !== input.viewerInstallation && Number.isFinite(input.acceptedAt) &&
    Number.isFinite(input.observedAt) && input.observedAt >= input.acceptedAt &&
    input.observedAt - input.acceptedAt <= 24 * 3600_000
}

export async function collectMediaDeliveryObservations(now = new Date()): Promise<MediaDeliveryObservation[]> {
  const result = await getDb().execute(sql`
    WITH accepted AS (
      SELECT DISTINCT ON (s.id) s.id, s.creator_id, e.created_at,
        e.metadata->>'installation' AS installation, e.duration_ms,
        e.metadata->>'build' AS build, e.metadata->>'network_class' AS network
      FROM mobile_performance_events e JOIN stories s ON s.id = e.metadata->>'story'
      WHERE e.metadata ? 'story' AND e.name = 'media_delivery_accepted' AND e.user_id = s.creator_id
        AND e.created_at >= ${new Date(now.getTime() - 24 * 3600_000)}
        AND NULLIF(e.metadata->>'installation', '') IS NOT NULL
        AND e.created_at <= ${now} AND s.status = 'live' AND s.moderation_status = 'approved'
      ORDER BY s.id, e.created_at
    )
    SELECT a.id AS "storyId", a.build, a.network, frame.metadata->>'build' AS "viewerBuild",
      a.duration_ms AS "tapToAcceptedMs", ready.duration_ms AS "acceptedToReadyMs",
      frame.duration_ms AS "viewerOpenToFrameMs",
      EXTRACT(EPOCH FROM (frame.created_at - a.created_at)) * 1000 AS "receiptToViewerMs",
      EXISTS (SELECT 1 FROM mobile_performance_events seen WHERE seen.metadata ? 'story' AND seen.name = 'media_delivery_observed'
        AND seen.metadata->>'phase' = 'feed_visible' AND seen.metadata->>'story' = a.id
        AND seen.user_id = frame.user_id AND seen.metadata->>'installation' = frame.metadata->>'installation'
        AND seen.created_at BETWEEN a.created_at AND frame.created_at) AS "feedObserved"
    FROM accepted a
    JOIN LATERAL (
      SELECT e.* FROM mobile_performance_events e
      WHERE e.metadata ? 'story' AND e.name = 'media_delivery_observed' AND e.metadata->>'phase' = 'first_frame'
        AND e.metadata->>'story' = a.id AND e.user_id <> a.creator_id
        AND NULLIF(e.metadata->>'installation', '') IS NOT NULL
        AND e.metadata->>'installation' <> a.installation
        AND e.created_at BETWEEN a.created_at AND ${now}
      ORDER BY e.created_at LIMIT 1
    ) frame ON true
    LEFT JOIN LATERAL (
      SELECT e.duration_ms FROM mobile_performance_events e
      WHERE e.metadata ? 'story' AND e.name = 'media_delivery_ready' AND e.metadata->>'story' = a.id
        AND e.user_id = a.creator_id AND e.metadata->>'installation' = a.installation AND e.created_at >= a.created_at AND e.created_at <= ${now}
      ORDER BY e.created_at LIMIT 1
    ) ready ON true
    ORDER BY frame.created_at DESC LIMIT 100
  `)
  return (result.rows as MediaDeliveryObservation[]).map(row => ({
    ...row,
    build: row.build ?? "unknown", viewerBuild: row.viewerBuild ?? "unknown", network: row.network ?? "unknown",
    // PostgreSQL numeric expressions arrive as strings through the Neon driver.
    receiptToViewerMs: Number(row.receiptToViewerMs),
  }))
}
