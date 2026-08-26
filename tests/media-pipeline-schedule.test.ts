import { beforeEach, describe, expect, it, vi } from "vitest"

import { processMediaJobRun } from "@/lib/media-pipeline/direct-processing"

const state = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>> }))

vi.mock("next/server", () => ({
  after: vi.fn((callback: () => Promise<void>) => {
    state.callbacks.push(callback)
  }),
}))
vi.mock("@/lib/media-pipeline/direct-processing", () => ({
  processMediaJobRun: vi.fn(),
}))

describe("direct media processing scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.callbacks = []
    vi.mocked(processMediaJobRun).mockResolvedValue({
      status: "completed",
      jobId: "media-job-123",
      attempt: 1,
    })
  })

  it("runs the leased processor directly without a recursive HTTP dispatch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { scheduleMediaProcessing } = await import(
      "@/lib/media-pipeline/schedule"
    )

    scheduleMediaProcessing("media-job-123", "video_complete")
    expect(state.callbacks).toHaveLength(1)
    await state.callbacks[0]()

    expect(processMediaJobRun).toHaveBeenCalledOnce()
    expect(processMediaJobRun).toHaveBeenCalledWith("media-job-123")
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("does not trust an external attempt number as lease ownership", async () => {
    const { scheduleMediaProcessingSlice } = await import(
      "@/lib/media-pipeline/schedule"
    )

    scheduleMediaProcessingSlice({
      jobId: "media-job-123",
      source: "manual_recovery",
      attempt: 7,
    })
    await state.callbacks[0]()

    expect(processMediaJobRun).toHaveBeenCalledWith("media-job-123")
  })
})
