import { reconcileImageProcessingJobs } from "@/lib/image-processing-jobs"
import { backfillActiveStoryFitThumbnails } from "@/lib/story-thumbnail-backfill"

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

  const result = await reconcileImageProcessingJobs({ limit: 10 })
  const thumbnailBackfill = await backfillActiveStoryFitThumbnails({ limit: 25 })
  return Response.json(
    { ok: true, ...result, thumbnailBackfill },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
