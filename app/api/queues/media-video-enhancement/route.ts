import { handleCallback } from "@vercel/queue"
import { consumeMediaQueueJob, mediaQueueRetry } from "@/lib/media-priority-queue"
import { processQueuedMediaJob } from "@/lib/media-pipeline/schedule"

export const runtime = "nodejs"
export const maxDuration = 300
const callback = handleCallback(
  (message: unknown) => consumeMediaQueueJob("videoEnhancement", message, (id) => processQueuedMediaJob(id, false)).then(() => {}),
  { visibilityTimeoutSeconds: 360, retry: mediaQueueRetry },
)

export async function POST(request: Request) {
  return callback(request)
}
