import { useEffect, useRef, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import type { SocialAppHomeContract, SocialStoryCard } from "@new-social-network/shared"
import { Image } from "react-native"

import { MobileApiError, postMobileApi } from "@/lib/mobile-api"

export type MobileFeedResponse = SocialAppHomeContract & {
  ok: true
  suggestedAccounts: Array<{
    id: string
    name: string
    handle: string
    imageUrl: string | null
    storyStreak: string
    reason: string
    monetization: string
  }>
  myStory: {
    owner: {
      id: string
      name: string
      handle: string
      imageUrl: string | null
    }
    hasActiveStory: boolean
    liveCount: number
    latestThumbnailUrl: string | null
    latestAssetKind: "image" | "video" | null
    expiresSoonLabel: string | null
    items: SocialStoryCard[]
  }
}

export type MobileStoryApiStack = {
  id: string
  creatorId: string
  creator: string
  handle: string
  avatarUrl: string | null
  items: Array<{
    id: string
    assetKind: "image" | "video"
    mediaUrl: string
    thumbnailUrl: string | null
    title: string
    postedAt: string
    durationSeconds?: number
    captionVerticalPercent?: number
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
  }>
}

export type MobileStoryUploadResponse = {
  ok: true
  storyId: string
  asset: {
    assetKind: "image" | "video"
    mediaUrl: string
    thumbnailUrl: string | null
  }
}

type CachedMobileFeed = {
  data: MobileFeedResponse
  cachedAt: number
}

const feedCachePrefix = "nsn.mobile.feed.v3"
const memoryFeedCache = new Map<string, CachedMobileFeed>()
const inFlightFeedRequests = new Map<string, Promise<MobileFeedResponse>>()

function hashCacheKey(value: string) {
  let hash = 5381

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }

  return (hash >>> 0).toString(36)
}

function getFeedCacheKey(mobileToken: string) {
  return `${feedCachePrefix}.${hashCacheKey(mobileToken)}`
}

function parseCachedFeed(value: string | null): CachedMobileFeed | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<CachedMobileFeed>

    if (
      typeof parsed.cachedAt === "number" &&
      parsed.data &&
      parsed.data.ok === true
    ) {
      return parsed as CachedMobileFeed
    }
  } catch {
    return null
  }

  return null
}

function getCachedFeed(cacheKey: string) {
  const memoryFeed = memoryFeedCache.get(cacheKey)

  if (memoryFeed) {
    return Promise.resolve(memoryFeed)
  }

  return AsyncStorage.getItem(cacheKey).then((value) => {
    const cachedFeed = parseCachedFeed(value)

    if (cachedFeed) {
      memoryFeedCache.set(cacheKey, cachedFeed)
    }

    return cachedFeed
  })
}

function setCachedFeed(cacheKey: string, data: MobileFeedResponse) {
  const cachedFeed = {
    data,
    cachedAt: Date.now(),
  }

  memoryFeedCache.set(cacheKey, cachedFeed)
  void AsyncStorage.setItem(cacheKey, JSON.stringify(cachedFeed)).catch(() => undefined)
}

function removeCachedFeed(cacheKey: string) {
  memoryFeedCache.delete(cacheKey)
  void AsyncStorage.removeItem(cacheKey).catch(() => undefined)
}

function requestMobileFeed(mobileToken: string, cacheKey: string) {
  const existingRequest = inFlightFeedRequests.get(cacheKey)

  if (existingRequest) {
    return existingRequest
  }

  const request = postMobileApi<MobileFeedResponse>(
    "/api/mobile/feed",
    {},
    { authToken: mobileToken },
  ).finally(() => {
    inFlightFeedRequests.delete(cacheKey)
  })

  inFlightFeedRequests.set(cacheKey, request)
  return request
}

function prefetchFeedImages(feed: MobileFeedResponse) {
  const urls = [
    ...feed.discoverTiles.map((tile) => tile.thumbnailUrl ?? tile.imageUrl),
    ...feed.followingStories.map((story) => story.thumbnailUrl ?? story.mediaUrl),
    feed.myStory.latestThumbnailUrl,
    ...feed.followingProfiles.map((profile) => profile.imageUrl),
    ...feed.suggestedAccounts.map((account) => account.imageUrl),
  ]
    .filter((url): url is string => Boolean(url))
    .slice(0, 18)

  urls.forEach((url) => {
    void Image.prefetch(url).catch(() => undefined)
  })
}

export function useMobileFeed(
  mobileToken: string | null | undefined,
  refreshKey = 0,
  options?: {
    onUnauthorized?: () => void
  },
) {
  const [data, setData] = useState<MobileFeedResponse | null>(() => {
    if (!mobileToken) {
      return null
    }

    return memoryFeedCache.get(getFeedCacheKey(mobileToken))?.data ?? null
  })
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isCached, setIsCached] = useState(() => Boolean(data))
  const onUnauthorizedRef = useRef(options?.onUnauthorized)

  useEffect(() => {
    onUnauthorizedRef.current = options?.onUnauthorized
  }, [options?.onUnauthorized])

  useEffect(() => {
    let isMounted = true

    if (!mobileToken) {
      setData(null)
      setError(null)
      setIsCached(false)
      return
    }

    const cacheKey = getFeedCacheKey(mobileToken)
    const cachedFeed = memoryFeedCache.get(cacheKey)

    if (cachedFeed) {
      setData(cachedFeed.data)
      setIsCached(true)
      setError(null)
    }

    setIsLoading(!cachedFeed)
    setIsRefreshing(Boolean(cachedFeed))

    getCachedFeed(cacheKey).then((storedFeed) => {
      if (!isMounted || !storedFeed) return

      setData((currentData) => currentData ?? storedFeed.data)
      setIsCached(true)
    })

    requestMobileFeed(mobileToken, cacheKey)
      .then((payload) => {
        if (!isMounted) return
        setData(payload)
        setError(null)
        setIsCached(false)
        setCachedFeed(cacheKey, payload)
        prefetchFeedImages(payload)
      })
      .catch((errorValue) => {
        if (!isMounted) return
        if (errorValue instanceof MobileApiError && errorValue.status === 401) {
          setData(null)
          setIsCached(false)
          removeCachedFeed(cacheKey)
          onUnauthorizedRef.current?.()
        }
        setError(
          errorValue instanceof Error
            ? errorValue.message
            : "Could not load live stories.",
        )
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [mobileToken, refreshKey])

  return { data, error, isCached, isLoading, isRefreshing }
}
