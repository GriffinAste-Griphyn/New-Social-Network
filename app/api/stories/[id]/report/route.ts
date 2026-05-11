import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
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
  context: RouteContext<"/api/stories/[id]/report">,
) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await requireSession()
  const { id } = await context.params
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:story-reports:user",
      subject: session.id,
      options: mutationRateLimits.reportUser,
    },
    {
      bucket: "web:story-reports:ip",
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
