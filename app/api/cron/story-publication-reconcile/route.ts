import { reconcileStoryPublications } from "@/lib/story-publication"

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

  const result = await reconcileStoryPublications({ limit: 100 })

  return Response.json(
    { ok: true, ...result },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
