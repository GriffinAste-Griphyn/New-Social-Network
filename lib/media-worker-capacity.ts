import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { getDb } from "@/lib/db"
import type { MediaQueueLane } from "@/lib/media-priority-queue"

export const mediaWorkerSlots: Record<MediaQueueLane, number> = {
  videoInitial: 2,
  imageInitial: 2,
  videoEnhancement: 1,
  imageEnhancement: 1,
  feedFanout: 2,
}

export function configuredMediaWorkerSlots(lane: MediaQueueLane) {
  const names: Record<MediaQueueLane, string> = {
    videoInitial: "MEDIA_WORKERS_VIDEO_INITIAL",
    imageInitial: "MEDIA_WORKERS_IMAGE_INITIAL",
    videoEnhancement: "MEDIA_WORKERS_VIDEO_ENHANCEMENT",
    imageEnhancement: "MEDIA_WORKERS_IMAGE_ENHANCEMENT",
    feedFanout: "MEDIA_WORKERS_FEED_FANOUT",
  }
  const raw = process.env[names[lane]]
  const value = raw?.trim() ? Number(raw) : NaN
  return Number.isSafeInteger(value) ? Math.min(32, Math.max(1, value)) : mediaWorkerSlots[lane]
}

export class MediaWorkerCapacityUnavailable extends Error {}

export async function withMediaWorkerSlot<T>(lane: MediaQueueLane, run: () => Promise<T>): Promise<T> {
  const db = getDb()
  const token = randomUUID()
  let acquiredSlot: number | undefined
  const capacity = configuredMediaWorkerSlots(lane)
  for (let slot = 0; slot < capacity; slot += 1) {
    const result = await db.execute(sql`
      INSERT INTO media_worker_leases (lane, slot, owner_token, expires_at)
      VALUES (${lane}, ${slot}, ${token}, now() + interval '360 seconds')
      ON CONFLICT (lane, slot) DO UPDATE
      SET owner_token = EXCLUDED.owner_token, expires_at = EXCLUDED.expires_at
      WHERE media_worker_leases.expires_at <= now()
      RETURNING slot
    `)
    if (result.rows.length > 0) { acquiredSlot = slot; break }
  }
  if (acquiredSlot === undefined) {
    throw new MediaWorkerCapacityUnavailable(`All ${lane} worker slots are busy`)
  }
  try {
    return await run()
  } finally {
    // Token fencing prevents a late worker from releasing a replacement lease.
    // A terminated function recovers by expiry without requiring cleanup.
    await db.execute(sql`
      UPDATE media_worker_leases SET expires_at = now()
      WHERE lane = ${lane} AND slot = ${acquiredSlot} AND owner_token = ${token}
    `).catch((error) => console.error("media_worker_slot_release_failed", { lane, error }))
  }
}
