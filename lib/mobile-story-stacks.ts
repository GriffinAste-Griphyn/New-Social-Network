import { getCreatorStats } from "@/lib/creator-stats"
import {
  isVercelBlobAccessDisabled,
  isVercelBlobMediaReference,
} from "@/lib/media-availability"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"
import {
  getMyStoryStack,
  getStoryStackForStory,
  getStoryStacksForStories,
  type MyStorySummary,
  type StoryStack,
} from "@/lib/story-store"
import {
  createCloudflareStreamPlaybackUrl,
  createCloudflareStreamThumbnailUrl,
  parseCloudflareStreamMediaPathname,
  publicStoryMediaUrl,
} from "@/lib/story-storage"
import { formatStoryPostedAt } from "@/lib/story-time"
import { renditionSelectionVersion } from "@/lib/story-media/renditions"

type MobileStoryTextOverlay = {
  id: string
  label: string
  kind?: "text" | "link" | "quote_reply"
  href?: string | null
  sourceInteractionId?: string | null
  sourceActorName?: string | null
  sourceActorHandle?: string | null
  sourceActorAvatarUrl?: string | null
  positionX: number
  positionY: number
}

type MobileStoryStackItem = Omit<
  StoryStack["items"][number],
  "mediaUrl" | "thumbnailUrl" | "textOverlays"
> & {
  mediaUrl: string
  thumbnailUrl: string | null
  placeholderUrl: string | null
  textOverlays: MobileStoryTextOverlay[]
  renditions?: {
    playback: StoryStack["items"][number]["renditions"] extends infer R
      ? R extends { playback: infer P }
        ? P
        : never
      : never
    original: StoryStack["items"][number]["renditions"] extends infer R
      ? R extends { original: infer O }
        ? O
        : never
      : never
  }
  stats?: {
    views: number
    uniqueViewers: number
    completedViews: number
    completionRate: number
    averageViewedSeconds: number
    comments: number
    replies: number
    earningsCents: number
  }
}

type MobileStoryStack = Omit<StoryStack, "items"> & {
  items: MobileStoryStackItem[]
}

