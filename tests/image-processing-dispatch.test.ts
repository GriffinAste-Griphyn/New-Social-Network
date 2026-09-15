import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { after } from "next/server"
import { start } from "workflow/api"

import {
  claimImageProcessingStep,
  completeImageProcessingStep,
  processImageAssetStep,
} from "@/workflows/image-processing/steps"

vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("workflow/api", () => ({ start: vi.fn() }))
vi.mock("@/workflows/image-processing", () => ({
  processImageWorkflow: vi.fn(),
}))
vi.mock("@/workflows/image-processing/steps", () => ({
  claimImageProcessingStep: vi.fn(),
  completeImageProcessingStep: vi.fn(),
  failImageProcessingStep: vi.fn(),
  processImageAssetStep: vi.fn(),
}))

const originalWorkflowDispatch = process.env.MEDIA_WORKFLOW_DISPATCH_ENABLED

describe("image processing dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.MEDIA_WORKFLOW_DISPATCH_ENABLED
    vi.mocked(claimImageProcessingStep).mockResolvedValue({ attempt: 1 })
    vi.mocked(processImageAssetStep).mockResolvedValue({} as never)
    vi.mocked(completeImageProcessingStep).mockResolvedValue({
      status: "completed",
      storyCount: 1,
    })
  })

  afterEach(() => {
    if (originalWorkflowDispatch === undefined) {
      delete process.env.MEDIA_WORKFLOW_DISPATCH_ENABLED
    } else {
      process.env.MEDIA_WORKFLOW_DISPATCH_ENABLED = originalWorkflowDispatch
    }
  })

  it("runs the durable database job after the response without Workflow", async () => {
    const { scheduleImageProcessing } = await import(
      "@/lib/image-processing-jobs"
    )

    await expect(
      scheduleImageProcessing("image-job-1", "test"),
    ).resolves.toEqual({ jobId: "image-job-1", runId: null })
    expect(start).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledOnce()

    const callback = vi.mocked(after).mock.calls[0]?.[0] as
      | (() => unknown)
      | undefined
    expect(callback).toBeTypeOf("function")
    await callback?.()

    expect(claimImageProcessingStep).toHaveBeenCalledWith(
      "image-job-1",
      expect.stringMatching(/^direct-/),
    )
    expect(processImageAssetStep).toHaveBeenCalledWith("image-job-1")
    expect(completeImageProcessingStep).toHaveBeenCalledWith(
      "image-job-1",
      expect.anything(),
      expect.stringMatching(/^direct-/),
    )
  })

  it("only uses Workflow when explicitly enabled", async () => {
    process.env.MEDIA_WORKFLOW_DISPATCH_ENABLED = "true"
    vi.mocked(start).mockResolvedValue({ runId: "run-1" } as never)
    const { scheduleImageProcessing } = await import(
      "@/lib/image-processing-jobs"
    )

    await expect(
      scheduleImageProcessing("image-job-1", "test"),
    ).resolves.toEqual({ jobId: "image-job-1", runId: "run-1" })
    expect(start).toHaveBeenCalledOnce()
    expect(after).not.toHaveBeenCalled()
  })
})
