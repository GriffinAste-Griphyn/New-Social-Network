import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  getMyStoryStack,
  getStoryStackForStory,
  removeStoryForOwner,
} from "@/lib/story-store"
import { removeStoryAsset } from "@/lib/story-storage"

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
        mediaUrl: absoluteMediaUrl(item.mediaUrl, request) ?? item.mediaUrl,
        thumbnailUrl: absoluteMediaUrl(item.thumbnailUrl, request),
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
  const myStory = await getMyStoryStack(userId)

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
    })),
  }
}
