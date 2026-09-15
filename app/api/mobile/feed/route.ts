import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { readFeedSnapshot, usableFeedSnapshot } from "@/lib/feed-snapshot-store"
import { feedResponseEtag, feedResponseHeaders, matchesFeedEtag } from "@/lib/feed-response-cache"
import {
  isVercelBlobAccessDisabled,
  isVercelBlobMediaReference,
} from "@/lib/media-availability"
import { getMobileInitialStoryStacks } from "@/lib/mobile-story-stacks"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"
import { getFeedData, getFollowingTimelinePage } from "@/lib/story-store"
import {
  createCloudflareStreamThumbnailMediaUrl,
  publicStoryMediaUrl,
} from "@/lib/story-storage"

export const runtime = "nodejs"
const initialStoryStackLimit = 4
const defaultPageSize = 20
const maxPageSize = 50

type FeedCursor = {
  lastSeenAt: string
  id: string
}

function parsePageRequest(request: Request) {
  const url = new URL(request.url)
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10)
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(maxPageSize, requestedLimit))
    : defaultPageSize
  const encodedCursor = url.searchParams.get("cursor")

  if (!encodedCursor || encodedCursor.length > 1024) {
    return { cursor: null, limit }
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedCursor, "base64url").toString("utf8"),
    ) as Partial<FeedCursor>
    return {
      cursor:
        typeof parsed.lastSeenAt === "string" && typeof parsed.id === "string" && parsed.id.length > 0 && parsed.id.length <= 128
          ? { lastSeenAt: parsed.lastSeenAt, id: parsed.id }
          : null,
      limit,
    }
  } catch {
    return { cursor: null, limit }
  }
}

function encodeCursor(story: { id: string; lastUploadedAt?: string | null }) {
  if (!story.lastUploadedAt) {
    return null
  }

  return Buffer.from(
    JSON.stringify({ lastSeenAt: story.lastUploadedAt, id: story.id }),
  ).toString("base64url")
}

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
    if (url.protocol === "data:") {
      return value
    }
    url.searchParams.set("v", version)
    return url.toString()
  } catch {
    return value
  }
}

function absoluteStoryCardMedia<T extends {
  mediaUrl: string
  thumbnailUrl: string | null
  placeholderUrl?: string | null
  renditions?: {
    playback: {
      mediaUrl: string
      thumbnailUrl: string | null
      placeholderUrl?: string | null
      storageProvider?: string | null
      storageKey?: string | null
    }
    original: {
      mediaUrl: string
      thumbnailUrl: string | null
      placeholderUrl?: string | null
    } | null
  }
}>(story: T, request: Request) {
  const cloudflareUid =
    story.renditions?.playback.storageProvider === "cloudflare-stream"
      ? story.renditions.playback.storageKey
      : null
  const cloudflareThumbnailUrl =
    cloudflareUid && /^[a-f0-9]{32}$/i.test(cloudflareUid)
      ? createCloudflareStreamThumbnailMediaUrl(cloudflareUid)
      : null
  const mediaUrl =
    publicStoryMediaUrl(story.mediaUrl, request, { signed: true }) ??
    story.mediaUrl
  const thumbnailUrl = publicStoryMediaUrl(cloudflareThumbnailUrl ?? story.thumbnailUrl, request, {
    signed: true,
  })
  const placeholderUrl = publicStoryMediaUrl(cloudflareThumbnailUrl ?? story.placeholderUrl ?? null, request, {
    signed: true,
  })

  return {
    ...story,
    mediaUrl,
    thumbnailUrl,
    placeholderUrl,
    renditions: story.renditions
      ? {
          playback: {
            ...story.renditions.playback,
            mediaUrl:
              publicStoryMediaUrl(story.renditions.playback.mediaUrl, request, {
                signed: true,
              }) ?? story.renditions.playback.mediaUrl,
            thumbnailUrl: publicStoryMediaUrl(
              story.renditions.playback.thumbnailUrl,
              request,
              { signed: true },
            ),
            placeholderUrl: publicStoryMediaUrl(
              story.renditions.playback.placeholderUrl ?? null,
              request,
              { signed: true },
            ),
          },
          original: story.renditions.original
            ? {
                ...story.renditions.original,
                mediaUrl:
                  publicStoryMediaUrl(
                    story.renditions.original.mediaUrl,
                    request,
                    { signed: true },
                  ) ?? story.renditions.original.mediaUrl,
                thumbnailUrl: publicStoryMediaUrl(
                  story.renditions.original.thumbnailUrl,
                  request,
                  { signed: true },
                ),
                placeholderUrl: publicStoryMediaUrl(
                  story.renditions.original.placeholderUrl ?? null,
                  request,
                  { signed: true },
                ),
              }
            : null,
        }
      : undefined,
  }
}

