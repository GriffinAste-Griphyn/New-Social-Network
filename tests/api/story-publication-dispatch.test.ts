import { beforeEach, describe, expect, it, vi } from "vitest"

import { start } from "workflow/api"
import { getDb } from "@/lib/db"

vi.mock("workflow/api", () => ({ start: vi.fn() }))
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
vi.mock("@/workflows/story-publication", () => ({
  publishStoryWorkflow: vi.fn(),
}))

function publicationDb() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn(() => ({ onConflictDoNothing }))
  const insert = vi.fn(() => ({ values }))
  const selectLimit = vi.fn().mockResolvedValue([
    {
      status: "pending",
      workflowRunId: null,
      updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    },
  ])
  const selectWhere = vi.fn(() => ({ limit: selectLimit }))
  const from = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from }))
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set }))

  return { insert, select, update }
}

describe("story publication dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDb).mockReturnValue(publicationDb() as never)
    vi.mocked(start).mockResolvedValue({ runId: "run_123" } as never)
  })

  it("dispatches the durable workflow immediately by default", async () => {
    const { enqueueStoryPublication } = await import("@/lib/story-publication")

    await expect(enqueueStoryPublication("story_123")).resolves.toBe("run_123")
    expect(start).toHaveBeenCalledOnce()
  })

  it("allows bulk callers to opt out and leave only the outbox row", async () => {
    const { enqueueStoryPublication } = await import("@/lib/story-publication")

    await expect(
      enqueueStoryPublication("story_123", { dispatch: false }),
    ).resolves.toBeNull()
    expect(start).not.toHaveBeenCalled()
  })
})
