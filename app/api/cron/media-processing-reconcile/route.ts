import { start } from "workflow/api"

import { mediaProcessingReconcilerWorkflow } from "@/workflows/media-processing/reconciler"

export const runtime = "nodejs"
export const maxDuration = 60

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

  const run = await start(mediaProcessingReconcilerWorkflow)
  return Response.json(
    { ok: true, runId: run.runId },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}

