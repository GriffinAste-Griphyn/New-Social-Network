import { handleCallback } from "@vercel/queue"
import { consumeMediaQueueJob, mediaQueueRetry } from "@/lib/media-priority-queue"
import { processImageDirect } from "@/lib/image-processing-jobs"

export const runtime = "nodejs"
export const maxDuration = 300
const callback = handleCallback(
  (message: unknown) => consumeMediaQueueJob("imageInitial", message, (id) => processImageDirect(id, "priority_queue")).then(() => {}),
  { visibilityTimeoutSeconds: 360, retry: mediaQueueRetry },
)

export async function POST(request: Request) {
  return callback(request)
}
