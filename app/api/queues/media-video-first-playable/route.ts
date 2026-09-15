import { handleCallback } from "@vercel/queue"
import { consumeMediaQueueJob, mediaQueueRetry } from "@/lib/media-priority-queue"
import { processQueuedMediaJob } from "@/lib/media-pipeline/schedule"

export const runtime = "nodejs"
export const maxDuration = 300
const callback = handleCallback(
  (message: unknown) => consumeMediaQueueJob("videoInitial", message, (id) => processQueuedMediaJob(id, true)).then(() => {}),
  { visibilityTimeoutSeconds: 360, retry: mediaQueueRetry },
)

export async function POST(request: Request) {
  return callback(request)
}
