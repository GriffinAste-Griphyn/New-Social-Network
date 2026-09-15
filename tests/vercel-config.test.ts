import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

type VercelConfig = {
  crons?: Array<{ path: string; schedule: string }>
  functions?: Record<string, { experimentalTriggers: Array<{ type: string; topic: string }> }>
}

describe("Vercel media recovery schedules", () => {
  it("airgaps each priority consumer behind its own Queue trigger and includes video binaries", async () => {
    const config = JSON.parse(await readFile("vercel.json", "utf8")) as VercelConfig
    const topics = ["media-video-first-playable", "media-video-enhancement", "media-image-first-playable", "media-image-enhancement", "media-feed-fanout"]
    expect(Object.values(config.functions ?? {}).flatMap((fn) => fn.experimentalTriggers.map((trigger) => trigger.topic)).sort()).toEqual([...topics].sort())
    for (const topic of topics) {
      expect(config.functions?.[`app/api/queues/${topic}/route.ts`].experimentalTriggers).toEqual([
        expect.objectContaining({ type: "queue/v2beta", topic }),
      ])
    }
    const nextConfig = await readFile("next.config.ts", "utf8")
    expect(nextConfig).toContain('"/api/queues/media-video-*"')
  })
  it("staggers five-minute recovery on Pro and keeps expensive rollups hourly", async () => {
    const config = JSON.parse(
      await readFile(path.join(process.cwd(), "vercel.json"), "utf8"),
    ) as VercelConfig
    const schedules = Object.fromEntries(
      (config.crons ?? []).map((cron) => [cron.path, cron.schedule]),
    )

    expect(schedules).toMatchObject({
      "/api/cron/media-upload-cleanup": "20 * * * *",
      "/api/cron/media-processing-reconcile": "*/5 * * * *",
      "/api/cron/image-processing-reconcile": "1-59/5 * * * *",
      "/api/cron/story-moderation-reconcile": "2-59/5 * * * *",
      "/api/cron/story-publication-reconcile": "3-59/5 * * * *",
      "/api/cron/media-operations-rollup": "4-59/5 * * * *",
      "/api/cron/feed-score-rollup": "45 * * * *",
    })
  })
})
