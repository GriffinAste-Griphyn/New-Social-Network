import { afterEach, describe, expect, it, vi } from "vitest"
import { isMediaJobPlayable, processMediaJobRun } from "@/lib/media-pipeline/direct-processing"
import { sendMediaQueueJob } from "@/lib/media-priority-queue"
import { processQueuedMediaJob } from "@/lib/media-pipeline/schedule"

vi.mock("@/lib/media-pipeline/direct-processing", () => ({ isMediaJobPlayable: vi.fn(), processMediaJobRun: vi.fn() }))
vi.mock("@/lib/media-priority-queue", () => ({ areMediaPriorityQueuesEnabled: vi.fn(), sendMediaQueueJob: vi.fn() }))
afterEach(() => vi.resetAllMocks())

describe("existing media outbox continuation", () => {
  it("releases the first-playable consumer to the enhancement lane", async () => {
    vi.mocked(processMediaJobRun).mockResolvedValue({ status: "yielded", jobId: "media-job-1", attempt: 1, slices: 3, elapsedMs: 1000 })
    vi.mocked(isMediaJobPlayable).mockResolvedValue(true)
    await processQueuedMediaJob("media-job-1", true)
    expect(processMediaJobRun).toHaveBeenCalledWith("media-job-1", { stopAfterPlayable: true })
    expect(sendMediaQueueJob).toHaveBeenCalledWith("videoEnhancement", "media-job-1")
  })
  it("keeps a budget-interrupted initial encode in the initial lane", async () => {
    vi.mocked(processMediaJobRun).mockResolvedValue({ status: "yielded", jobId: "media-job-1", attempt: 1, slices: 1, elapsedMs: 235000 })
    vi.mocked(isMediaJobPlayable).mockResolvedValue(false)
    await processQueuedMediaJob("media-job-1", true)
    expect(sendMediaQueueJob).toHaveBeenCalledWith("videoInitial", "media-job-1")
  })
  it("retries a failed continuation send rather than silently stranding its outbox row", async () => {
    vi.mocked(processMediaJobRun).mockResolvedValue({ status: "yielded", jobId: "media-job-1", attempt: 1, slices: 3, elapsedMs: 1000 })
    vi.mocked(isMediaJobPlayable).mockResolvedValue(true)
    vi.mocked(sendMediaQueueJob).mockRejectedValue(new Error("transport down"))
    await expect(processQueuedMediaJob("media-job-1", true)).rejects.toThrow("transport down")
  })
  it("acks completed and duplicate deliveries without dispatching another continuation", async () => {
    for (const status of ["already_running", "already_ready", "exhausted"] as const) {
      vi.mocked(processMediaJobRun).mockResolvedValue({ status, jobId: "media-job-1" })
      await processQueuedMediaJob("media-job-1", false)
    }
    expect(sendMediaQueueJob).not.toHaveBeenCalled()
  })
})
