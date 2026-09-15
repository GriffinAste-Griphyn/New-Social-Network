import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { retryableStoryModerationReasons } from "@/lib/safety/moderation-retry"

/** Coalesce recovery polls before creating workflow runs, separately from the worker lease. */
export async function claimStoryModerationDispatch(storyId: string) {
  const lane = `storyModerationDispatch:${storyId}`
  const token = randomUUID()
  const db = getDb()
  const result = await db.execute(sql`
    INSERT INTO media_worker_leases (lane, slot, owner_token, expires_at)
    SELECT ${lane}, 0, ${token}, now() + interval '30 seconds'
    WHERE EXISTS (SELECT 1 FROM stories WHERE id = ${storyId}
      AND status IN ('processing', 'live') AND expires_at > now()
      AND (asset_kind = 'video' OR processing_status = 'ready')
      AND (moderation_status = 'pending' OR
        (moderation_status = 'flagged' AND moderation_reason IN
          (${sql.join([...retryableStoryModerationReasons].map((reason) => sql`${reason}`), sql`, `)}))))
    AND NOT EXISTS (SELECT 1 FROM media_worker_leases
      WHERE lane = ${`storyModeration:${storyId}`} AND slot = 0 AND expires_at > now())
    ON CONFLICT (lane, slot) DO UPDATE
    SET owner_token = EXCLUDED.owner_token, expires_at = EXCLUDED.expires_at
    WHERE media_worker_leases.expires_at <= now()
    RETURNING owner_token
  `)
  if (result.rows.length === 0) return null
  return {
    // Keep successful dispatches until expiry, including while a run is queued.
    // A failed transport can retry immediately without deleting a newer claim.
    release: () => db.execute(sql`DELETE FROM media_worker_leases
      WHERE lane = ${lane} AND slot = 0 AND owner_token = ${token}`),
  }
}
