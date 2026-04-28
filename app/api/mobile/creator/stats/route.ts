import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"

export const runtime = "nodejs"

function absoluteMediaUrl(value: string | null, request: Request) {
  if (!value) {
    return null
  }

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  return new URL(value, request.url).toString()
}

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (session.creatorStatus !== "active") {
    return NextResponse.json(
      { error: "Creator stats are available after creator tools are active." },
      { status: 403 },
    )
  }

  const stats = await getCreatorStats(session.id)

  return NextResponse.json({
    ok: true,
    stats: {
      ...stats,
      stories: stats.stories.map((story) => ({
        ...story,
        mediaUrl: absoluteMediaUrl(story.mediaUrl, request) ?? story.mediaUrl,
        thumbnailUrl: absoluteMediaUrl(story.thumbnailUrl, request),
      })),
    },
  })
}
