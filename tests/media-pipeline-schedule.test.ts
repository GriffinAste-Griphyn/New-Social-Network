import { beforeEach, describe, expect, it, vi } from "vitest"

import { start } from "workflow/api"
import { processMediaWorkflow } from "@/workflows/media-processing"

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}))
vi.mock("@/workflows/media-processing", () => ({
  processMediaWorkflow: vi.fn(),
}))

describe("durable media processing scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(start).mockResolvedValue({ runId: "workflow-run-123" } as never)
  })

  it("enqueues a durable Workflow run", async () => {
    const { scheduleMediaProcessing } = await import(
      "@/lib/media-pipeline/schedule"
    )

    await expect(
      scheduleMediaProcessing("media-job-123", "video_complete"),
    ).resolves.toEqual({
      jobId: "media-job-123",
      runId: "workflow-run-123",
    })
    expect(start).toHaveBeenCalledWith(processMediaWorkflow, ["media-job-123"])
  })

  it("does not pass an external attempt number as lease ownership", async () => {
    const { scheduleMediaProcessingSlice } = await import(
      "@/lib/media-pipeline/schedule"
    )

    await scheduleMediaProcessingSlice({
      jobId: "media-job-123",
      source: "manual_recovery",
      attempt: 7,
    })
    expect(start).toHaveBeenCalledWith(processMediaWorkflow, ["media-job-123"])
  })
})
