import { describe, expect, it, vi } from "vitest"

import { highestQualityImageWithinBudget } from "@/lib/story-image-encoding"

describe("story image quality selection", () => {
  it("selects the highest configured quality that fits the byte budget", async () => {
    const encode = vi.fn(async (quality: number) => ({
      quality,
      size: quality === 0.85 ? 1_700_000 : 1_400_000,
    }))

    await expect(
      highestQualityImageWithinBudget({
        qualities: [0.85, 0.8, 0.75],
        maxByteSize: 1_500_000,
        encode,
      }),
    ).resolves.toEqual({ quality: 0.8, size: 1_400_000 })
    expect(encode).toHaveBeenCalledTimes(2)
    expect(encode).toHaveBeenNthCalledWith(1, 0.85)
    expect(encode).toHaveBeenNthCalledWith(2, 0.8)
  })

  it("treats the configured byte budget as inclusive", async () => {
    await expect(
      highestQualityImageWithinBudget({
        qualities: [0.8],
        maxByteSize: 150_000,
        encode: async () => ({ size: 150_000 }),
      }),
    ).resolves.toEqual({ size: 150_000 })
  })

  it("stops cleanly when the requested browser codec is unsupported", async () => {
    const encode = vi.fn(async () => null)

    await expect(
      highestQualityImageWithinBudget({
        qualities: [0.65, 0.6, 0.55],
        maxByteSize: 1_500_000,
        encode,
      }),
    ).resolves.toBeNull()
    expect(encode).toHaveBeenCalledTimes(1)
  })
})
