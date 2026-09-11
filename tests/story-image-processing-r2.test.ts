import { createHash } from "node:crypto"

import sharp from "sharp"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  headCloudflareR2Original,
  putCloudflareR2DeliveryObject,
  readCloudflareR2Original,
  removeCloudflareR2DeliveryObject,
  removeCloudflareR2Original,
} from "@/lib/cloudflare-r2"
import { createServerEncodedStoryImageAsset } from "@/lib/story-image-processing"

vi.mock("@/lib/cloudflare-r2", () => ({
  headCloudflareR2Original: vi.fn(),
  putCloudflareR2DeliveryObject: vi.fn(),
  readCloudflareR2Original: vi.fn(),
  removeCloudflareR2DeliveryObject: vi.fn(),
  removeCloudflareR2Original: vi.fn(),
}))

describe("Cloudflare R2 story image processing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("verifies a private original, publishes derivatives, and removes the source", async () => {
    const source = await sharp({
      create: {
        width: 180,
        height: 320,
        channels: 3,
        background: { r: 10, g: 40, b: 220 },
      },
    })
      .jpeg()
      .toBuffer()
    const basePathname =
      "stories/web-direct/creator_123/1234-11111111-1111-4111-8111-111111111111"
    const sourcePathname = `${basePathname}-source.jpg`
    vi.mocked(headCloudflareR2Original).mockResolvedValue({
      $metadata: {},
      ContentLength: source.byteLength,
      ContentType: "image/jpeg",
    })
    vi.mocked(readCloudflareR2Original).mockResolvedValue(
      Buffer.from(new Uint8Array(source)),
    )
    vi.mocked(putCloudflareR2DeliveryObject).mockImplementation(
      async ({ key }) => ({ key, url: `https://media.ubeye.ai/${key}` }),
    )
    vi.mocked(removeCloudflareR2Original).mockResolvedValue(undefined)
    vi.mocked(removeCloudflareR2DeliveryObject).mockResolvedValue(undefined)

    const asset = await createServerEncodedStoryImageAsset({
      basePathname,
      ownerUserId: "creator_123",
      contentMode: "fill",
      storageProvider: "cloudflare-r2",
      source: {
        pathname: sourcePathname,
        contentType: "image/jpeg",
        byteSize: source.byteLength,
        checksum: createHash("sha256").update(source).digest("hex"),
      },
    })

    expect(asset).toMatchObject({
      assetKind: "image",
      storageProvider: "cloudflare-r2",
      processingStatus: "ready",
      width: 1080,
      height: 1920,
    })
    expect(asset.mediaUrl).toMatch(/^https:\/\/media\.ubeye\.ai\/.+-display\./)
    expect(asset.thumbnailUrl).toBe(
      `https://media.ubeye.ai/${basePathname}-fit-thumb.webp`,
    )
    expect(putCloudflareR2DeliveryObject).toHaveBeenCalledTimes(2)
    expect(removeCloudflareR2Original).toHaveBeenCalledWith(sourcePathname)
  })
})
