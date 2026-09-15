import { handleCallback } from "@vercel/queue"
import { consumeBackgroundMediaMessage } from "@/lib/media-background-jobs"
import { mediaQueueRetry } from "@/lib/media-priority-queue"

export const runtime = "nodejs"
export const maxDuration = 300
const callback = handleCallback(
  (message: unknown) => consumeBackgroundMediaMessage(message, "imageEnhancement"),
  { visibilityTimeoutSeconds: 360, retry: mediaQueueRetry },
)
export async function POST(request: Request) { return callback(request) }
