import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getFeedData } from "@/lib/story-store"

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

function absoluteStoryCardMedia<T extends {
  mediaUrl: string
  thumbnailUrl: string | null
}>(story: T, request: Request) {
  return {
    ...story,
    mediaUrl: absoluteMediaUrl(story.mediaUrl, request) ?? story.mediaUrl,
    thumbnailUrl: absoluteMediaUrl(story.thumbnailUrl, request),
  }
}

function collapseStoryCardsByCreator<T extends { handle: string }>(stories: T[]) {
  const seenHandles = new Set<string>()
  const collapsedStories: T[] = []

  stories.forEach((story) => {
    if (seenHandles.has(story.handle)) {
      return
    }

    seenHandles.add(story.handle)
    collapsedStories.push(story)
  })

  return collapsedStories
}

export async function POST(request: Request) {
  const user = await getCompleteMobileSession(request)

  if (!user) {
    return NextResponse.json(
      { error: "Sign in before loading stories." },
      { status: 401 },
    )
  }

  const feed = await getFeedData(user.id)
  const followingStories = collapseStoryCardsByCreator(
    feed.followingStories.map((story) => absoluteStoryCardMedia(story, request)),
  )
  const followedCreatorNames = new Set(
    followingStories.map((story) => story.creator.toLowerCase()),
  )
  const discoverStories = collapseStoryCardsByCreator(
    feed.discoverStories.map((story) => absoluteStoryCardMedia(story, request)),
  ).filter((story) => !followedCreatorNames.has(story.creator.toLowerCase()))

  return NextResponse.json({
    ok: true,
    session: {
      displayName: user.displayName,
      handle: user.handle,
    },
    followingProfiles: feed.followingProfiles.map((profile) => ({
      ...profile,
      imageUrl: absoluteMediaUrl(profile.imageUrl, request),
    })),
    followingStories,
    discoverTiles: discoverStories.map((story) => ({
      id: story.id,
      assetKind: story.assetKind,
      imageUrl: story.mediaUrl,
      thumbnailUrl: story.thumbnailUrl,
      title: story.creator,
      subtitle: story.title,
    })),
    suggestedAccounts: feed.suggestedAccounts.map((account) => ({
      ...account,
      imageUrl: absoluteMediaUrl(account.imageUrl, request),
    })),
    myStory: {
      ...feed.myStory,
      owner: {
        ...feed.myStory.owner,
        imageUrl: absoluteMediaUrl(feed.myStory.owner.imageUrl, request),
      },
      latestThumbnailUrl: absoluteMediaUrl(
        feed.myStory.latestThumbnailUrl,
        request,
      ),
      items: feed.myStory.items.map((story) =>
        absoluteStoryCardMedia(story, request),
      ),
    },
  })
}
