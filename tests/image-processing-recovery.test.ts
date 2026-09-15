import { afterEach, describe, expect, it, vi } from "vitest"
import { getDb } from "@/lib/db"
import { failImageProcessingStep } from "@/workflows/image-processing/steps"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
afterEach(() => { vi.clearAllMocks() })

function database(job: { status: string; attempts: number; workflowRunId: string }) {
  const sets: Record<string, unknown>[] = []
  const update = vi.fn(() => ({ set: (value: Record<string, unknown>) => {
    sets.push(value)
    return { where: () => ({ returning: async () => [{ id: "job-1" }] }) }
  } }))
  vi.mocked(getDb).mockReturnValue({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "job-1", mediaAssetId: "asset-1", contentMode: "fit", ...job }] }) }) }), update } as never)
  return { sets, update }
}

describe("image worker terminal recovery", () => {
  it("does not let a late failure downgrade a ready image", async () => {
    const db = database({ status: "ready", attempts: 1, workflowRunId: "run-1" })
    await failImageProcessingStep("job-1", "late failure", "run-1")
    expect(db.update).not.toHaveBeenCalled()
  })
  it("ignores failure from an owner whose lease has already been replaced", async () => {
    const db = database({ status: "processing", attempts: 2, workflowRunId: "run-2" })
    await failImageProcessingStep("job-1", "late failure", "run-1")
    expect(db.update).not.toHaveBeenCalled()
  })
  it("reports an explicit terminal error after the final attempt", async () => {
    const db = database({ status: "processing", attempts: 6, workflowRunId: "run-6" })
    await failImageProcessingStep("job-1", "lease expired", "run-6")
    expect(db.sets[0]).toMatchObject({ status: "error", lastError: "lease expired" })
    expect(db.sets[1]).toMatchObject({ processingStatus: "error", providerError: "Image processing failed after multiple attempts." })
    expect(db.sets[2]).toMatchObject({ processingStatus: "error" })
  })
})
