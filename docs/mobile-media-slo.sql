-- Mobile media SLO dashboard, grouped by day/build/network class.
-- Dashboard parameters: :from_ts and :to_ts.
WITH events AS (
  SELECT
    date_trunc('day', created_at) AS day,
    COALESCE(metadata->>'build', 'unknown') AS build,
    COALESCE(metadata->>'network', metadata->>'network_class', 'unknown') AS network_class,
    name,
    duration_ms
  FROM mobile_performance_events
  WHERE created_at >= :from_ts
    AND created_at < :to_ts
),
starts AS (
  SELECT day, build, network_class, count(*) AS starts
  FROM events
  WHERE name = 'video_startup'
  GROUP BY 1, 2, 3
),
recoveries AS (
  SELECT day, build, network_class, count(*) AS recoveries
  FROM events
  WHERE name = 'video_recovered'
  GROUP BY 1, 2, 3
),
first_frames AS (
  SELECT
    day,
    build,
    network_class,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS first_frame_p50_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS first_frame_p95_ms
  FROM events
  WHERE name = 'video_first_frame' AND duration_ms IS NOT NULL
  GROUP BY 1, 2, 3
),
feed_restore AS (
  SELECT
    day,
    build,
    network_class,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS feed_restore_p50_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS feed_restore_p95_ms
  FROM events
  WHERE name IN ('feed_disk_restore', 'feed_disk_cache_restore')
    AND duration_ms IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT
  s.day,
  s.build,
  s.network_class,
  s.starts,
  COALESCE(r.recoveries, 0) AS recoveries,
  round(100.0 * COALESCE(r.recoveries, 0) / NULLIF(s.starts, 0), 2) AS recovered_rate_pct,
  round(f.first_frame_p50_ms::numeric, 1) AS first_frame_p50_ms,
  round(f.first_frame_p95_ms::numeric, 1) AS first_frame_p95_ms,
  round(fr.feed_restore_p50_ms::numeric, 1) AS feed_restore_p50_ms,
  round(fr.feed_restore_p95_ms::numeric, 1) AS feed_restore_p95_ms
FROM starts s
LEFT JOIN recoveries r USING (day, build, network_class)
LEFT JOIN first_frames f USING (day, build, network_class)
LEFT JOIN feed_restore fr USING (day, build, network_class)
ORDER BY s.day DESC, s.build DESC, s.network_class;

-- Suggested alerts:
-- first_frame_p95_ms > 900 for two consecutive 15-minute windows
-- recovered_rate_pct > 1.0 on non-constrained networks
-- feed_restore_p95_ms > 150
