import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

type VercelConfig = {
  crons?: Array<{ path: string; schedule: string }>
}

describe("Vercel media recovery schedules", () => {
  it("keeps every recovery job on a distinct Hobby-compatible daily schedule", async () => {
    const config = JSON.parse(
      await readFile(path.join(process.cwd(), "vercel.json"), "utf8"),
    ) as VercelConfig
    const schedules = Object.fromEntries(
      (config.crons ?? []).map((cron) => [cron.path, cron.schedule]),
    )

    expect(schedules).toMatchObject({
      "/api/cron/media-upload-cleanup": "20 3 * * *",
      "/api/cron/media-processing-reconcile": "5 0 * * *",
      "/api/cron/image-processing-reconcile": "15 0 * * *",
      "/api/cron/story-moderation-reconcile": "25 0 * * *",
      "/api/cron/story-publication-reconcile": "35 0 * * *",
      "/api/cron/media-operations-rollup": "45 0 * * *",
    })
  })
})
