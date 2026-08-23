import { afterEach, describe, expect, it } from "vitest"

import { isCloudflareStreamFullyReady } from "@/lib/media-upload-sessions"
import { getMobileMediaConfig } from "@/lib/mobile-media-config"
import {
  isSupportedStoryImageInputContentType,
  isSupportedStoryVideoInputContentType,
  storyMediaContract,
} from "@/lib/story-media-contract"
import {
  buildCloudflareThumbnailUrl,
  cloudflareStreamThumbnailTimestampPct,
  directStoryImageDisplayPathname,
  directStoryImageThumbnailPathname,
  normalizeStoryImageThumbHash,
} from "@/lib/story-storage"

const originalAggressiveConfig = process.env.MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED

afterEach(() => {
  if (originalAggressiveConfig === undefined) {
    delete process.env.MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED
  } else {
    process.env.MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED = originalAggressiveConfig
  }
})

describe("aggressive media pipeline contract", () => {
  it("uses one canonical story canvas and upload envelope", () => {
    expect(storyMediaContract.canvas).toEqual({
      width: 1080,
      height: 1920,
      aspectRatio: 9 / 16,
    })
    expect(storyMediaContract.thumbnail).toEqual({ width: 360, height: 640 })
    expect(storyMediaContract.upload.maxImageBytes).toBe(25 * 1024 * 1024)
    expect(storyMediaContract.upload.maxImageDisplayDerivativeBytes).toBe(
      1_500_000,
    )
    expect(storyMediaContract.upload.maxImageThumbnailDerivativeBytes).toBe(
      150_000,
    )
    expect(storyMediaContract.upload.maxVideoBytes).toBe(512 * 1024 * 1024)
    expect(storyMediaContract.upload.maxVideoDurationSeconds).toBe(120)
    expect(storyMediaContract.canvas.width / storyMediaContract.canvas.height).toBe(
      storyMediaContract.canvas.aspectRatio,
    )
  })

  it("uses a descending high-fidelity image quality ladder", () => {
    expect(storyMediaContract.imageEncoding).toEqual({
      displayAvifQualities: [0.65, 0.6, 0.55, 0.5],
      displayWebpQualities: [0.85, 0.8, 0.75, 0.7, 0.65],
      thumbnailWebpQualities: [0.8, 0.75, 0.7, 0.65, 0.6],
      deliveryQuality: 85,
    })
    expect(
      storyMediaContract.imageEncoding.displayAvifQualities,
    ).toEqual(
      [...storyMediaContract.imageEncoding.displayAvifQualities].sort(
        (left, right) => right - left,
      ),
    )
    expect(
      storyMediaContract.imageEncoding.displayWebpQualities,
    ).toEqual(
      [...storyMediaContract.imageEncoding.displayWebpQualities].sort(
        (left, right) => right - left,
      ),
    )
  })

  it("accepts only the documented source media types", () => {
    expect(isSupportedStoryImageInputContentType("image/jpeg")).toBe(true)
    expect(isSupportedStoryImageInputContentType("IMAGE/WEBP")).toBe(true)
    expect(isSupportedStoryImageInputContentType("image/gif")).toBe(false)
    expect(isSupportedStoryVideoInputContentType("video/mp4")).toBe(true)
    expect(isSupportedStoryVideoInputContentType("video/quicktime")).toBe(true)
    expect(isSupportedStoryVideoInputContentType("VIDEO/WEBM")).toBe(true)
    expect(isSupportedStoryVideoInputContentType("video/x-msvideo")).toBe(false)
  })

  it("uses only AVIF/WebP derivative pathnames", () => {
    const base = "stories/web-direct/user/upload"
    expect(directStoryImageDisplayPathname(base)).toBe(`${base}-display.avif`)
    expect(directStoryImageDisplayPathname(base, "image/webp")).toBe(
      `${base}-display.webp`,
    )
    expect(directStoryImageThumbnailPathname(base)).toBe(`${base}-thumb.webp`)
  })

  it("uses the playback start frame for every Stream loading poster", () => {
    const thumbnailUrl = new URL(
      buildCloudflareThumbnailUrl(
        "customer.example.com",
        "signed-playback-token",
      ),
    )

    expect(cloudflareStreamThumbnailTimestampPct).toBe(0)
    expect(thumbnailUrl.pathname).toBe(
      "/signed-playback-token/thumbnails/thumbnail.jpg",
    )
    expect(thumbnailUrl.searchParams.get("time")).toBe("0s")
    expect(thumbnailUrl.searchParams.get("width")).toBe("1080")
    expect(thumbnailUrl.searchParams.get("height")).toBe("1920")
    expect(thumbnailUrl.searchParams.get("fit")).toBe("clip")
  })

  it("accepts compact URL-safe ThumbHashes and rejects oversized input", () => {
    const hash = Buffer.alloc(25, 7).toString("base64url")
    expect(normalizeStoryImageThumbHash(hash)).toBe(hash)
    expect(normalizeStoryImageThumbHash("x".repeat(81))).toBeNull()
  })

  it("publishes Stream video at 95 percent and treats provider errors as terminal", () => {
    expect(
      isCloudflareStreamFullyReady({
        readyToStream: true,
        state: "inprogress",
        pctComplete: 95,
      }),
    ).toBe(true)
    expect(
      isCloudflareStreamFullyReady({
        readyToStream: true,
        state: "error",
        pctComplete: 100,
      }),
    ).toBe(false)
  })

  it("ships the current aggressive preheat and startup defaults", () => {
    delete process.env.MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED
    const config = getMobileMediaConfig({ clientBuild: 320 })

    expect(config.persistentVideoPreheatLimit).toEqual({ constrained: 2, standard: 4 })
    expect(config.preparedPlayerLimit).toEqual({ constrained: 1, standard: 4 })
    expect(config.stackPreheatLimit).toEqual({ constrained: 2, standard: 4 })
    expect(config.imagePreheatLimit).toEqual({ constrained: 2, standard: 4 })
    expect(config.startupStreamingPeakBitRate).toEqual({
      constrained: 2_000_000,
      standard: 3_000_000,
    })
    expect(config.startupStreamingMaximumResolution).toEqual({
      constrained: { width: 540, height: 960 },
      standard: { width: 720, height: 1280 },
    })
    expect(config.offlineHLSPreheatLimit).toEqual({ constrained: 0, standard: 1 })
    expect(config.offlineHLSCacheMaxAssets).toBe(2)
  })
})
