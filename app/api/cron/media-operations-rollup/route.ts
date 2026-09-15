import { collectMediaOperations } from "@/lib/media-operations-monitor"
import { checkMediaQueueDelivery } from "@/lib/media-queue-self-check"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    )
  }

  const qoe = await collectMediaOperations()
  const queues = await checkMediaQueueDelivery().catch((error) => {
    console.error("media_queue_self_check_failed", { error })
    return { status: "error" as const }
  })
  return Response.json(
    { ok: true, qoe, queues },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
