import { z } from "zod"
import { MediaWorkerCapacityUnavailable, withMediaWorkerSlot } from "@/lib/media-worker-capacity"

export const mediaQueueTopics = {
  videoInitial: "media-video-first-playable",
  videoEnhancement: "media-video-enhancement",
  imageInitial: "media-image-first-playable",
  imageEnhancement: "media-image-enhancement",
  feedFanout: "media-feed-fanout",
} as const

export type MediaQueueLane = keyof typeof mediaQueueTopics

export const mediaQueueMessageSchema = z.object({
  version: z.literal(1),
  jobId: z.string().min(1).max(200),
  enqueuedAt: z.number().int().nonnegative(),
})
export type MediaQueueMessage = z.infer<typeof mediaQueueMessageSchema>

export function areMediaPriorityQueuesEnabled() {
  return process.env.MEDIA_PRIORITY_QUEUES_ENABLED === "true"
}

// Messages are dispatch envelopes for existing durable database jobs. Never
// deduplicate by job ID: legitimate continuations use that same identity.
export async function sendMediaQueueJob(lane: MediaQueueLane, jobId: string) {
  const { send } = await import("@vercel/queue")
  return send(mediaQueueTopics[lane], {
    version: 1,
    jobId,
    enqueuedAt: Date.now(),
  } satisfies MediaQueueMessage, { region: "iad1", retentionSeconds: 24 * 60 * 60 })
}

export class InvalidMediaQueueMessage extends Error {}

export async function consumeMediaQueueJob(
  lane: MediaQueueLane,
  payload: unknown,
  process: (jobId: string) => Promise<unknown>,
) {
  const parsed = mediaQueueMessageSchema.safeParse(payload)
  const prefix = lane === "imageInitial" ? "image-job-" :
    lane === "imageEnhancement" ? "background-image-" :
    lane === "feedFanout" ? "background-feed-" : "media-job-"
  if (!parsed.success || !parsed.data.jobId.startsWith(prefix)) {
    throw new InvalidMediaQueueMessage("Invalid media queue envelope")
  }
  const startedAt = Date.now()
  try {
    return await withMediaWorkerSlot(lane, () => process(parsed.data.jobId))
  } finally {
    console.info("media_queue_processing", {
      lane,
      jobId: parsed.data.jobId,
      queueWaitMs: Math.max(0, startedAt - parsed.data.enqueuedAt),
      processingMs: Date.now() - startedAt,
    })
  }
}

export function mediaQueueRetry(error: unknown, metadata: { deliveryCount: number }) {
  if (error instanceof InvalidMediaQueueMessage) return { acknowledge: true as const }
  if (error instanceof MediaWorkerCapacityUnavailable) return { afterSeconds: 2 + Math.floor(Math.random() * 3) }
  console.warn("media_queue_retry", {
    errorName: error instanceof Error ? error.name : "unknown",
    reason: error instanceof Error ? error.message : "Media processing failed",
    deliveryCount: metadata.deliveryCount,
  })
  return { afterSeconds: Math.min(30 * 2 ** Math.min(Math.max(metadata.deliveryCount - 1, 0), 4), 300) }
}
