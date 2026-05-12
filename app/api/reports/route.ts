import { NextResponse } from "next/server"
import { z } from "zod"

import { getSession, isProfileComplete } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
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
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await getSession()

  if (!session) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    )
  }

  if (!isProfileComplete(session)) {
    return NextResponse.json(
      { error: "Profile setup required." },
      { status: 403 },
    )
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:reports:user",
      subject: session.id,
      options: mutationRateLimits.reportUser,
    },
    {
      bucket: "web:reports:ip",
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
