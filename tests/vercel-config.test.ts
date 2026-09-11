import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

type VercelConfig = {
  crons?: Array<{ path: string; schedule: string }>
}

describe("Vercel media recovery schedules", () => {
  it("keeps processing recovery frequent and maintenance hourly", async () => {
    const config = JSON.parse(
      await readFile(path.join(process.cwd(), "vercel.json"), "utf8"),
    ) as VercelConfig
    const schedules = Object.fromEntries(
      (config.crons ?? []).map((cron) => [cron.path, cron.schedule]),
    )

    expect(schedules).toMatchObject({
      "/api/cron/media-upload-cleanup": "17 * * * *",
      "/api/cron/media-processing-reconcile": "*/5 * * * *",
      "/api/cron/image-processing-reconcile": "*/5 * * * *",
      "/api/cron/story-moderation-reconcile": "*/10 * * * *",
      "/api/cron/story-publication-reconcile": "*/5 * * * *",
      "/api/cron/media-operations-rollup": "47 * * * *",
    })
  })
})
