import { aggregateCreatorFeedScores } from "@/lib/media-operations"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } })
  }
  return Response.json({ ok: true, feed: await aggregateCreatorFeedScores() }, { headers: { "Cache-Control": "private, no-store" } })
}
