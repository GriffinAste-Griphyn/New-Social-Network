import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"
import { mobilePerformanceEventNames } from "@/lib/mobile-performance-events"
import { mobilePerformanceEventName } from "@/lib/db/schema/definitions"

it("keeps the iOS telemetry protocol registered in the API and database", async () => {
  const source = await readFile("apps/ios/UBEYE/App/MediaTelemetry.swift", "utf8")
  const list = source.match(/uploadableEventNames: Set<String> = \[([\s\S]*?)\]/)?.[1]
  expect(list).toBeDefined()
  const names = [...list!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort()
  expect(names).toEqual([...mobilePerformanceEventNames].sort())
  expect(names).toEqual([...mobilePerformanceEventName.enumValues].sort())
})
