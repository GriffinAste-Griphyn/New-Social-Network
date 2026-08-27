import {
  aggregateCreatorFeedScores,
  rollupRecentMediaQoe,
} from "@/lib/media-operations"

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

  const [qoe, feed] = await Promise.all([
    rollupRecentMediaQoe(),
    aggregateCreatorFeedScores(),
  ])
  return Response.json(
    { ok: true, qoe, feed },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