function storyCardAvailable(story: {
  mediaUrl: string
  thumbnailUrl: string | null
  placeholderUrl?: string | null
  renditions?: {
    playback: {
      mediaUrl: string
      storageProvider?: string | null
    }
  }
}) {
  if (!isVercelBlobAccessDisabled()) {
    return true
  }

  if (story.renditions?.playback.storageProvider === "cloudflare-stream") {
    return true
  }

  return ![
    story.mediaUrl,
    story.thumbnailUrl,
    story.placeholderUrl,
    story.renditions?.playback.mediaUrl,
  ].some(isVercelBlobMediaReference)
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

function initialStoryStackIds(input: {
  hasActiveMyStory: boolean
  followingStories: Array<{ id: string }>
  followingTimelineStories: Array<{ id: string }>
  discoverStories: Array<{ id: string }>
}) {
  const seen = new Set<string>()
  const ids = [
    ...(input.hasActiveMyStory ? ["my-story"] : []),
    ...input.followingTimelineStories
      .slice(0, initialStoryStackLimit)
      .map((story) => story.id),
    ...input.followingStories.slice(0, 1).map((story) => story.id),
    ...input.discoverStories.slice(0, 1).map((story) => story.id),
  ]

  return ids.filter((id) => {
    if (seen.has(id)) {
      return false
    }

    seen.add(id)
    return true
  })
}

function hlsPreconnectLinks(stories: Array<{
  assetKind: string
  mediaUrl: string
}>) {
  const customerSubdomain = process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN
    ?.replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
  if (!customerSubdomain) return []

  const uids = stories
    .filter((story) => story.assetKind === "video")
    .flatMap((story) => story.mediaUrl.match(/([a-f0-9]{32})/i)?.[1] ?? [])
    .slice(0, 4)
  const links: string[] = []
  for (let i = 0; i < uids.length; i++) {
    const uid = uids[i]
    const manifest = `https://${customerSubdomain}/${uid}/manifest/video.m3u8`
    links.push(`<${manifest}>; rel=preconnect`)
    if (i === 0) links.push(`<${manifest}>; rel=preload; as=fetch; crossorigin`)
  }
  links.push(`<https://${customerSubdomain}>; rel=dns-prefetch`)
  links.push(`<https://videodelivery.net>; rel=dns-prefetch`)
  return links
}

function jsonResponse(payload: unknown, request: Request, etag: string | undefined, linkValues: string[]) {
  const headers = feedResponseHeaders(etag)
  if (linkValues.length) headers.set("Link", linkValues.join(", "))
  if (etag && matchesFeedEtag(request, etag)) return new Response(null, { status: 304, headers })
  return new Response(JSON.stringify(payload), { headers })
}

async function initialStacksWithinBudget(input: Parameters<typeof getMobileInitialStoryStacks>[0]) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // This deadline bounds the response, not database execution. Missing stacks
    // use the viewer's existing dedicated endpoint and request coalescing.
    return await Promise.race([
      getMobileInitialStoryStacks(input).catch(() => ({})),
      new Promise<Record<string, never>>(resolve => { timer = setTimeout(() => resolve({}), 750) }),
    ])
  } finally { clearTimeout(timer) }
}

