import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"
import { publicStoryMediaUrl } from "@/lib/story-storage"

export const runtime = "nodejs"

function parseStatsRange(request: Request) {
  const url = new URL(request.url)
  const fromValue = url.searchParams.get("from")
  const toValue = url.searchParams.get("to")
  const from = fromValue ? new Date(fromValue) : undefined
  const to = toValue ? new Date(toValue) : undefined

  return {
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined,
  }
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

  const stats = await getCreatorStats(session.id, parseStatsRange(request))

  return NextResponse.json({
    ok: true,
    stats: {
      ...stats,
      stories: stats.stories.map((story) => ({
        ...story,
        mediaUrl:
          publicStoryMediaUrl(story.mediaUrl, request, { signed: true }) ??
          story.mediaUrl,
        thumbnailUrl: publicStoryMediaUrl(story.thumbnailUrl, request, {
          signed: true,
        }),
      })),
    },
  })
}
