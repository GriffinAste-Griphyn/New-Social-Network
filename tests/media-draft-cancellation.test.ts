import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getDb } from "@/lib/db"
import { claimMediaUploadSessionForCompletion, expirePrivateDraftUpload } from "@/lib/media-upload-sessions"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))

describe("private draft cancellation fencing", () => {
  beforeEach(() => vi.clearAllMocks())
  it("rejects completion when cancellation expires the session between read and claim", async () => {
    const prepared = { id: "lease", storageProvider: "cloudflare-stream", storageKey: "video",
      ownerUserId: "owner", status: "prepared", expiresAt: new Date(Date.now() + 60_000) }
    let reads = 0
    let claimSql = ""
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => {
        reads += 1
        return [{ ...prepared, expiresAt: reads === 1 ? prepared.expiresAt : new Date(0) }]
      } }) }) }),
      update: () => ({ set: () => ({ where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        claimSql = new PgDialect().sqlToQuery(condition).sql
        return { returning: async () => [] }
      } }) }),
    } as never)
    await expect(claimMediaUploadSessionForCompletion({ storageProvider: "cloudflare-stream",
      storageKey: "video", ownerUserId: "owner", uploadSessionId: "lease", contentType: "video/mp4", byteSize: 10,
    })).rejects.toMatchObject({ statusCode: 410 })
    expect(claimSql).toMatch(/expires_at.*>/)
    expect(reads).toBe(2)
  })

  it("cancellation cannot expire another owner or a completing/published session", async () => {
    let query: ReturnType<PgDialect["sqlToQuery"]> | undefined
    vi.mocked(getDb).mockReturnValue({ update: () => ({ set: () => ({
      where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        query = new PgDialect().sqlToQuery(condition)
        return { returning: async () => [] }
      },
    }) }) } as never)
    expect(await expirePrivateDraftUpload({ ownerUserId: "owner", clientUploadId: "client", uploadSessionId: "lease" })).toBeNull()
    expect(query?.sql).toContain("owner_user_id")
    expect(query?.sql).toContain("client_upload_id")
    expect(query?.params).toContain("owner")
    expect(query?.params).toContain("prepared")
  })
})