async function feedResponse(
  request: Request,
) {
  const startedAt = performance.now()
  const timings: string[] = []
  const timed = async <T,>(name: string, operation: () => Promise<T>) => {
    const start = performance.now()
    try { return await operation() }
    finally { timings.push(`${name};dur=${(performance.now() - start).toFixed(1)}`) }
  }
  const finish = (response: Response) => {
    response.headers.set("Server-Timing", [...timings, `mobile-feed;dur=${(performance.now() - startedAt).toFixed(1)}`].join(", "))
    return response
  }
  const pageRequest = parsePageRequest(request)
  const user = await timed("auth", () => getCompleteMobileSession(request))

  if (!user) {
    return NextResponse.json(
      { error: "Sign in before loading stories." },
      { status: 401 },
    )
  }

  const cursorDate = pageRequest.cursor
    ? new Date(pageRequest.cursor.lastSeenAt)
    : null
  const validCursor =
    cursorDate && Number.isFinite(cursorDate.getTime())
      ? { createdAt: cursorDate, id: pageRequest.cursor!.id }
      : null
  const wantsTimelinePage = !!validCursor && new URL(request.url).searchParams.get("format") === "timeline-v1"
  if (wantsTimelinePage) {
    const rows = await timed("timeline", () => getFollowingTimelinePage(user.id, { timelineCursor: validCursor, timelineLimit: pageRequest.limit + 1 }))
    const available = rows.filter(storyCardAvailable)
    const page = available.slice(0, pageRequest.limit)
    const response = jsonResponse({
      ok: true,
      followingTimelineStories: page.map(story => absoluteStoryCardMedia(story, request)),
      nextCursor: available.length > pageRequest.limit && page.length ? encodeCursor(page[page.length - 1]) : null,
    }, request, undefined, [])
    return finish(response)
  }
  const snapshot = !validCursor ? await timed("cache", () => readFeedSnapshot(user.id).catch(() => null)) : null
  const fresh = usableFeedSnapshot(snapshot, pageRequest.limit + 1)
  if (fresh) {
    const etag = feedResponseEtag(fresh, request, user, pageRequest.limit)
    if (matchesFeedEtag(request, etag)) {
      const response = new Response(null, { status: 304, headers: feedResponseHeaders(etag) })
      return finish(response)
    }
  }
  const feed = await timed("feed", () => getFeedData(user.id, {
    preloadedSnapshot: snapshot,
    timelineCursor: validCursor,
    timelineLimit: pageRequest.limit + 1,
    useSnapshot: !validCursor,
  }))
  const followingStories = collapseStoryCardsByCreator(
    feed.followingStories
      .filter(storyCardAvailable)
      .map((story) => absoluteStoryCardMedia(story, request)),
  )
  const completeFollowingTimeline = collapseStoryCardsByCreator(
    feed.followingTimelineStories
      .filter(storyCardAvailable)
      .map((story) => absoluteStoryCardMedia(story, request)),
  )
  const hasMoreTimelineStories = completeFollowingTimeline.length > pageRequest.limit
  const followingTimelineStories = completeFollowingTimeline.slice(0, pageRequest.limit)
  const nextCursor =
    hasMoreTimelineStories && followingTimelineStories.length > 0
      ? encodeCursor(followingTimelineStories[followingTimelineStories.length - 1])
      : null
  const followedCreatorNames = new Set(
    followingStories.map((story) => story.creator.toLowerCase()),
  )
  const discoverStories = collapseStoryCardsByCreator(
    feed.discoverStories
      .filter(storyCardAvailable)
      .map((story) => absoluteStoryCardMedia(story, request)),
  ).filter((story) => !followedCreatorNames.has(story.creator.toLowerCase()))
  const initialStoryStacks = await timed("stacks", () => initialStacksWithinBudget({
    storyIds: initialStoryStackIds({
      hasActiveMyStory: feed.myStory.items.some(storyCardAvailable),
      followingStories,
      followingTimelineStories,
      discoverStories,
    }),
    viewerId: user.id,
    request,
    limit: initialStoryStackLimit,
    myStory: feed.myStory,
  }))
  const availableMyStoryItems = feed.myStory.items.filter(storyCardAvailable)
  const latestMyStoryItem =
    availableMyStoryItems.length > 0
      ? availableMyStoryItems[availableMyStoryItems.length - 1]
      : null
  const latestMyStoryThumbnailUrl = versionMediaUrl(
    isVercelBlobAccessDisabled() && latestMyStoryItem
      ? absoluteStoryCardMedia(latestMyStoryItem, request).thumbnailUrl
      : publicStoryMediaUrl(feed.myStory.latestThumbnailUrl, request, {
          signed: true,
        }),
    latestMyStoryItem?.id,
  )

  const payload = {
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
      nextCursor,
      discoverTiles: discoverStories.map((story) => ({
        id: story.id,
        assetKind: story.assetKind,
        imageUrl: story.mediaUrl,
        thumbnailUrl: story.thumbnailUrl,
        title: story.creator,
        subtitle: story.title,
      })),
      initialStoryStacks,
      suggestedAccounts: feed.suggestedAccounts.map((account) => ({
        ...account,
        imageUrl:
          publicProfileAvatarUrl(account.imageUrl, request) ??
          absoluteMediaUrl(account.imageUrl, request),
      })),
      myStory: {
        ...feed.myStory,
        hasActiveStory: availableMyStoryItems.length > 0,
        liveCount: availableMyStoryItems.length,
        latestAssetKind: latestMyStoryItem?.assetKind ?? null,
        expiresSoonLabel:
          availableMyStoryItems.length > 0
            ? feed.myStory.expiresSoonLabel
            : null,
        owner: {
          ...feed.myStory.owner,
          imageUrl:
            publicProfileAvatarUrl(feed.myStory.owner.imageUrl, request) ??
            absoluteMediaUrl(feed.myStory.owner.imageUrl, request),
        },
        latestThumbnailUrl: latestMyStoryThumbnailUrl,
        latestTextOverlays: latestMyStoryItem?.textOverlays ?? [],
        items: availableMyStoryItems.map((story) =>
          absoluteStoryCardMedia(story, request),
        ),
      },
    }
  const response = jsonResponse(
    payload,
    request,
    !validCursor ? feedResponseEtag(feed, request, user, pageRequest.limit) : undefined,
    hlsPreconnectLinks(followingTimelineStories),
  )
  return finish(response)
}

export async function GET(request: Request) {
  return feedResponse(request)
}

export async function POST(request: Request) {
  return feedResponse(request)
}
