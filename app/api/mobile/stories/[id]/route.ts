import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"
import {
  getMyStoryStack,
  getStoryStackForStory,
  removeStoryForOwner,
} from "@/lib/story-store"
import { publicStoryMediaUrl, removeStoryAsset } from "@/lib/story-storage"

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

export async function GET(
  request: Request,
  context: RouteContext<"/api/mobile/stories/[id]">,
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params
  const story =
    id === "my-story"
      ? await getMobileMyStoryStack(session.id)
      : await getStoryStackForStory(id)

  if (!story) {
    return NextResponse.json({ error: "Story not found." }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    story: {
      ...story,
      avatarUrl: absoluteMediaUrl(story.avatarUrl, request),
      items: story.items.map((item) => ({
        ...item,
        mediaUrl:
          publicStoryMediaUrl(item.mediaUrl, request, { signed: true }) ??
          item.mediaUrl,
        thumbnailUrl: publicStoryMediaUrl(item.thumbnailUrl, request, {
          signed: true,
        }),
      })),
    },
  })
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/mobile/stories/[id]">,
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params

  try {
    const mediaUrl = await removeStoryForOwner(id, session.id)

    await removeStoryAsset(mediaUrl)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete story."

    return NextResponse.json({ error: message }, { status: 400 })
  }
}

async function getMobileMyStoryStack(userId: string) {
  const [myStory, creatorStats] = await Promise.all([
    getMyStoryStack(userId),
    getCreatorStats(userId),
  ])
  const statsByStoryId = new Map(
    creatorStats.stories.map((story) => [story.id, story]),
  )

  if (myStory.items.length === 0) {
    return null
  }

  return {
    id: "my-story",
    creatorId: userId,
    creator: "My Story",
    handle: `@${myStory.owner.handle}`,
    avatarUrl: myStory.owner.imageUrl,
    items: myStory.items.map((item) => ({
      id: item.id,
      assetKind: item.assetKind,
      mediaUrl: item.mediaUrl,
      thumbnailUrl: item.thumbnailUrl,
      title: item.caption.trim(),
      postedAt: "Today",
      durationSeconds: item.assetKind === "video" ? 10 : undefined,
      captionVerticalPercent: 74,
      stats: (() => {
        const stats = statsByStoryId.get(item.id)

        return {
          views: stats?.views ?? 0,
          uniqueViewers: stats?.uniqueViewers ?? 0,
          completedViews: stats?.completedViews ?? 0,
          completionRate: stats?.completionRate ?? 0,
          averageViewedSeconds: stats?.averageViewedSeconds ?? 0,
          comments: stats?.comments ?? 0,
          replies: stats?.replies ?? 0,
          earningsCents: stats?.earningsCents ?? 0,
        }
      })(),
    })),
  }
}
