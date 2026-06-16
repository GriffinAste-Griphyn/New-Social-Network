import { describe, expect, it } from "vitest"

import { getDailyPeriod } from "@/lib/daily"

describe("The Daily period", () => {
  it("rolls over at 9 PM Eastern during daylight time", () => {
    const beforeRollover = getDailyPeriod(new Date("2026-06-17T00:59:00.000Z"))
    const atRollover = getDailyPeriod(new Date("2026-06-17T01:00:00.000Z"))

    expect(beforeRollover.poolDate).toBe("2026-06-15")
    expect(atRollover.poolDate).toBe("2026-06-16")
    expect(atRollover.periodStartsAt.toISOString()).toBe(
      "2026-06-17T01:00:00.000Z",
    )
    expect(atRollover.drawAt.toISOString()).toBe("2026-06-18T01:10:00.000Z")
  })

  it("rolls over at 9 PM Eastern during standard time", () => {
    const beforeRollover = getDailyPeriod(new Date("2026-01-02T01:59:00.000Z"))
    const atRollover = getDailyPeriod(new Date("2026-01-02T02:00:00.000Z"))

    expect(beforeRollover.poolDate).toBe("2025-12-31")
    expect(atRollover.poolDate).toBe("2026-01-01")
    expect(atRollover.periodStartsAt.toISOString()).toBe(
      "2026-01-02T02:00:00.000Z",
    )
    expect(atRollover.drawAt.toISOString()).toBe("2026-01-03T02:10:00.000Z")
  })
})
