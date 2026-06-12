import { createHash } from "node:crypto"
import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"
import { createMobileStoryMediaUrlResolver } from "@/lib/story-media/mobile-playback"
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

async function absoluteStoryCardMedia<T extends {
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  processingStatus?: string | null
}>(
  story: T,
  resolver: ReturnType<typeof createMobileStoryMediaUrlResolver>,
) {
  const mediaUrl = await resolver.resolve(story.mediaUrl, {
    assetKind: story.assetKind,
    processingStatus: story.processingStatus,
  })
  const thumbnailUrl = await resolver.resolve(story.thumbnailUrl, {
    directVideoPlayback: false,
  })

  if (story.assetKind !== "video") {
    return {
      ...story,
      mediaUrl,
      thumbnailUrl,
    }
  }

  const playbackMediaUrl = await resolver.resolve(story.mediaUrl, {
    assetKind: story.assetKind,
    directVideoPlayback: false,
    processingStatus: story.processingStatus,
  })
  const originalMediaUrl =
    mediaUrl && mediaUrl !== playbackMediaUrl ? mediaUrl : null

  return {
    ...story,
    mediaUrl,
    thumbnailUrl,
    renditions: {
      playback: {
        mediaUrl: playbackMediaUrl,
        thumbnailUrl,
      },
      original: originalMediaUrl
        ? {
            mediaUrl: originalMediaUrl,
            thumbnailUrl,
          }
        : null,
    },
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

function jsonResponse(payload: unknown) {
  const body = JSON.stringify(payload)
  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`
  const cacheControl = "private, no-store"
  const vary = "Authorization, X-Device-Id"

  return new Response(body, {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Type": "application/json",
      ETag: etag,
      Vary: vary,
    },
  })
}

async function feedResponse(
  request: Request,
) {
  const startedAt = performance.now()
  const user = await getCompleteMobileSession(request)

  if (!user) {
    return NextResponse.json(
      { error: "Sign in before loading stories." },
      { status: 401 },
    )
  }

  const feed = await getFeedData(user.id)
  const mediaUrlResolver = createMobileStoryMediaUrlResolver(request, {
    fallbackUrl: (value) =>
      publicStoryMediaUrl(value, request, { signed: true }) ?? value,
  })
  const followingStories = collapseStoryCardsByCreator(
    await Promise.all(
      feed.followingStories.map((story) =>
        absoluteStoryCardMedia(story, mediaUrlResolver),
      ),
    ),
  )
  const followingTimelineStories = collapseStoryCardsByCreator(
    await Promise.all(
      feed.followingTimelineStories.map((story) =>
        absoluteStoryCardMedia(story, mediaUrlResolver),
      ),
    ),
  )
  const followedCreatorNames = new Set(
    followingStories.map((story) => story.creator.toLowerCase()),
  )
  const discoverStories = collapseStoryCardsByCreator(
    await Promise.all(
      feed.discoverStories.map((story) =>
        absoluteStoryCardMedia(story, mediaUrlResolver),
      ),
    ),
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

  const response = jsonResponse(
    {
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
      followingTimelineStories,
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
        items: await Promise.all(
          feed.myStory.items.map((story) =>
            absoluteStoryCardMedia(story, mediaUrlResolver),
          ),
        ),
      },
    },
  )
  response.headers.set(
    "Server-Timing",
    `mobile-feed;dur=${Math.max(performance.now() - startedAt, 0).toFixed(1)}`,
  )

  return response
}

export async function GET(request: Request) {
  return feedResponse(request)
}

export async function POST(request: Request) {
  return feedResponse(request)
}
