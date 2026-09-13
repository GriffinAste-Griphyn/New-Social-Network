import { describe, expect, it } from "vitest"
import sharp from "sharp"

import {
  createImageProcessingStoredAsset,
  createStoryCanvasImage,
  storyImageDisplayDimensions,
  storyImageResizeOptions,
  storyImageThumbnailResizeOptions,
} from "@/lib/story-image-processing"

describe("story image processing", () => {
  it("preserves the original storage provider for queued R2 work", () => {
    const source = {
      pathname: "stories/web-direct/creator/source.jpg",
      contentType: "image/jpeg",
      byteSize: 2_048,
      checksum: "a".repeat(64),
    }

    expect(
      createImageProcessingStoredAsset({
        storageProvider: "cloudflare-r2",
        source,
        width: 1_200,
        height: 2_000,
      }),
    ).toMatchObject({
      storageProvider: "cloudflare-r2",
      originalStorageProvider: "cloudflare-r2",
      originalStorageKey: source.pathname,
      processingStatus: "processing",
    })
  })

  it("reports display-oriented dimensions for camera JPEG metadata", async () => {
    const source = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 220, g: 30, b: 30 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    await expect(storyImageDisplayDimensions(source)).resolves.toEqual({
      width: 800,
      height: 1200,
    })
  })

  it("centers transparent letterboxing for fit images", async () => {
    expect(storyImageResizeOptions("fit")).toMatchObject({
      fit: "contain",
      position: "centre",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })

    const source = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 220, g: 30, b: 30 },
      },
    })
      .png()
      .toBuffer()
    const { data, info } = await sharp(source)
      .resize(360, 640, storyImageResizeOptions("fit"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels
      return Array.from(data.subarray(offset, offset + 4))
    }

    expect(pixel(180, 20)).toEqual([0, 0, 0, 0])
    expect(pixel(180, 320)).toEqual([220, 30, 30, 255])
    expect(pixel(180, 620)).toEqual([0, 0, 0, 0])
  })

  it("fills playback canvases edge to edge without synthetic background bands", async () => {
    const source = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 220, g: 30, b: 30 },
      },
    })
      .png()
      .toBuffer()
    const { data, info } = await (await createStoryCanvasImage(source, "fill"))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels
      return Array.from(data.subarray(offset, offset + 3))
    }

    expect(info).toMatchObject({ width: 1080, height: 1920, channels: 3 })
    expect(pixel(540, 20)).toEqual([220, 30, 30])
    expect(pixel(540, 960)).toEqual([220, 30, 30])
    expect(pixel(540, 1900)).toEqual([220, 30, 30])
  })

  it("preserves the whole photo with centered black padding by default", async () => {
    const source = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 220, g: 30, b: 30 } } }).png().toBuffer()
    const { data, info } = await (await createStoryCanvasImage(source)).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3))
    expect(info).toMatchObject({ width: 1080, height: 1920, channels: 3 })
    expect(pixel(540, 20)).toEqual([0, 0, 0])
    expect(pixel(540, 960)).toEqual([220, 30, 30])
    expect(pixel(540, 1900)).toEqual([0, 0, 0])
    expect(pixel(5, 960)).toEqual([220, 30, 30])
    expect(pixel(1075, 960)).toEqual([220, 30, 30])
  })

  it("does not add an alpha channel to opaque production AVIF output", async () => {
    const source = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 220, g: 30, b: 30 },
      },
    })
      .png()
      .toBuffer()
    const encoded = await (await createStoryCanvasImage(source))
      .avif({ quality: 85, effort: 6, chromaSubsampling: "4:2:0", bitdepth: 8 })
      .toBuffer()
    const info = await sharp(encoded).metadata()
    expect(info).toMatchObject({ width: 1080, height: 1920, hasAlpha: false })
  })

  it("preserves alpha when the source actually contains transparency", async () => {
    const source = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 220, g: 30, b: 30, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer()
    const rendered = await (await createStoryCanvasImage(source)).png().toBuffer()
    const info = await sharp(rendered).metadata()

    expect(info).toMatchObject({ width: 1080, height: 1920, hasAlpha: true })
  })

  it("fills thumbnails edge to edge", async () => {
    expect(storyImageThumbnailResizeOptions()).toMatchObject({
      fit: "cover",
      position: "centre",
    })

    const source = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 220, g: 30, b: 30 },
      },
    })
      .png()
      .toBuffer()
    const { data, info } = await sharp(source)
      .resize(360, 640, storyImageThumbnailResizeOptions())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const topCenterOffset = 180 * info.channels
    const centerOffset = (320 * info.width + 180) * info.channels

    expect(Array.from(data.subarray(topCenterOffset, topCenterOffset + 3))).toEqual([220, 30, 30])
    expect(Array.from(data.subarray(centerOffset, centerOffset + 3))).toEqual([220, 30, 30])
  })
})
