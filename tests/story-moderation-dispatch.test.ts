import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getDb } from "@/lib/db"
import { claimStoryModerationDispatch } from "@/lib/story-moderation-dispatch"
import { enqueueStoryModeration } from "@/lib/story-moderation"
import { after } from "next/server"
import { start } from "workflow/api"
import { isWorkflowDispatchEnabled } from "@/lib/media-pipeline/features"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("workflow/api", () => ({ start: vi.fn() }))
vi.mock("@/lib/media-pipeline/features", () => ({ isWorkflowDispatchEnabled: vi.fn() }))
vi.mock("@/lib/story-moderation-core", () => ({ moderatePendingStory: vi.fn() }))
vi.mock("@/workflows/story-moderation", () => ({ moderateStoryWorkflow: vi.fn() }))

describe("moderation dispatch coalescing", () => {
  beforeEach(() => vi.clearAllMocks())
  function database(rows: unknown[] = [{ owner_token: "fixture" }]) {
    const execute = vi.fn().mockResolvedValue({ rows })
    vi.mocked(getDb).mockReturnValue({ execute } as never)
    return execute
  }
  it("does not enqueue another workflow when a dispatch or worker is already claimed", async () => {
    database([])
    vi.mocked(isWorkflowDispatchEnabled).mockReturnValue(true)
    await expect(enqueueStoryModeration("story")).resolves.toMatchObject({ deduplicated: true })
    expect(start).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })
  it("retains a successful dispatch through the queued period", async () => {
    const execute = database()
    vi.mocked(isWorkflowDispatchEnabled).mockReturnValue(true)
    vi.mocked(start).mockResolvedValue({ runId: "run" } as never)
    await expect(enqueueStoryModeration("story")).resolves.toMatchObject({ runId: "run" })
    expect(execute).toHaveBeenCalledTimes(1)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.sql).toContain("ON CONFLICT")
    expect(query.sql).toContain("interval '30 seconds'")
    expect(query.sql).toContain("AND expires_at > now()")
    expect(query.sql).toContain("asset_kind = 'video' OR processing_status = 'ready'")
    expect(query.params).toContain("storyModeration:story")
  })
  it("releases a failed transport using only its own token", async () => {
    const execute = database()
    vi.mocked(isWorkflowDispatchEnabled).mockReturnValue(true)
    vi.mocked(start).mockRejectedValue(new Error("transport unavailable"))
    await expect(enqueueStoryModeration("story")).rejects.toThrow("transport unavailable")
    expect(execute).toHaveBeenCalledTimes(2)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[1][0])
    expect(query.sql).toContain("owner_token =")
    expect(query.params[0]).toBe("storyModerationDispatch:story")
  })
  it("coalesces direct after-response dispatches too", async () => {
    database()
    vi.mocked(isWorkflowDispatchEnabled).mockReturnValue(false)
    await enqueueStoryModeration("story")
    expect(after).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })
  it("returns no claim for ineligible stories", async () => {
    database([])
    await expect(claimStoryModerationDispatch("story")).resolves.toBeNull()
  })
})
