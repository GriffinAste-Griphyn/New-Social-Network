import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { checkMediaQueueDelivery } from "@/lib/media-queue-self-check"

const mocks = vi.hoisted(() => ({ execute: vi.fn(), limit: vi.fn(), enabled: vi.fn(), send: vi.fn(), collect: vi.fn(), conditions: [] as SQL[] }))
vi.mock("@/lib/media-priority-queue", () => ({ areMediaPriorityQueuesEnabled: mocks.enabled, sendMediaQueueJob: mocks.send }))
vi.mock("@/lib/media-operations-monitor", () => ({ collectMediaOperations: mocks.collect }))
vi.mock("@/lib/db", () => ({ getDb: () => ({
  execute: mocks.execute,
  select: () => {
    const chain = { from: () => chain, where: (condition: SQL) => { mocks.conditions.push(condition); return chain }, orderBy: () => chain, limit: mocks.limit }
    return chain
  },
}) }))
beforeEach(() => {
  vi.resetAllMocks(); vi.restoreAllMocks(); mocks.conditions.length = 0
  mocks.enabled.mockReturnValue(true)
  mocks.execute.mockResolvedValue({ rows: [{ slot: 0 }] })
  mocks.limit.mockResolvedValueOnce([{ id: "media-job-ready" }]).mockResolvedValueOnce([{ id: "image-job-ready" }])
  mocks.send.mockResolvedValue({ messageId: "message-1" })
})

describe("authenticated production queue readiness", () => {
  it("replays only completed jobs across all three lanes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    expect(await checkMediaQueueDelivery()).toMatchObject({ status: "sent", failed: 0, skipped: 0 })
    expect(mocks.send.mock.calls).toEqual([["videoInitial", "media-job-ready"], ["videoEnhancement", "media-job-ready"], ["imageInitial", "image-job-ready"]])
    expect(mocks.conditions.map((where) => new PgDialect().sqlToQuery(where).params)).toEqual([["ready"], ["ready"]])
  })
  it("does no database or queue work when the transport is disabled", async () => {
    mocks.enabled.mockReturnValue(false)
    expect(await checkMediaQueueDelivery()).toEqual({ status: "disabled" })
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it("throttles duplicate cron invocations before querying or sending", async () => {
    mocks.execute.mockResolvedValue({ rows: [] })
    expect(await checkMediaQueueDelivery()).toEqual({ status: "throttled" })
    expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled()
  })
  it("reports a failed transport after attempting every independent lane", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.send.mockRejectedValueOnce(new Error("Queue unavailable"))
    expect(await checkMediaQueueDelivery()).toMatchObject({ status: "error", failed: 1 })
    expect(mocks.send).toHaveBeenCalledTimes(3)
  })
  it("keeps self-checks behind cron authentication", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret")
    try {
      const { GET } = await import("@/app/api/cron/media-operations-rollup/route")
      expect((await GET(new Request("https://app.test/api/cron/media-operations-rollup"))).status).toBe(401)
      expect(mocks.collect).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled()
    } finally { vi.unstubAllEnvs() }
  })
})
