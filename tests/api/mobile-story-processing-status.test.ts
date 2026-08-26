import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { enqueueMediaProcessing } from "@/lib/media-pipeline/jobs"
import { scheduleMediaProcessing } from "@/lib/media-pipeline/schedule"
import { getStoryUploadStatusForOwner } from "@/lib/story-store"

vi.mock("@/lib/auth", () => ({ getCompleteMobileSession: vi.fn() }))
vi.mock("@/lib/media-pipeline/jobs", () => ({
  enqueueMediaProcessing: vi.fn(),
}))
vi.mock("@/lib/media-pipeline/schedule", () => ({
  scheduleMediaProcessing: vi.fn(),
}))
vi.mock("@/lib/story-store", () => ({
  getStoryUploadStatusForOwner: vi.fn(),
}))
vi.mock("@/lib/safety/user-facing", () => ({
  userFacingModerationReason: vi.fn(() => null),
}))

const processingStatus = {
  id: "story-1",
  mediaAssetId: "media-1",
  storageProvider: "vercel-blob",
  status: "processing" as const,
  processingStatus: "processing",
  hasOriginalRendition: true,
  moderationStatus: "approved",
  moderationReason: null,
  providerStatus: "queued",
  providerPctComplete: 0,
  fullQualityReady: false,
  providerError: null,
  lastCheckedAt: null,
  readyAt: null,
  isLive: false,
}

describe("mobile story processing status", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCompleteMobileSession).mockResolvedValue({ id: "creator-1" } as never)
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue(processingStatus)
    vi.mocked(enqueueMediaProcessing).mockResolvedValue({
      jobId: "media-job-1",
      runId: null,
      dispatchRecommended: true,
    })
  })

  it("schedules direct recovery without leaking internal storage identifiers", async () => {
    const { GET } = await import("@/app/api/mobile/stories/[id]/status/route")
    const response = await GET(
      new Request("https://app.example/api/mobile/stories/story-1/status"),
      { params: Promise.resolve({ id: "story-1" }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(enqueueMediaProcessing).toHaveBeenCalledWith("media-1")
    expect(scheduleMediaProcessing).toHaveBeenCalledWith(
      "media-job-1",
      "story_status_poll",
    )
    expect(payload.story.mediaAssetId).toBeUndefined()
    expect(payload.story.storageProvider).toBeUndefined()
    expect(payload.story.pollAfterMs).toBe(1_500)
  })

  it("does not duplicate an active processing dispatch", async () => {
    vi.mocked(enqueueMediaProcessing).mockResolvedValue({
      jobId: "media-job-1",
      runId: null,
      dispatchRecommended: false,
    })
    const { GET } = await import("@/app/api/mobile/stories/[id]/status/route")
    await GET(
      new Request("https://app.example/api/mobile/stories/story-1/status"),
      { params: Promise.resolve({ id: "story-1" }) },
    )

    expect(enqueueMediaProcessing).toHaveBeenCalledWith("media-1")
    expect(scheduleMediaProcessing).not.toHaveBeenCalled()
  })

  it("does not reschedule a ready video", async () => {
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue({
      ...processingStatus,
      status: "live",
      processingStatus: "ready",
      providerStatus: "ready",
      providerPctComplete: 100,
      fullQualityReady: true,
      isLive: true,
    })
    const { GET } = await import("@/app/api/mobile/stories/[id]/status/route")
    await GET(
      new Request("https://app.example/api/mobile/stories/story-1/status"),
      { params: Promise.resolve({ id: "story-1" }) },
    )

    expect(enqueueMediaProcessing).not.toHaveBeenCalled()
    expect(scheduleMediaProcessing).not.toHaveBeenCalled()
  })

  it("keeps early playback live while scheduling quality enrichment", async () => {
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue({
      ...processingStatus,
      status: "live",
      processingStatus: "ready",
      providerStatus: "enhancing",
      providerPctComplete: 33,
      fullQualityReady: false,
      isLive: true,
    })
    const { GET } = await import("@/app/api/mobile/stories/[id]/status/route")
    const response = await GET(
      new Request("https://app.example/api/mobile/stories/story-1/status"),
      { params: Promise.resolve({ id: "story-1" }) },
    )
    const payload = await response.json()

    expect(payload.story).toMatchObject({
      isLive: true,
      fullQualityReady: false,
      providerStatus: "enhancing",
      providerPctComplete: 33,
      pollAfterMs: null,
    })
    expect(enqueueMediaProcessing).toHaveBeenCalledWith("media-1")
    expect(scheduleMediaProcessing).toHaveBeenCalledWith(
      "media-job-1",
      "story_status_poll",
    )
  })
})
