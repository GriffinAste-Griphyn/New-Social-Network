import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"
import { getFeedData } from "@/lib/story-store"
import { publicStoryMediaUrl } from "@/lib/story-storage"

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

function absoluteStoryCardMedia<T extends {
  mediaUrl: string
  thumbnailUrl: string | null
}>(story: T, request: Request) {
  return {
    ...story,
    mediaUrl:
      publicStoryMediaUrl(story.mediaUrl, request, { signed: true }) ??
      story.mediaUrl,
    thumbnailUrl: publicStoryMediaUrl(story.thumbnailUrl, request, {
      signed: true,
    }),
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
  const latestMyStoryItem =
    feed.myStory.items.length > 0
      ? feed.myStory.items[feed.myStory.items.length - 1]
      : null
  const latestMyStoryThumbnailUrl = versionMediaUrl(
    publicStoryMediaUrl(feed.myStory.latestThumbnailUrl, request, {
      signed: true,
    }),
    latestMyStoryItem?.id,
  )

  return NextResponse.json({
    ok: true,
    session: {
      displayName: user.displayName,
      handle: user.handle,
    },
    followingProfiles: feed.followingProfiles.map((profile) => ({
      ...profile,
      imageUrl:
        publicProfileAvatarUrl(profile.imageUrl, request) ??
        absoluteMediaUrl(profile.imageUrl, request),
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
      imageUrl:
        publicProfileAvatarUrl(account.imageUrl, request) ??
        absoluteMediaUrl(account.imageUrl, request),
    })),
    myStory: {
      ...feed.myStory,
      owner: {
        ...feed.myStory.owner,
        imageUrl:
          publicProfileAvatarUrl(feed.myStory.owner.imageUrl, request) ??
          absoluteMediaUrl(feed.myStory.owner.imageUrl, request),
      },
      latestThumbnailUrl: latestMyStoryThumbnailUrl,
      latestTextOverlays: latestMyStoryItem?.textOverlays ?? [],
      items: feed.myStory.items.map((story) =>
        absoluteStoryCardMedia(story, request),
      ),
    },
  })
}
