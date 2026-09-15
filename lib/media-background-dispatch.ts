import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { start } from "workflow/api"
import { getDb } from "@/lib/db"
import { imageProcessingJobs, mediaAssets, mediaBackgroundJobs } from "@/lib/db/schema"
import { dispatchMediaTask } from "@/lib/media-dispatch"
import { areMediaPriorityQueuesEnabled, sendMediaQueueJob } from "@/lib/media-priority-queue"
import { processMediaBackgroundWorkflow } from "@/workflows/media-background"

export type BackgroundMediaKind = "imageEnhancement" | "feedFanout"

export async function dispatchBackgroundMediaJob(id: string, kind: BackgroundMediaKind) {
  return dispatchMediaTask({
    label: kind, identity: id,
    startQueue: async () => {
      if (!areMediaPriorityQueuesEnabled()) return false
      await sendMediaQueueJob(kind, id)
      return true
    },
    startDurable: () => start(processMediaBackgroundWorkflow, [id, kind]),
    runDirect: async () => {
      const { runBackgroundMediaJob } = await import("@/lib/media-background-jobs")
      return runBackgroundMediaJob(id, kind)
    },
  })
}

async function enqueue(job: typeof mediaBackgroundJobs.$inferInsert) {
  await getDb().insert(mediaBackgroundJobs).values(job).onConflictDoNothing()
  // Persist before dispatch: scheduled recovery owns any interrupted handoff.
  await dispatchBackgroundMediaJob(job.id, job.kind as BackgroundMediaKind)
}

export async function enqueueImageEnhancement(jobId: string) {
  if (process.env.MEDIA_IMAGE_AVIF_ENHANCEMENT_ENABLED === "false") return
  const [job] = await getDb().select().from(imageProcessingJobs).where(eq(imageProcessingJobs.id, jobId)).limit(1)
  if (!job) return
  const [asset] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, job.mediaAssetId)).limit(1)
  // Original bytes are required; never transcode the already compressed display.
  if (!asset || asset.storageProvider !== "cloudflare-r2" ||
      asset.storageKey !== `${job.basePathname}-fast-v1-display.webp` || asset.deletedAt) return
  await enqueue({ id: `background-image-${asset.id}`, kind: "imageEnhancement", mediaAssetId: asset.id,
    payload: { basePathname: job.basePathname, contentMode: job.contentMode, expectedKey: asset.storageKey } })
}

export async function enqueueFeedFanout(storyId: string, cursor = "") {
  await enqueue({ id: `background-feed-${storyId}-${createHash("sha256").update(cursor).digest("hex").slice(0, 24)}`,
    kind: "feedFanout", storyId, payload: { cursor } })
}

