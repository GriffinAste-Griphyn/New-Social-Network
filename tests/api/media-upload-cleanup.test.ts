import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  deleteMediaUploadSessionForCleanup,
  getMediaUploadSessionsForCleanup,
} from "@/lib/media-upload-sessions"
import type { MediaUploadSessionCleanupCandidate } from "@/lib/media-upload-sessions"
import {
  getExpiredStoryMediaForCleanup,
  markExpiredStoryMediaDeleted,
  removeExpiredStoryMediaFromStorage,
} from "@/lib/expired-story-media"
import type { ExpiredStoryMediaCleanupCandidate } from "@/lib/expired-story-media"
import {
  removeCloudflareStreamVideoByUid,
  removeDirectBlobStoryVideoPoster,
} from "@/lib/story-storage"

vi.mock("@/lib/media-upload-sessions", () => ({
  deleteMediaUploadSessionForCleanup: vi.fn(),
  getMediaUploadSessionsForCleanup: vi.fn(),
}))

vi.mock("@/lib/expired-story-media", () => ({
  getExpiredStoryMediaForCleanup: vi.fn(),
  markExpiredStoryMediaDeleted: vi.fn(),
  removeExpiredStoryMediaFromStorage: vi.fn(),
}))

vi.mock("@/lib/story-storage", () => ({
  removeCloudflareStreamVideoByUid: vi.fn(),
  removeDirectBlobStoryVideoPoster: vi.fn(),
}))

const originalEnv = { ...process.env }

describe("media upload cleanup cron", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    vi.mocked(deleteMediaUploadSessionForCleanup).mockResolvedValue(true)
    vi.mocked(getExpiredStoryMediaForCleanup).mockResolvedValue([])
    vi.mocked(markExpiredStoryMediaDeleted).mockResolvedValue(true)
    vi.mocked(removeExpiredStoryMediaFromStorage).mockResolvedValue(undefined)
    vi.mocked(removeCloudflareStreamVideoByUid).mockResolvedValue(undefined)
    vi.mocked(removeDirectBlobStoryVideoPoster).mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("rejects requests without the Vercel cron bearer token", async () => {
    const { GET } = await import("@/app/api/cron/media-upload-cleanup/route")
    const response = await GET(
      new Request("https://app.example.com/api/cron/media-upload-cleanup"),
    )

    expect(response.status).toBe(401)
    expect(getMediaUploadSessionsForCleanup).not.toHaveBeenCalled()
    expect(getExpiredStoryMediaForCleanup).not.toHaveBeenCalled()
  })

  it("removes expired story media while preserving the upload-session result", async () => {
    const expiredMedia = {
      id: "expired-media",
      storageProvider: "vercel-blob",
      storageKey: "stories/expired.jpg",
      mediaUrl: "/api/story-media/stories/expired.jpg",
      thumbnailUrl: null,
      placeholderUrl: null,
      originalMediaUrl: null,
      originalThumbnailUrl: null,
      byteSize: 750_000,
      originalByteSize: 250_000,
      durationMs: 60_000,
    } satisfies ExpiredStoryMediaCleanupCandidate
    vi.mocked(getMediaUploadSessionsForCleanup).mockResolvedValue([])
    vi.mocked(getExpiredStoryMediaForCleanup).mockResolvedValue([expiredMedia])

    const { GET } = await import("@/app/api/cron/media-upload-cleanup/route")
    const response = await GET(
      new Request("https://app.example.com/api/cron/media-upload-cleanup", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      expiredMedia: {
        scanned: 1,
        deleted: 1,
        failed: 0,
        bytesReclaimed: 1_000_000,
        videoMinutesReclaimed: 1,
      },
    })
    expect(removeExpiredStoryMediaFromStorage).toHaveBeenCalledWith(expiredMedia)
    expect(markExpiredStoryMediaDeleted).toHaveBeenCalledWith(expiredMedia)
  })

  it("removes abandoned provider uploads and retains completed media", async () => {
    const prepared = {
      id: "upload-prepared",
      status: "prepared",
      storageProvider: "cloudflare-stream",
      storageKey: "1".repeat(32),
    } satisfies MediaUploadSessionCleanupCandidate
    const completed = {
      id: "upload-completed",
      status: "completed",
      storageProvider: "cloudflare-stream",
      storageKey: "2".repeat(32),
    } satisfies MediaUploadSessionCleanupCandidate
    vi.mocked(getMediaUploadSessionsForCleanup).mockResolvedValue([
      prepared,
      completed,
    ])

    const { GET } = await import("@/app/api/cron/media-upload-cleanup/route")
    const response = await GET(
      new Request("https://app.example.com/api/cron/media-upload-cleanup", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scanned: 2,
      deleted: 2,
      failed: 0,
    })
    expect(removeCloudflareStreamVideoByUid).toHaveBeenCalledTimes(1)
    expect(removeCloudflareStreamVideoByUid).toHaveBeenCalledWith(
      prepared.storageKey,
    )
    expect(removeDirectBlobStoryVideoPoster).toHaveBeenCalledTimes(1)
    expect(removeDirectBlobStoryVideoPoster).toHaveBeenCalledWith(
      prepared.storageKey,
    )
    expect(deleteMediaUploadSessionForCleanup).toHaveBeenCalledWith(prepared)
    expect(deleteMediaUploadSessionForCleanup).toHaveBeenCalledWith(completed)
  })

  it("reports provider cleanup failures to the cron scheduler", async () => {
    vi.mocked(getMediaUploadSessionsForCleanup).mockResolvedValue([
      {
        id: "upload-failed",
        status: "prepared",
        storageProvider: "cloudflare-stream",
        storageKey: "3".repeat(32),
      },
    ])
    vi.mocked(removeCloudflareStreamVideoByUid).mockRejectedValueOnce(
      new Error("provider unavailable"),
    )

    const { GET } = await import("@/app/api/cron/media-upload-cleanup/route")
    const response = await GET(
      new Request("https://app.example.com/api/cron/media-upload-cleanup", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      scanned: 1,
      deleted: 0,
      failed: 1,
    })
    expect(deleteMediaUploadSessionForCleanup).not.toHaveBeenCalled()
  })
})
