import { afterEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { MediaWorkerCapacityUnavailable, mediaWorkerSlots, configuredMediaWorkerSlots, withMediaWorkerSlot } from "@/lib/media-worker-capacity"

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock("@/lib/db", () => ({ getDb: () => ({ execute }) }))
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
const query = (index: number) => new PgDialect().sqlToQuery(execute.mock.calls[index][0] as SQL)

describe("bounded priority worker ownership", () => {
  it("clamps configured capacity and rejects malformed settings", () => {
    vi.stubEnv("MEDIA_WORKERS_IMAGE_INITIAL", "8")
    expect(configuredMediaWorkerSlots("imageInitial")).toBe(8)
    vi.stubEnv("MEDIA_WORKERS_IMAGE_INITIAL", "1000")
    expect(configuredMediaWorkerSlots("imageInitial")).toBe(32)
    vi.stubEnv("MEDIA_WORKERS_IMAGE_INITIAL", "-3")
    expect(configuredMediaWorkerSlots("imageInitial")).toBe(1)
    vi.stubEnv("MEDIA_WORKERS_IMAGE_INITIAL", "4oops")
    expect(configuredMediaWorkerSlots("imageInitial")).toBe(2)
    expect(configuredMediaWorkerSlots("videoEnhancement")).toBe(1)
  })
  it("reserves separate first-playable capacity and fences lease release", async () => {
    expect(mediaWorkerSlots).toEqual({ videoInitial: 2, imageInitial: 2, videoEnhancement: 1, imageEnhancement: 1, feedFanout: 2 })
    execute.mockResolvedValueOnce({ rows: [{ slot: 0 }] }).mockResolvedValueOnce({ rows: [] })
    const run = vi.fn().mockResolvedValue("ready")
    expect(await withMediaWorkerSlot("videoInitial", run)).toBe("ready")
    const acquire = query(0), release = query(1)
    expect(acquire.sql).toContain("ON CONFLICT (lane, slot)")
    expect(acquire.sql).toContain("WHERE media_worker_leases.expires_at <= now()")
    expect(acquire.sql).toContain("360 seconds")
    expect(acquire.params.slice(0, 2)).toEqual(["videoInitial", 0])
    expect(release.params).toEqual(acquire.params)
    expect(release.sql).toContain("owner_token =")
  })
  it("tries the second slot when the first is busy", async () => {
    execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ slot: 1 }] }).mockResolvedValueOnce({ rows: [] })
    await withMediaWorkerSlot("imageInitial", async () => {})
    expect(query(1).params.slice(0, 2)).toEqual(["imageInitial", 1])
  })
  it("does not claim a database job when its lane is at capacity", async () => {
    execute.mockResolvedValue({ rows: [] })
    const run = vi.fn()
    await expect(withMediaWorkerSlot("videoEnhancement", run)).rejects.toBeInstanceOf(MediaWorkerCapacityUnavailable)
    expect(execute).toHaveBeenCalledOnce()
    expect(run).not.toHaveBeenCalled()
  })
  it("releases its slot after a processing error without swallowing the retry", async () => {
    execute.mockResolvedValueOnce({ rows: [{ slot: 0 }] }).mockResolvedValueOnce({ rows: [] })
    const error = new Error("encode failed")
    await expect(withMediaWorkerSlot("videoInitial", async () => { throw error })).rejects.toBe(error)
    expect(query(1).sql).toContain("UPDATE media_worker_leases")
  })
})
