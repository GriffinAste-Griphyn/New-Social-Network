import { describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { recordCloudflareStreamUploadStatus } from "@/lib/media-upload-sessions"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))

describe("concurrent provider status observations", () => {
  it.each(["ready", "error"])("re-reads after a lost update and preserves a newer %s event", async state => {
    const firstPlayableObservedAt = "2026-09-14T03:00:00.000Z"
    const details = { readyToStream: true, state: "ready", pctComplete: 80, errorReason: null,
      byteSize: 1_000, durationMs: 1_000, width: 1080, height: 1920 }
    const newer = { ...details, state, pctComplete: 100, errorReason: state === "error" ? "provider failure" : null,
      readinessObservations: { firstPlayableObservedAt } }
    const limit = vi.fn().mockResolvedValueOnce([{ id: "lease", providerPayload: { ...details, pctComplete: 50 }, providerEventAt: new Date() }])
      .mockResolvedValueOnce([{ id: "lease", providerPayload: newer, providerEventAt: new Date() }])
    const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) }))
    const returning = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "lease" }])
    const where = vi.fn((condition: SQL) => { void condition; return { returning } })
    const set = vi.fn((values: Record<string, unknown>) => { void values; return { where } })
    vi.mocked(getDb).mockReturnValue({ select, update: vi.fn(() => ({ set })) } as never)
    await expect(recordCloudflareStreamUploadStatus({ uid: "fixture", details })).resolves.toEqual({ id: "lease" })
    expect(set).toHaveBeenCalledTimes(2)
    expect(set.mock.calls[1][0]).toMatchObject({ providerStatus: state, providerPctComplete: 100,
      providerPayload: { readinessObservations: { firstPlayableObservedAt } } })
    if (state === "error") expect(set.mock.calls[1][0]).toMatchObject({ providerError: "provider failure" })
    const sql = new PgDialect().sqlToQuery(where.mock.calls[0][0]).sql
    expect(sql).toContain('"provider_event_at"')
    expect(sql).toContain('"provider_payload"')
  })
})
