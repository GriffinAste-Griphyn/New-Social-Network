import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getCreatorStats, type CreatorStatsRange } from "@/lib/creator-stats"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"
import { publicStoryMediaUrl } from "@/lib/story-storage"

export const runtime = "nodejs"

function parseStatsRange(request: Request): CreatorStatsRange {
  const url = new URL(request.url)
  const fromValue = url.searchParams.get("from")
  const toValue = url.searchParams.get("to")
  const storiesValue = url.searchParams.get("stories")
  const includeStoryCommentsValue = url.searchParams.get("includeStoryComments")
  const from = fromValue ? new Date(fromValue) : undefined
  const to = toValue ? new Date(toValue) : undefined

  return {
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    storyScope: storiesValue === "active" ? "active" : "all",
    includeStoryComments:
      includeStoryCommentsValue === "1" ||
      includeStoryCommentsValue === "true",
  }
}

function versionMediaUrl(value: string | null, version: string | null | undefined) {
  if (!value || !version) {
    return value
  }

  try {
    const url = new URL(value)
    url.searchParams.set("v", version)
    return url.toString()
  } catch {
    return value
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
        mediaUrl: versionMediaUrl(
          publicStoryMediaUrl(story.mediaUrl, request, { signed: true }) ??
            story.mediaUrl,
          story.id,
        ),
        thumbnailUrl: versionMediaUrl(
          publicStoryMediaUrl(story.thumbnailUrl, request, {
            signed: true,
          }),
          story.id,
        ),
        commentItems: story.commentItems.map((comment) => ({
          ...comment,
          actor: {
            ...comment.actor,
            imageUrl: publicProfileAvatarUrl(comment.actor.imageUrl, request),
          },
          mediaUrl:
            publicStoryMediaUrl(comment.mediaUrl, request, { signed: true }) ??
            comment.mediaUrl,
          mediaThumbnailUrl: publicStoryMediaUrl(
            comment.mediaThumbnailUrl,
            request,
            { signed: true },
          ),
        })),
      })),
    },
  })
}
