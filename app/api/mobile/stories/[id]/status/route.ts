import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { userFacingModerationReason } from "@/lib/safety/user-facing"
import { getStoryUploadStatusForOwner } from "@/lib/story-store"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params
  const storyStatus = await getStoryUploadStatusForOwner(id, session.id)

  if (!storyStatus) {
    return NextResponse.json({ error: "Story not found." }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    story: {
      ...storyStatus,
      moderationReason: userFacingModerationReason({
        moderationStatus: storyStatus.moderationStatus,
        moderationReason: storyStatus.moderationReason,
      }),
    },
  })
}
