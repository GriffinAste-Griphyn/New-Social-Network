import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { getDb } from "@/lib/db"

/** Completion, status recovery and cron may all request the same review. */
export async function withStoryModerationLease<T>(storyId: string, run: (lease: { lane: string; token: string }) => Promise<T>) {
  const db = getDb()
  const lane = `storyModeration:${storyId}`
  const token = randomUUID()
  // The lease exceeds the 300-second moderation function budget. Crashes
  // recover by expiry; late releases cannot remove a replacement worker.
  const acquired = await db.execute(sql`
    INSERT INTO media_worker_leases (lane, slot, owner_token, expires_at)
    VALUES (${lane}, 0, ${token}, now() + interval '360 seconds')
    ON CONFLICT (lane, slot) DO UPDATE
    SET owner_token = EXCLUDED.owner_token, expires_at = EXCLUDED.expires_at
    WHERE media_worker_leases.expires_at <= now()
    RETURNING owner_token
  `)
  if (acquired.rows.length === 0) return { status: "busy" as const }
  try {
    return await run({ lane, token })
  } finally {
    await db.execute(sql`
      DELETE FROM media_worker_leases
      WHERE lane = ${lane} AND slot = 0 AND owner_token = ${token}
    `).catch((error) => console.error("story_moderation_lease_release_failed", { storyId, error }))
  }
}
