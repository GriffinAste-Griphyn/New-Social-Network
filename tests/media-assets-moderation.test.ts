import { beforeEach, describe, expect, it, vi } from "vitest"

import { getDb } from "@/lib/db"
import { applyMediaModerationResult } from "@/lib/media-assets"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))

describe("media moderation state separation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not overwrite provider or transcode fields when moderation approves", async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn((fields: Record<string, unknown>) => ({ where, fields }))
    const update = vi.fn(() => ({ set }))
    const values = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn(() => ({ values }))
    vi.mocked(getDb).mockReturnValue({ update, insert } as never)

    await applyMediaModerationResult({
      mediaAssetId: "media_123",
      actorUserId: "creator_123",
      result: {
        action: "approve",
        provider: "openai",
        reason: null,
        categories: [],
        rawResult: null,
        error: null,
      },
    })

    expect(set).toHaveBeenCalledTimes(1)
    const updateFields = set.mock.calls[0][0]

    expect(updateFields).toMatchObject({
      scanStatus: "passed",
      scanReason: null,
    })
    expect(updateFields).not.toHaveProperty("processingStatus")
    expect(updateFields).not.toHaveProperty("providerStatus")
    expect(updateFields).not.toHaveProperty("providerPctComplete")
    expect(updateFields).not.toHaveProperty("providerError")
    expect(updateFields).not.toHaveProperty("lastCheckedAt")
    expect(updateFields).not.toHaveProperty("readyAt")
  })
})
