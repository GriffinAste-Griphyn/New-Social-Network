import { useEffect, useRef, useState } from "react"
import type { SocialAppHomeContract, SocialStoryCard } from "@ubeye/shared"

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
    latestTextOverlays?: Array<{
      id: string
      label: string
      positionX: number
      positionY: number
    }>
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
    textOverlays?: Array<{
      id: string
      label: string
      positionX: number
      positionY: number
    }>
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

export function useMobileFeed(
  mobileToken: string | null | undefined,
  refreshKey = 0,
  options?: {
    onUnauthorized?: () => void
  },
) {
  const [data, setData] = useState<MobileFeedResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const onUnauthorizedRef = useRef(options?.onUnauthorized)

  useEffect(() => {
    onUnauthorizedRef.current = options?.onUnauthorized
  }, [options?.onUnauthorized])

  useEffect(() => {
    let isMounted = true

    if (!mobileToken) {
      setData(null)
      return
    }

    setIsLoading(true)

    postMobileApi<MobileFeedResponse>(
      "/api/mobile/feed",
      {},
      { authToken: mobileToken },
    )
      .then((payload) => {
        if (!isMounted) return
        setData(payload)
        setError(null)
      })
      .catch((errorValue) => {
        if (!isMounted) return
        setData(null)
        if (errorValue instanceof MobileApiError && errorValue.status === 401) {
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
        }
      })

    return () => {
      isMounted = false
    }
  }, [mobileToken, refreshKey])

  return { data, error, isLoading }
}
