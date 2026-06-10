import {
  issueSignedToken,
  presignUrl,
  type IssuedSignedToken,
} from "@vercel/blob"

import {
  getPrivateVercelBlobPathname,
  publicStoryMediaUrl,
} from "@/lib/story-media/access"

type StoryAssetKind = "image" | "video"

type MobileStoryMediaUrlOptions = {
  assetKind?: StoryAssetKind | null
  directVideoPlayback?: boolean
  processingStatus?: string | null
}

export const mobileStoryVideoPlaybackSignedUrlTtlMs = 24 * 60 * 60 * 1000

const directPlaybackVideoExtensions = new Set(["m4v", "mov", "mp4"])

function isDirectPlaybackVideoPathname(pathname: string) {
  const extension = pathname.split(".").pop()?.toLowerCase()

  return Boolean(extension && directPlaybackVideoExtensions.has(extension))
}

function isReadyForPlayback(processingStatus: string | null | undefined) {
  return !processingStatus || processingStatus === "ready"
}

export function createMobileStoryMediaUrlResolver(
  request: Request,
  options: {
    fallbackUrl?: (value: string | null) => string | null
    signedUrlTtlMs?: number
  } = {},
) {
  const validUntil =
    Date.now() +
    (options.signedUrlTtlMs ?? mobileStoryVideoPlaybackSignedUrlTtlMs)
  let signedTokenPromise: Promise<IssuedSignedToken> | null = null

  async function signedBlobVideoPlaybackUrl(
    value: string | null,
    mediaOptions: MobileStoryMediaUrlOptions,
  ) {
    if (
      !value ||
      mediaOptions.assetKind !== "video" ||
      mediaOptions.directVideoPlayback === false ||
      !isReadyForPlayback(mediaOptions.processingStatus)
    ) {
      return null
    }

    const pathname = getPrivateVercelBlobPathname(value)

    if (!pathname || !isDirectPlaybackVideoPathname(pathname)) {
      return null
    }

    try {
      signedTokenPromise ??= issueSignedToken({
        pathname: "*",
        operations: ["get"],
        validUntil,
      })
      const signedToken = await signedTokenPromise
      const { presignedUrl } = await presignUrl(signedToken, {
        access: "private",
        operation: "get",
        pathname,
        validUntil,
      })

      return presignedUrl
    } catch (error) {
      console.error("Could not create direct story video playback URL.", {
        pathname,
        error,
      })
      return null
    }
  }

  return {
    async resolve(
      value: string | null,
      mediaOptions: MobileStoryMediaUrlOptions = {},
    ) {
      return (
        (await signedBlobVideoPlaybackUrl(value, mediaOptions)) ??
        options.fallbackUrl?.(value) ??
        publicStoryMediaUrl(value, request, { signed: true }) ??
        value
      )
    },
  }
}
