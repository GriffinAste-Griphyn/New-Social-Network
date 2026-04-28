import { useEffect, useState } from "react"
import type { SocialAppHomeContract, SocialStoryCard } from "@new-social-network/shared"

import { postMobileApi } from "@/lib/mobile-api"

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
) {
  const [data, setData] = useState<MobileFeedResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

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
