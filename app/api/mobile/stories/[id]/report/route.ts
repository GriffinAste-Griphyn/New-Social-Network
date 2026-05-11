import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { reportStory } from "@/lib/safety-store"

export const runtime = "nodejs"

const reportSchema = z.object({
  reason: z
    .enum([
      "harassment",
      "bullying",
      "hate",
      "nudity",
      "sexual",
      "profanity",
      "violence",
      "dangerous_organizations",
      "scam",
      "spam",
      "false_information",
      "illegal_goods",
      "self_harm",
      "child_safety",
      "intellectual_property",
      "other",
    ])
    .default("other"),
  note: z.string().trim().max(1_000).optional(),
})

export async function POST(
  request: Request,
  context: RouteContext<"/api/mobile/stories/[id]/report">,
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:story-reports:user",
      subject: session.id,
      options: mutationRateLimits.reportUser,
    },
    {
      bucket: "mobile:story-reports:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.reportUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const { id } = await context.params
  const parsed = reportSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a valid report reason." },
      { status: 400 },
    )
  }

  try {
    await reportStory({
      reporterId: session.id,
      storyId: id,
      reason: parsed.data.reason,
      note: parsed.data.note,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not report this story.",
      },
      { status: 400 },
    )
  }
}
