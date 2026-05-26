import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  deleteStoryInteractionForUser,
  StoryInteractionForbiddenError,
  StoryInteractionNotFoundError,
} from "@/lib/story-interactions"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/mobile/stories/interactions/[interactionId]">,
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:story-interaction-delete:user",
      subject: session.id,
      options: mutationRateLimits.storyInteractionUser,
    },
    {
      bucket: "mobile:story-interaction-delete:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.storyInteractionUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const { interactionId } = await context.params

  try {
    const interaction = await deleteStoryInteractionForUser({
      interactionId,
      userId: session.id,
    })

    return NextResponse.json({ ok: true, interaction })
  } catch (error) {
    if (error instanceof StoryInteractionNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    if (error instanceof StoryInteractionForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not delete this reply.",
      },
      { status: 400 },
    )
  }
}
