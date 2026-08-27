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

  const candidates = await recoverableMediaJobIds({ limit: 3 })
  const results = await Promise.allSettled(
    candidates.map((candidate) =>
      scheduleMediaProcessing(candidate.id, "scheduled_reconciliation"),
    ),
  )
  const scheduled = results.filter(({ status }) => status === "fulfilled").length
  return Response.json(
    {
      ok: true,
      scanned: candidates.length,
      scheduled,
      failed: results.length - scheduled,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
