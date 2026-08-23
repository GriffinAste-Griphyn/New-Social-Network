export const storyMediaContract = {
  canvas: {
    width: 1_080,
    height: 1_920,
    aspectRatio: 9 / 16,
  },
  thumbnail: {
    width: 360,
    height: 640,
  },
  upload: {
    maxImageBytes: 25 * 1024 * 1024,
    maxVideoBytes: 512 * 1024 * 1024,
    maxVideoDurationSeconds: 120,
    maxImageDisplayDerivativeBytes: 1_500_000,
    maxImageThumbnailDerivativeBytes: 150_000,
    maxImagePlaceholderBytes: 16_000,
  },
  imageEncoding: {
    displayAvifQualities: [0.65, 0.6, 0.55, 0.5],
    displayWebpQualities: [0.85, 0.8, 0.75, 0.7, 0.65],
    thumbnailWebpQualities: [0.8, 0.75, 0.7, 0.65, 0.6],
    deliveryQuality: 85,
  },
  imageInputContentTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
  ],
  videoInputContentTypes: [
    "video/mp4",
    "video/quicktime",
    "video/webm",
  ],
  imageDeliveryContentTypes: ["image/avif", "image/webp"],
} as const

export const storyMediaInputAccept = [
  ...storyMediaContract.imageInputContentTypes,
  ...storyMediaContract.videoInputContentTypes,
].join(",")

export function isSupportedStoryImageInputContentType(contentType: string) {
  return storyMediaContract.imageInputContentTypes.includes(
    contentType.toLowerCase() as (typeof storyMediaContract.imageInputContentTypes)[number],
  )
}

export function isSupportedStoryVideoInputContentType(contentType: string) {
  return storyMediaContract.videoInputContentTypes.includes(
    contentType.toLowerCase() as (typeof storyMediaContract.videoInputContentTypes)[number],
  )
}
