import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getMobileStoryStackResponse } from "@/lib/mobile-story-stacks"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { removeStoryForOwner } from "@/lib/story-store"
import { removeStoryAsset } from "@/lib/story-storage"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  context: RouteContext<"/api/mobile/stories/[id]">,
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params
  const response = await getMobileStoryStackResponse(id, session.id, request)

  if (!response) {
    return NextResponse.json({ error: "Story not found." }, { status: 404 })
  }

  return NextResponse.json(response)
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/mobile/stories/[id]">,
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:story-delete:user",
      subject: session.id,
      options: mutationRateLimits.storyWriteUser,
    },
    {
      bucket: "mobile:story-delete:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.storyWriteUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const { id } = await context.params

  try {
    const removedStory = await removeStoryForOwner(id, session.id)
    const mediaUrls = Array.from(
      new Set(
        [
          removedStory.mediaUrl,
          removedStory.thumbnailUrl,
          removedStory.originalMediaUrl,
          removedStory.originalThumbnailUrl,
        ].filter((value): value is string => Boolean(value)),
      ),
    )

    await Promise.allSettled(mediaUrls.map((mediaUrl) => removeStoryAsset(mediaUrl)))

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete story."

    return NextResponse.json({ error: message }, { status: 400 })
  }
}
