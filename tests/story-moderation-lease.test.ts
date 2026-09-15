import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { withStoryModerationLease } from "@/lib/story-moderation-lease"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
const dialect = new PgDialect()

describe("moderation worker lease", () => {
  beforeEach(() => vi.clearAllMocks())
  it("allows only one concurrent review and releases the lease on completion", async () => {
    const owners = new Map<string, string>()
    const execute = vi.fn(async (query: SQL) => {
      const { sql, params } = dialect.sqlToQuery(query)
      const [lane, token] = params as string[]
      if (sql.includes("INSERT")) {
        if (owners.has(lane)) return { rows: [] }
        owners.set(lane, token)
        return { rows: [{ owner_token: token }] }
      }
      if (owners.get(lane) === token) owners.delete(lane)
      return { rows: [] }
    })
    vi.mocked(getDb).mockReturnValue({ execute } as never)
    let release!: () => void
    const run = vi.fn(() => new Promise<string>(resolve => { release = () => resolve("reviewed") }))
    const first = withStoryModerationLease("story", run)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    const duplicates = await Promise.all(Array.from({ length: 10 }, () => withStoryModerationLease("story", run)))
    expect(duplicates.every(result => typeof result === "object" && result.status === "busy")).toBe(true)
    release()
    await expect(first).resolves.toBe("reviewed")
    expect(owners.size).toBe(0)
    await expect(withStoryModerationLease("story", async () => "retry")).resolves.toBe("retry")
  })
  it("fences release by owner token even when work fails", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ owner_token: "owner" }] })
    vi.mocked(getDb).mockReturnValue({ execute } as never)
    await expect(withStoryModerationLease("story", async () => { throw new Error("provider unavailable") }))
      .rejects.toThrow("provider unavailable")
    const acquire = dialect.sqlToQuery(execute.mock.calls[0][0])
    const release = dialect.sqlToQuery(execute.mock.calls[1][0])
    expect(acquire.sql).toContain("expires_at <= now()")
    expect(release.sql).toContain("owner_token =")
    expect(release.params).toEqual(acquire.params)
  })
})
