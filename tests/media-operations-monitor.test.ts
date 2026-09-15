import { writeFile } from "node:fs/promises"
import { PgDialect } from "drizzle-orm/pg-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getDb } from "@/lib/db"
import { collectMediaOperations } from "@/lib/media-operations-monitor"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe("media monitoring persistence", () => {
  it("uses bounded UTC windows and persists even when no playback samples exist", async () => {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = []
    const dialect = new PgDialect()
    const execute = vi.fn(async query => {
      queries.push(dialect.sqlToQuery(query))
      return { rows: queries.length !== 2 ? [] : [{ processing: 0, staleProcessing: 0, oldestProcessingMs: null, exhaustedVideoJobs: 0, exhaustedImageJobs: 0, failedPublications: 0, pendingModeration: 0, publishP95Ms: null }] }
    })
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const selection = { where: vi.fn(() => selection), orderBy: vi.fn(() => selection), limit: vi.fn().mockResolvedValue([]) }
    vi.mocked(getDb).mockReturnValue({ execute, select: () => ({ from: () => selection }), insert: () => ({ values }), delete: () => ({ where: vi.fn().mockResolvedValue(undefined) }) } as never)
    vi.spyOn(console, "info").mockImplementation(() => {})
    const result = await collectMediaOperations(new Date("2026-09-13T20:01:23Z"))
    expect(result.windowEnd.toISOString()).toBe("2026-09-13T20:00:00.000Z")
    expect(result.windowStart.toISOString()).toBe("2026-09-13T19:45:00.000Z")
    expect(result.alerts).toEqual([])
    expect(values).toHaveBeenCalledWith(result)
    expect(onConflictDoUpdate).toHaveBeenCalledOnce()
    const uploadStages = queries.find(query => query.sql.includes("FROM sized GROUP BY kind"))
    expect(uploadStages?.sql).toContain("GROUP BY kind, phase, build, network, model, size")
    expect(uploadStages?.sql).toContain("percentile_cont(0.95)")
    expect(uploadStages?.sql).toContain("'^[0-9]{1,12}$'")
    expect(uploadStages?.params).toHaveLength(2)
    if (process.env.MEDIA_QOE_SQL_CAPTURE_PATH) await writeFile(process.env.MEDIA_QOE_SQL_CAPTURE_PATH, JSON.stringify(queries))
  })
})
