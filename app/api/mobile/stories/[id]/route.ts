import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"
import {
  getMyStoryStack,
  getStoryStackForStory,
  removeStoryForOwner,
} from "@/lib/story-store"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
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
      : await getStoryStackForStory(id, session.id)

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
        mediaUrl: versionMediaUrl(
          publicStoryMediaUrl(item.mediaUrl, request, { signed: true }) ??
            item.mediaUrl,
          item.id,
        ),
        thumbnailUrl: versionMediaUrl(
          publicStoryMediaUrl(item.thumbnailUrl, request, {
            signed: true,
          }),
          item.id,
        ),
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
      title: item.textOverlays?.[0]?.label.trim() || item.caption.trim(),
      postedAt: "Today",
      durationSeconds:
        item.assetKind === "video" ? item.durationSeconds ?? 10 : undefined,
      captionVerticalPercent: item.textOverlays?.[0]?.positionY ?? 74,
      textOverlays: item.textOverlays ?? [],
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
