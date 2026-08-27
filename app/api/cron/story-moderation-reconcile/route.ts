import { reconcilePendingStoryModeration } from "@/lib/story-moderation"

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

  const result = await reconcilePendingStoryModeration({ limit: 50 })
  return Response.json(
    { ok: true, ...result },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
