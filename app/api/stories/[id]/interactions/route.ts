import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { createStoryInteraction } from "@/lib/story-interactions"

export const runtime = "nodejs"

const interactionSchema = z.object({
  kind: z.enum(["reply", "comment", "reaction"]).default("comment"),
  body: z.string().trim().max(1_000).optional(),
  reaction: z.string().trim().max(24).optional(),
})

export async function POST(
  request: Request,
  context: RouteContext<"/api/stories/[id]/interactions">,
) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await requireSession()
  const { id } = await context.params
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:story-interactions:user",
      subject: session.id,
      options: mutationRateLimits.storyInteractionUser,
    },
    {
      bucket: "web:story-interactions:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.storyInteractionUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = interactionSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Check the story interaction."

    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    await createStoryInteraction({
      storyId: id,
      actorId: session.id,
      kind: parsed.data.kind,
      body: parsed.data.body,
      reaction: parsed.data.reaction,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not save this comment.",
      },
      { status: 400 },
    )
  }
}
