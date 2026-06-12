import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"
import { createMobileStoryMediaUrlResolver } from "@/lib/story-media/mobile-playback"
import {
  getMyStoryStack,
  getStoryStackForStory,
  removeStoryForOwner,
} from "@/lib/story-store"
import { formatStoryPostedAt } from "@/lib/story-time"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import {
  createCloudflareStreamPlaybackUrl,
  createCloudflareStreamThumbnailUrl,
  parseCloudflareStreamMediaPathname,
  publicStoryMediaUrl,
  removeStoryAsset,
} from "@/lib/story-storage"

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
    if (
      url.hostname.endsWith("blob.vercel-storage.com") ||
      url.hostname.endsWith("cloudflarestream.com")
    ) {
      return value
    }

    url.searchParams.set("v", version)
    return url.toString()
  } catch {
    return value
  }
}

function storyItemPayload<T extends {
  originalMediaUrl?: string | null
  originalThumbnailUrl?: string | null
}>(item: T) {
  const payload = { ...item }

  delete payload.originalMediaUrl
  delete payload.originalThumbnailUrl

  return payload
}

function parseCloudflareStoryMediaUrl(value: string | null, request: Request) {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value, request.url)
    const prefix = "/api/story-media/"

    if (!url.pathname.startsWith(prefix)) {
      return null
    }

    const mediaPathname = url.pathname
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")

    return parseCloudflareStreamMediaPathname(mediaPathname)
  } catch {
    return null
  }
}

async function mobileStoryMediaUrlWithResolver(
  value: string | null,
  request: Request,
  resolver: ReturnType<typeof createMobileStoryMediaUrlResolver>,
  options: {
    assetKind?: "image" | "video" | null
    directVideoPlayback?: boolean
    processingStatus?: string | null
  } = {},
) {
  const cloudflareMedia = parseCloudflareStoryMediaUrl(value, request)

  if (cloudflareMedia) {
    return cloudflareMedia.kind === "thumbnail"
      ? await createCloudflareStreamThumbnailUrl(cloudflareMedia.uid)
      : await createCloudflareStreamPlaybackUrl(cloudflareMedia.uid)
  }

  return resolver.resolve(value, options)
}

async function mobileStoryRenditions(
  item: {
    assetKind: "image" | "video"
    mediaUrl: string
    thumbnailUrl: string | null
    originalMediaUrl?: string | null
    originalThumbnailUrl?: string | null
    processingStatus?: string | null
  },
  request: Request,
  resolver: ReturnType<typeof createMobileStoryMediaUrlResolver>,
) {
  if (item.assetKind !== "video") {
    return undefined
  }

  const [playbackMediaUrl, directMediaUrl, thumbnailUrl] = await Promise.all([
    mobileStoryMediaUrlWithResolver(item.mediaUrl, request, resolver, {
      assetKind: item.assetKind,
      directVideoPlayback: false,
      processingStatus: item.processingStatus,
    }),
    mobileStoryMediaUrlWithResolver(item.mediaUrl, request, resolver, {
      assetKind: item.assetKind,
      processingStatus: item.processingStatus,
    }),
    mobileStoryMediaUrlWithResolver(item.thumbnailUrl, request, resolver, {
      directVideoPlayback: false,
    }),
  ])
  const [originalMediaUrl, originalThumbnailUrl] = item.originalMediaUrl
    ? await Promise.all([
        mobileStoryMediaUrlWithResolver(
          item.originalMediaUrl,
          request,
          resolver,
          {
            assetKind: item.assetKind,
            processingStatus: "ready",
          },
        ),
        mobileStoryMediaUrlWithResolver(
          item.originalThumbnailUrl ?? item.thumbnailUrl,
          request,
          resolver,
          {
            directVideoPlayback: false,
          },
        ),
      ])
    : [directMediaUrl, thumbnailUrl]

  return {
    playback: {
      mediaUrl: playbackMediaUrl,
      thumbnailUrl,
    },
    original:
      originalMediaUrl && originalMediaUrl !== playbackMediaUrl
        ? {
            mediaUrl: originalMediaUrl,
            thumbnailUrl: originalThumbnailUrl,
          }
        : null,
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

  const mediaUrlResolver = createMobileStoryMediaUrlResolver(request, {
    fallbackUrl: (value) =>
      publicStoryMediaUrl(value, request, { signed: true }) ?? value,
  })
  const storyItems = await Promise.all(
    story.items.map(async (item) => {
      const itemPayload = storyItemPayload(item)
      const [mediaUrl, thumbnailUrl, renditions] = await Promise.all([
        mobileStoryMediaUrlWithResolver(item.mediaUrl, request, mediaUrlResolver, {
          assetKind: item.assetKind,
          processingStatus: item.processingStatus,
        }),
        mobileStoryMediaUrlWithResolver(
          item.thumbnailUrl,
          request,
          mediaUrlResolver,
          {
            directVideoPlayback: false,
          },
        ),
        mobileStoryRenditions(item, request, mediaUrlResolver),
      ])

      return {
        ...itemPayload,
        mediaUrl: versionMediaUrl(mediaUrl, item.id),
        thumbnailUrl: versionMediaUrl(thumbnailUrl, item.id),
        renditions: renditions
          ? {
              playback: {
                mediaUrl: versionMediaUrl(renditions.playback.mediaUrl, item.id),
                thumbnailUrl: versionMediaUrl(
                  renditions.playback.thumbnailUrl,
                  item.id,
                ),
              },
              original: renditions.original
                ? {
                    mediaUrl: versionMediaUrl(
                      renditions.original.mediaUrl,
                      item.id,
                    ),
                    thumbnailUrl: versionMediaUrl(
                      renditions.original.thumbnailUrl,
                      item.id,
                    ),
                  }
                : null,
            }
          : undefined,
      }
    }),
  )

  return NextResponse.json({
    ok: true,
    story: {
      ...story,
      avatarUrl:
        publicProfileAvatarUrl(story.avatarUrl, request) ??
        absoluteMediaUrl(story.avatarUrl, request),
      items: storyItems,
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
    const removedStory = await removeStoryForOwner(id, session.id)
    const mediaUrls = Array.from(
      new Set(
        [
          removedStory.mediaUrl,
          removedStory.thumbnailUrl,
          removedStory.originalMediaUrl,
          removedStory.originalThumbnailUrl,
        ].filter((value): value is string => Boolean(value)),
      ),
    )

    await Promise.allSettled(mediaUrls.map((mediaUrl) => removeStoryAsset(mediaUrl)))

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
      originalMediaUrl: item.originalMediaUrl,
      originalThumbnailUrl: item.originalThumbnailUrl,
      processingStatus: item.processingStatus,
      title: item.textOverlays?.[0]?.label.trim() || item.caption.trim(),
      postedAt: formatStoryPostedAt(new Date(item.createdAt)),
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
