-- Mobile media SLO dashboard, grouped by day/build/network class.
-- Dashboard parameters: :from_ts and :to_ts.
-- New clients emit a stable playback id across startup, stall, recovery, and
-- terminal events. The row id fallback keeps older client builds visible.
WITH events AS (
  SELECT
    date_trunc('day', created_at) AS day,
    COALESCE(metadata->>'build', 'unknown') AS build,
    COALESCE(metadata->>'network_class', metadata->>'network', 'unknown') AS network_class,
    COALESCE(metadata->>'playback', id::text) AS playback_id,
    name,
    duration_ms
  FROM mobile_performance_events
  WHERE created_at >= :from_ts
    AND created_at < :to_ts
),
starts AS (
  SELECT day, build, network_class, count(DISTINCT playback_id) AS playback_sessions
  FROM events
  WHERE name = 'video_startup'
  GROUP BY 1, 2, 3
),
stalls AS (
  SELECT day, build, network_class, count(DISTINCT playback_id) AS stalled_sessions
  FROM events
  WHERE name = 'video_stalled'
  GROUP BY 1, 2, 3
),
recoveries AS (
  SELECT day, build, network_class, count(DISTINCT playback_id) AS recovered_sessions
  FROM events
  WHERE name = 'video_recovered'
  GROUP BY 1, 2, 3
),
terminal_failures AS (
  SELECT day, build, network_class, count(DISTINCT playback_id) AS terminal_failure_sessions
  FROM events
  WHERE name = 'video_terminal_failure'
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
  s.playback_sessions,
  COALESCE(st.stalled_sessions, 0) AS stalled_sessions,
  COALESCE(r.recovered_sessions, 0) AS recovered_sessions,
  COALESCE(tf.terminal_failure_sessions, 0) AS terminal_failure_sessions,
  round(100.0 * COALESCE(st.stalled_sessions, 0) / NULLIF(s.playback_sessions, 0), 2)
    AS rebuffer_session_rate_pct,
  round(100.0 * COALESCE(r.recovered_sessions, 0) / NULLIF(st.stalled_sessions, 0), 2)
    AS stalled_session_recovery_rate_pct,
  round(100.0 * COALESCE(tf.terminal_failure_sessions, 0) / NULLIF(s.playback_sessions, 0), 2)
    AS terminal_failure_rate_pct,
  round(f.first_frame_p50_ms::numeric, 1) AS first_frame_p50_ms,
  round(f.first_frame_p95_ms::numeric, 1) AS first_frame_p95_ms,
  round(fr.feed_restore_p50_ms::numeric, 1) AS feed_restore_p50_ms,
  round(fr.feed_restore_p95_ms::numeric, 1) AS feed_restore_p95_ms
FROM starts s
LEFT JOIN stalls st USING (day, build, network_class)
LEFT JOIN recoveries r USING (day, build, network_class)
LEFT JOIN terminal_failures tf USING (day, build, network_class)
LEFT JOIN first_frames f USING (day, build, network_class)
LEFT JOIN feed_restore fr USING (day, build, network_class)
ORDER BY s.day DESC, s.build DESC, s.network_class;

-- Suggested initial alerts (tune after one week of production baselines):
-- first_frame_p95_ms > 900 for two consecutive 15-minute windows
-- rebuffer_session_rate_pct > 1.0 on standard networks
-- terminal_failure_rate_pct > 0.1 on any network class
-- feed_restore_p95_ms > 150
