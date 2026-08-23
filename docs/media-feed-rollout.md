# Media/feed rollout guardrails

Before applying `0044_aggressive_media_feed_foundation.sql`, capture the live-feed plan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at
FROM stories
WHERE status = 'live'
  AND moderation_status = 'approved'
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

Repeat it after the migration and confirm `stories_live_feed_idx` is selected.

The application database pool is capped at two connections per warm function. Monitor
`pg_stat_activity` during rollout. If total active connections remain above 80 for five
consecutive minutes, roll back the pool change to `max: 1`, redeploy, and investigate
function concurrency before retrying. The new feed index and `story_publish_jobs` outbox
are independent of that rollback and should remain applied.
