import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import {
  createSafetyReport,
  safetyReportReasons,
} from "@/lib/social-safety"

export const runtime = "nodejs"

const reportSchema = z.object({
  targetKind: z.enum(["story", "user", "interaction"]),
  targetId: z.string().trim().min(1),
  reason: z.enum(safetyReportReasons),
  details: z.string().trim().max(1_000).optional(),
})

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:reports:user",
      subject: session.id,
      options: mutationRateLimits.reportUser,
    },
    {
      bucket: "mobile:reports:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.reportUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = reportSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose something to report." },
      { status: 400 },
    )
  }

  try {
    const reportId = await createSafetyReport({
      reporterId: session.id,
      ...parsed.data,
    })

    return NextResponse.json({ ok: true, reportId })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not submit report.",
      },
      { status: 400 },
    )
  }
}
