import { beforeEach, describe, expect, it, vi } from "vitest"

import { getDb } from "@/lib/db"
import { recordCloudflareStreamUploadStatus } from "@/lib/media-upload-sessions"
import { enqueueStoryPublication } from "@/lib/story-publication"
import {
  createCloudflareStreamThumbnailMediaUrl,
  setCloudflareStreamThumbnailAtDefaultTime,
} from "@/lib/story-storage"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
vi.mock("@/lib/media-upload-sessions", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/media-upload-sessions")>(
      "@/lib/media-upload-sessions",
    )

  return { ...actual, recordCloudflareStreamUploadStatus: vi.fn() }
})
vi.mock("@/lib/story-publication", () => ({
  enqueueStoryPublication: vi.fn(),
}))
vi.mock("@/lib/story-storage", () => ({
  createCloudflareStreamThumbnailMediaUrl: vi.fn(),
  getCloudflareStreamVideoDetails: vi.fn(),
  setCloudflareStreamThumbnailAtDefaultTime: vi.fn(),
}))

describe("Cloudflare upload reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retains a provider webhook on the upload session before a story exists", async () => {
    const limit = vi.fn().mockResolvedValue([])
    const storyQuery = {
      innerJoin: vi.fn(),
      where: vi.fn(() => ({ limit })),
    }
    storyQuery.innerJoin.mockImplementation(() => storyQuery)
    const select = vi.fn(() => ({
      from: vi.fn(() => storyQuery),
    }))
    vi.mocked(getDb).mockReturnValue({ select } as never)
    vi.mocked(recordCloudflareStreamUploadStatus).mockResolvedValue({
      id: "upload-early-webhook",
    } as never)
    const details = {
      readyToStream: true,
      state: "ready",
      pctComplete: 100,
      errorReason: null,
      byteSize: 123_456,
      durationMs: 7_200,
      width: 1080,
      height: 1920,
    }
    const { syncCloudflareStreamStoryStatus } = await import(
      "@/lib/stories/cloudflare-status"
    )

    const result = await syncCloudflareStreamStoryStatus({
      uid: "11111111111111111111111111111111",
      details,
    })

    expect(recordCloudflareStreamUploadStatus).toHaveBeenCalledWith({
      uid: "11111111111111111111111111111111",
      details,
    })
    expect(result).toEqual({
      status: "retained",
      storyId: null,
      uploadSessionId: "upload-early-webhook",
    })
    expect(
      vi.mocked(recordCloudflareStreamUploadStatus).mock.invocationCallOrder[0],
    ).toBeLessThan(select.mock.invocationCallOrder[0])
  })

  it("does not republish or notify when the observed story state changed concurrently", async () => {
    const story = {
      id: "story_123",
      creatorId: "creator_123",
      creatorName: "Creator",
      mediaAssetId: "media_123",
      storageKey: "11111111111111111111111111111111",
      thumbnailUrl: null,
      caption: "Concurrent state test",
      durationMs: 7_200,
      byteSize: 123_456,
      width: 1080,
      height: 1920,
      expiresAt: new Date(Date.now() + 60_000),
      status: "processing" as const,
      processingStatus: "processing",
      moderationStatus: "approved",
      assetProcessingStatus: "processing" as const,
      previousProviderPctComplete: 75,
    }
    const limit = vi.fn().mockResolvedValue([story])
    const storyQuery = {
      innerJoin: vi.fn(),
      where: vi.fn(() => ({ limit })),
    }
    storyQuery.innerJoin.mockImplementation(() => storyQuery)
    const select = vi.fn(() => ({
      from: vi.fn(() => storyQuery),
    }))
    const storyReturning = vi.fn().mockResolvedValue([])
    const storyWhere = vi.fn(() => ({ returning: storyReturning }))
    const storySet = vi.fn(() => ({ where: storyWhere }))
    const update = vi.fn().mockReturnValue({ set: storySet })
    vi.mocked(getDb).mockReturnValue({ select, update } as never)
    vi.mocked(recordCloudflareStreamUploadStatus).mockResolvedValue(null)
    vi.mocked(createCloudflareStreamThumbnailMediaUrl).mockReturnValue(
      "/api/story-media/cloudflare-stream/11111111111111111111111111111111/thumbnails/thumbnail.jpg",
    )
    vi.mocked(setCloudflareStreamThumbnailAtDefaultTime).mockResolvedValue(
      undefined,
    )
    const details = {
      readyToStream: true,
      state: "ready",
      pctComplete: 100,
      errorReason: null,
      byteSize: 123_456,
      durationMs: 7_200,
      width: 1080,
      height: 1920,
    }
    const { syncCloudflareStreamStoryStatus } = await import(
      "@/lib/stories/cloudflare-status"
    )

    const result = await syncCloudflareStreamStoryStatus({
      uid: story.storageKey,
      details,
    })

    expect(result).toEqual({ status: "stale", storyId: story.id })
    expect(storyReturning).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(enqueueStoryPublication).not.toHaveBeenCalled()
  })

  it("enqueues durable publication only after the ready transition commits", async () => {
    const story = {
      id: "story_ready",
      mediaAssetId: "media_ready",
      storageKey: "22222222222222222222222222222222",
      thumbnailUrl: null,
      durationMs: 7_200,
      byteSize: 123_456,
      width: 1080,
      height: 1920,
      expiresAt: new Date(Date.now() + 60_000),
      status: "processing" as const,
      processingStatus: "processing",
      moderationStatus: "approved",
      assetProcessingStatus: "processing" as const,
      assetScanStatus: "passed",
      previousProviderPctComplete: 75,
    }
    const limit = vi.fn().mockResolvedValue([story])
    const storyQuery = {
      innerJoin: vi.fn(),
      where: vi.fn(() => ({ limit })),
    }
    storyQuery.innerJoin.mockImplementation(() => storyQuery)
    const select = vi.fn(() => ({ from: vi.fn(() => storyQuery) }))
    const storyReturning = vi.fn().mockResolvedValue([{ id: story.id }])
    const storyWhere = vi.fn(() => ({ returning: storyReturning }))
    const mediaWhere = vi.fn().mockResolvedValue(undefined)
    const update = vi
      .fn()
      .mockReturnValueOnce({ set: vi.fn(() => ({ where: storyWhere })) })
      .mockReturnValueOnce({ set: vi.fn(() => ({ where: mediaWhere })) })
    vi.mocked(getDb).mockReturnValue({ select, update } as never)
    vi.mocked(recordCloudflareStreamUploadStatus).mockResolvedValue(null)
    vi.mocked(createCloudflareStreamThumbnailMediaUrl).mockReturnValue(
      "/api/story-media/cloudflare-stream/22222222222222222222222222222222/thumbnails/thumbnail.jpg",
    )
    vi.mocked(setCloudflareStreamThumbnailAtDefaultTime).mockResolvedValue(
      undefined,
    )
    vi.mocked(enqueueStoryPublication).mockResolvedValue("run_ready")
    const { syncCloudflareStreamStoryStatus } = await import(
      "@/lib/stories/cloudflare-status"
    )

    const result = await syncCloudflareStreamStoryStatus({
      uid: story.storageKey,
      details: {
        readyToStream: true,
        state: "ready",
        pctComplete: 100,
        errorReason: null,
        byteSize: 123_456,
        durationMs: 7_200,
        width: 1080,
        height: 1920,
      },
    })

    expect(result).toEqual({
      status: "live",
      processingStatus: "ready",
      storyId: story.id,
    })
    expect(enqueueStoryPublication).toHaveBeenCalledWith(story.id)
  })
})