type MobileStoryStackResponse = {
  ok: true
  story: MobileStoryStack
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

function storyItemAvailable(item: {
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

  if (item.renditions?.playback.storageProvider === "cloudflare-stream") {
    return true
  }

  return ![
    item.mediaUrl,
    item.thumbnailUrl,
    item.placeholderUrl,
    item.renditions?.playback.mediaUrl,
  ].some(isVercelBlobMediaReference)
}

function versionMediaUrl(value: string | null, version: string | null | undefined) {
  if (!value || !version) {
    return value
  }

  try {
    const url = new URL(value)
    if (
      url.protocol === "data:" ||
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

async function mobileStoryMediaUrl(value: string | null, request: Request) {
  const cloudflareMedia = parseCloudflareStoryMediaUrl(value, request)

  // Keep signing and authorization on our route; media segments still go directly
  // to the provider. Old builds retain their existing direct-provider URLs.
  if (value && Number(request.headers.get("x-ubeye-app-build")) >= 447 &&
      (cloudflareMedia?.kind === "playback" || /\/master(?:-[a-z0-9-]+)?\.m3u8(?:\?|$)/i.test(value))) {
    const signed = publicStoryMediaUrl(value, request, { signed: true })
    if (signed) {
      const url = new URL(signed, request.url)
      url.searchParams.set("selection", renditionSelectionVersion)
      return url.toString()
    }
  }

  if (cloudflareMedia) {
    return cloudflareMedia.kind === "thumbnail"
      ? await createCloudflareStreamThumbnailUrl(cloudflareMedia.uid)
      : await createCloudflareStreamPlaybackUrl(cloudflareMedia.uid)
  }

  return publicStoryMediaUrl(value, request, { signed: true }) ?? value
}

async function mobileStoryRenditions(
  source: StoryStack["items"][number]["renditions"],
  request: Request,
  version: string,
  fallbackMediaUrl: string,
  fallbackThumbnailUrl: string | null,
) {
  if (!source) {
    return undefined
  }

  const playbackMediaUrl =
    versionMediaUrl(
      await mobileStoryMediaUrl(source.playback.mediaUrl, request),
      version,
    ) ?? fallbackMediaUrl
  const playbackThumbnailUrl =
    versionMediaUrl(
      await mobileStoryMediaUrl(source.playback.thumbnailUrl, request),
      version,
    ) ?? fallbackThumbnailUrl
  const playbackPlaceholderUrl = versionMediaUrl(
    await mobileStoryMediaUrl(source.playback.placeholderUrl ?? null, request),
    version,
  ) ?? fallbackThumbnailUrl

  return {
    playback: {
      ...source.playback,
      mediaUrl: playbackMediaUrl,
      thumbnailUrl: playbackThumbnailUrl,
      placeholderUrl: playbackPlaceholderUrl,
    },
    original: source.original
      ? {
          ...source.original,
          mediaUrl:
            versionMediaUrl(
              await mobileStoryMediaUrl(source.original.mediaUrl, request),
              version,
            ) ?? source.original.mediaUrl,
          thumbnailUrl: versionMediaUrl(
            await mobileStoryMediaUrl(source.original.thumbnailUrl, request),
            version,
          ),
          placeholderUrl: versionMediaUrl(
            await mobileStoryMediaUrl(source.original.placeholderUrl ?? null, request),
            version,
          ),
        }
      : null,
  }
}

async function getMobileMyStoryStack(userId: string, summary?: MyStorySummary): Promise<MobileStoryStack | null> {
  const [myStory, creatorStats] = await Promise.all([
    summary ?? getMyStoryStack(userId),
    getCreatorStats(userId),
  ])
  const statsByStoryId = new Map(
    creatorStats.stories.map((story) => [story.id, story]),
  )

  const availableItems = myStory.items.filter(storyItemAvailable)

  if (availableItems.length === 0) {
    return null
  }

  return {
    id: "my-story",
    creatorId: userId,
    creator: "My Story",
    handle: `@${myStory.owner.handle}`,
    avatarUrl: myStory.owner.imageUrl,
    items: availableItems.map((item) => ({
      id: item.id,
      assetKind: item.assetKind,
      mediaUrl: item.mediaUrl,
      thumbnailUrl: item.thumbnailUrl,
      placeholderUrl: item.placeholderUrl ?? null,
      renditions: item.renditions,
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

export async function getMobileStoryStackResponse(
  storyId: string,
  viewerId: string,
  request: Request,
): Promise<MobileStoryStackResponse | null> {
  const story =
    storyId === "my-story"
      ? await getMobileMyStoryStack(viewerId)
      : await getStoryStackForStory(storyId, viewerId)

  if (!story) {
    return null
  }

  return serializeMobileStoryStack(story, request)
}

async function serializeMobileStoryStack(story: MobileStoryStack, request: Request): Promise<MobileStoryStackResponse | null> {
  const storyItems = await Promise.all(
    story.items.filter(storyItemAvailable).map(async (item) => {
      const cloudflareUid =
        item.renditions?.playback.storageProvider === "cloudflare-stream"
          ? item.renditions.playback.storageKey
          : null
      const cloudflareThumbnailUrl =
        cloudflareUid && /^[a-f0-9]{32}$/i.test(cloudflareUid)
          ? await createCloudflareStreamThumbnailUrl(cloudflareUid)
          : null
      const mediaUrl = versionMediaUrl(
        await mobileStoryMediaUrl(item.mediaUrl, request),
        item.id,
      ) ?? item.mediaUrl
      const thumbnailUrl = versionMediaUrl(
        cloudflareThumbnailUrl ??
          (await mobileStoryMediaUrl(item.thumbnailUrl, request)),
        item.id,
      )
      const placeholderUrl = versionMediaUrl(
        cloudflareThumbnailUrl ??
          (await mobileStoryMediaUrl(item.placeholderUrl, request)),
        item.id,
      )

      return {
        ...item,
        mediaUrl,
        thumbnailUrl,
        placeholderUrl,
        renditions: await mobileStoryRenditions(
          item.renditions,
          request,
          item.id,
          mediaUrl,
          thumbnailUrl,
        ),
      }
    }),
  )

  if (storyItems.length === 0) {
    return null
  }

  return {
    ok: true,
    story: {
      ...story,
      avatarUrl:
        publicProfileAvatarUrl(story.avatarUrl, request) ??
        absoluteMediaUrl(story.avatarUrl, request),
      items: storyItems,
    },
  }
}

export async function getMobileInitialStoryStacks(input: {
  storyIds: string[]
  viewerId: string
  request: Request
  limit?: number
  myStory?: MyStorySummary
}) {
  const limit = input.limit ?? 4
  const seen = new Set<string>()
  const storyIds = input.storyIds
    .filter((storyId) => storyId.length > 0)
    .filter((storyId) => {
      if (seen.has(storyId)) {
        return false
      }

      seen.add(storyId)
      return true
    })
    .slice(0, limit)

  const [stacks, ownerStack] = await Promise.all([
    getStoryStacksForStories(storyIds.filter(id => id !== "my-story"), input.viewerId),
    storyIds.includes("my-story") ? getMobileMyStoryStack(input.viewerId, input.myStory) : null,
  ])
  const entries = await Promise.all(storyIds.map(async id => {
    const stack = id === "my-story" ? ownerStack : stacks.get(id)
    if (!stack) return null
    try {
      const response = await serializeMobileStoryStack(stack, input.request)
      return response ? ([id, response] as const) : null
    } catch { return null }
  }))

  // Omit an oversized complete stack, rather than silently truncating stories.
  // The viewer falls back to its dedicated endpoint when a stack is absent.
  let bytes = 0
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, MobileStoryStackResponse] => {
    if (!entry) return false
    const size = Buffer.byteLength(JSON.stringify(entry))
    if (bytes + size > 128 * 1024) return false
    bytes += size
    return true
  }))
}
