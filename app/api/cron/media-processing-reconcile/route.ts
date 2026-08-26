import { recoverableMediaJobIds } from "@/lib/media-pipeline/direct-processing"
import { scheduleMediaProcessing } from "@/lib/media-pipeline/schedule"

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
      {
        status: 401,
        headers: { "Cache-Control": "private, no-store" },
      },
    )
  }

  const candidates = await recoverableMediaJobIds({ limit: 1 })
  for (const candidate of candidates) {
    scheduleMediaProcessing(candidate.id, "scheduled_reconciliation")
  }
  return Response.json(
    { ok: true, scanned: candidates.length, scheduled: candidates.length },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
