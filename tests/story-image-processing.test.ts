import { describe, expect, it } from "vitest"
import sharp from "sharp"

import {
  createStoryCanvasImage,
  storyImageDisplayDimensions,
  storyImageResizeOptions,
  storyImageThumbnailResizeOptions,
} from "@/lib/story-image-processing"

describe("story image processing", () => {
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

  it("uses transparent letterboxing for fit images", async () => {
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
  })

  it("builds playback canvases without a blurred or cover-cropped layer", async () => {
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
    const { data, info } = await (await createStoryCanvasImage(source))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels
      return Array.from(data.subarray(offset, offset + 4))
    }

    expect(info).toMatchObject({ width: 1080, height: 1920, channels: 4 })
    expect(pixel(540, 20)).toEqual([0, 0, 0, 0])
    expect(pixel(540, 960)).toEqual([220, 30, 30, 255])
  })

  it("preserves transparent letterboxing through the production AVIF encoding", async () => {
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
    const { data, info } = await sharp(encoded)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const alpha = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3]

    expect(info).toMatchObject({ width: 1080, height: 1920, channels: 4 })
    expect(alpha(540, 20)).toBe(0)
    expect(alpha(540, 960)).toBe(255)
  })

  it("always cover-crops thumbnails even when story playback is fit", async () => {
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

    expect(Array.from(data.subarray(topCenterOffset, topCenterOffset + 3))).toEqual([
      220, 30, 30,
    ])
  })
})
