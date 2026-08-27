import { beforeEach, describe, expect, it, vi } from "vitest"

import { getDb } from "@/lib/db"
import { start } from "workflow/api"
import { publishStoryWorkflow } from "@/workflows/story-publication"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
vi.mock("workflow/api", () => ({ start: vi.fn() }))
vi.mock("@/workflows/story-publication", () => ({
  publishStoryWorkflow: vi.fn(),
}))

function publicationDb(
  dispatch: {
    status: string
    workflowRunId: string | null
    attempts: number
    updatedAt: Date
  } = {
    status: "pending",
    workflowRunId: null,
    attempts: 0,
    updatedAt: new Date("2026-08-19T00:00:00.000Z"),
  },
) {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn(() => ({ onConflictDoNothing }))
  const insert = vi.fn(() => ({ values }))
  const selectLimit = vi.fn().mockResolvedValue([dispatch])
  const selectWhere = vi.fn(() => ({ limit: selectLimit }))
  const from = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from }))
  const returning = vi.fn().mockResolvedValue([{ attempts: dispatch.attempts + 1 }])
  const updateWhere = vi.fn(() => ({ returning }))
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

  it("claims and starts the durable publication workflow by default", async () => {
    const { enqueueStoryPublication } = await import("@/lib/story-publication")

    await expect(enqueueStoryPublication("story_123")).resolves.toBe("run_123")
    expect(start).toHaveBeenCalledWith(publishStoryWorkflow, ["story_123"])
  })

  it("allows bulk callers to opt out and leave only the outbox row", async () => {
    const { enqueueStoryPublication } = await import("@/lib/story-publication")

    await expect(
      enqueueStoryPublication("story_123", { dispatch: false }),
    ).resolves.toBeNull()
    expect(start).not.toHaveBeenCalled()
  })

  it("stops dispatching after the bounded attempt limit", async () => {
    vi.mocked(getDb).mockReturnValue(
      publicationDb({
        status: "pending",
        workflowRunId: "run_previous",
        attempts: 4,
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
      }) as never,
    )
    const { enqueueStoryPublication } = await import("@/lib/story-publication")

    await expect(enqueueStoryPublication("story_123")).resolves.toBeNull()
    expect(start).not.toHaveBeenCalled()
  })

  it("backs off retries after a previous dispatch attempt", async () => {
    const now = new Date("2026-08-25T12:00:00.000Z")
    const { isStoryPublicationDispatchDue } = await import(
      "@/lib/story-publication"
    )

    expect(
      isStoryPublicationDispatchDue({
        status: "pending",
        attempts: 2,
        updatedAt: new Date(now.getTime() - 19 * 60 * 1_000),
        now,
      }),
    ).toBe(false)
    expect(
      isStoryPublicationDispatchDue({
        status: "pending",
        attempts: 2,
        updatedAt: new Date(now.getTime() - 20 * 60 * 1_000),
        now,
      }),
    ).toBe(true)
  })
})
