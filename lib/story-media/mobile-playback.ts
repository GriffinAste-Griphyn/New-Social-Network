import { publicStoryMediaUrl } from "@/lib/story-media/access"

type StoryAssetKind = "image" | "video"

type MobileStoryMediaUrlOptions = {
  assetKind?: StoryAssetKind | null
  directVideoPlayback?: boolean
  processingStatus?: string | null
}

export const mobileStoryVideoPlaybackSignedUrlTtlMs = 24 * 60 * 60 * 1000

export function createMobileStoryMediaUrlResolver(
  request: Request,
  options: {
    fallbackUrl?: (value: string | null) => string | null
    signedUrlTtlMs?: number
  } = {},
) {
  return {
    async resolve(
      value: string | null,
      _mediaOptions: MobileStoryMediaUrlOptions = {},
    ) {
      void _mediaOptions

      return (
        options.fallbackUrl?.(value) ??
        publicStoryMediaUrl(value, request, { signed: true }) ??
        value
      )
    },
  }
}
