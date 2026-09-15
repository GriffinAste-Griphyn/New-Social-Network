import { randomUUID } from "node:crypto"
import { desc, eq, sql } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { imageProcessingJobs, mediaProcessingJobs } from "@/lib/db/schema"
import { areMediaPriorityQueuesEnabled, sendMediaQueueJob, type MediaQueueLane } from "@/lib/media-priority-queue"

export async function checkMediaQueueDelivery() {
  if (!areMediaPriorityQueuesEnabled()) return { status: "disabled" as const }
  const db = getDb()
  // A duplicate cron invocation must not multiply readiness traffic. This
  // lease has its own lane and never occupies a media processing slot.
  const lease = await db.execute(sql`
    INSERT INTO media_worker_leases (lane, slot, owner_token, expires_at)
    VALUES ('queue-self-check', 0, ${randomUUID()}, now() + interval '5 minutes')
    ON CONFLICT (lane, slot) DO UPDATE SET owner_token = EXCLUDED.owner_token,
      expires_at = EXCLUDED.expires_at
    WHERE media_worker_leases.expires_at <= now() RETURNING slot
  `)
  if (lease.rows.length === 0) return { status: "throttled" as const }

  const [videos, images] = await Promise.all([
    db.select({ id: mediaProcessingJobs.id }).from(mediaProcessingJobs)
      .where(eq(mediaProcessingJobs.status, "ready")).orderBy(desc(mediaProcessingJobs.updatedAt)).limit(1),
    db.select({ id: imageProcessingJobs.id }).from(imageProcessingJobs)
      .where(eq(imageProcessingJobs.status, "ready")).orderBy(desc(imageProcessingJobs.updatedAt)).limit(1),
  ])
  const probes: Array<{ lane: MediaQueueLane; jobId: string }> = []
  if (videos[0]) {
    probes.push({ lane: "videoInitial", jobId: videos[0].id }, { lane: "videoEnhancement", jobId: videos[0].id })
  }
  if (images[0]) probes.push({ lane: "imageInitial", jobId: images[0].id })
  const results = await Promise.allSettled(probes.map(async (probe) => {
    const sent = await sendMediaQueueJob(probe.lane, probe.jobId)
    return { lane: probe.lane, messageId: sent.messageId }
  }))
  const accepted = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
  const failed = results.length - accepted.length
  for (const result of results) {
    if (result.status === "rejected") console.error("media_queue_self_check_failed", { error: result.reason })
  }
  console.info("media_queue_self_check", { accepted, failed, skipped: 3 - probes.length })
  return { status: failed ? "error" as const : "sent" as const, accepted, failed, skipped: 3 - probes.length }
}
