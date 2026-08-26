import { z } from "zod"

import { maximumMediaProcessingAttempts } from "@/lib/media-pipeline/contracts"
import { scheduleMediaProcessingSlice } from "@/lib/media-pipeline/schedule"

export const runtime = "nodejs"
export const maxDuration = 300

const dispatchSchema = z.object({
  jobId: z.string().trim().startsWith("media-job-").max(100),
  source: z.string().trim().min(1).max(100),
  attempt: z
    .number()
    .int()
    .positive()
    .max(maximumMediaProcessingAttempts)
    .optional(),
})

const noStoreHeaders = { "Cache-Control": "private, no-store" }

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    )
  }

  const payload = dispatchSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!payload.success) {
    return Response.json(
      { ok: false, error: "Invalid media processing dispatch." },
      { status: 400, headers: noStoreHeaders },
    )
  }

  scheduleMediaProcessingSlice(payload.data)
  return Response.json(
    { ok: true, accepted: true },
    { status: 202, headers: noStoreHeaders },
  )
}
