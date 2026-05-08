import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { recordStoryImpression } from "@/lib/story-impressions"

export const runtime = "nodejs"

const impressionSchema = z.object({
  viewedMs: z.number().min(0).max(10 * 60 * 1000).default(0),
  completed: z.boolean().default(false),
})

export async function POST(
  request: Request,
  context: RouteContext<"/api/mobile/stories/[id]/impressions">,
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:story-impressions:user",
      subject: session.id,
      options: mutationRateLimits.storyImpressionUser,
    },
    {
      bucket: "mobile:story-impressions:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.storyImpressionUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const { id } = await context.params
  const parsed = impressionSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Check the view event."

    return NextResponse.json({ error: message }, { status: 400 })
  }

  const result = await recordStoryImpression({
    storyId: id,
    viewerId: session.id,
    viewedMs: parsed.data.viewedMs,
    completed: parsed.data.completed,
  })

  return NextResponse.json({ ok: true, ...result })
}
