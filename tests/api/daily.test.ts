import { describe, expect, it } from "vitest"

import {
  getDailyPeriod,
  resolveDailySessionProgressState,
} from "@/lib/daily"

describe("The Daily period", () => {
  it("rolls over at midnight Eastern during daylight time", () => {
    const beforeRollover = getDailyPeriod(new Date("2026-06-17T03:59:00.000Z"))
    const atRollover = getDailyPeriod(new Date("2026-06-17T04:00:00.000Z"))

    expect(beforeRollover.poolDate).toBe("2026-06-16")
    expect(atRollover.poolDate).toBe("2026-06-17")
    expect(atRollover.periodStartsAt.toISOString()).toBe(
      "2026-06-17T04:00:00.000Z",
    )
    expect(atRollover.periodEndsAt.toISOString()).toBe(
      "2026-06-18T04:00:00.000Z",
    )
    expect(atRollover.drawAt.toISOString()).toBe("2026-06-18T04:10:00.000Z")
    expect(atRollover.rolloverLabel).toBe("12:00 AM ET")
    expect(atRollover.drawLabel).toBe("12:10 AM ET")
  })

  it("rolls over at midnight Eastern during standard time", () => {
    const beforeRollover = getDailyPeriod(new Date("2026-01-02T04:59:00.000Z"))
    const atRollover = getDailyPeriod(new Date("2026-01-02T05:00:00.000Z"))

    expect(beforeRollover.poolDate).toBe("2026-01-01")
    expect(atRollover.poolDate).toBe("2026-01-02")
    expect(atRollover.periodStartsAt.toISOString()).toBe(
      "2026-01-02T05:00:00.000Z",
    )
    expect(atRollover.periodEndsAt.toISOString()).toBe(
      "2026-01-03T05:00:00.000Z",
    )
    expect(atRollover.drawAt.toISOString()).toBe("2026-01-03T05:10:00.000Z")
  })

  it("uses the next Eastern midnight across spring daylight saving time", () => {
    const period = getDailyPeriod(new Date("2026-03-08T05:00:00.000Z"))

    expect(period.poolDate).toBe("2026-03-08")
    expect(period.periodStartsAt.toISOString()).toBe("2026-03-08T05:00:00.000Z")
    expect(period.periodEndsAt.toISOString()).toBe("2026-03-09T04:00:00.000Z")
    expect(period.drawAt.toISOString()).toBe("2026-03-09T04:10:00.000Z")
  })

  it("uses the next Eastern midnight across fall daylight saving time", () => {
    const period = getDailyPeriod(new Date("2026-11-01T04:00:00.000Z"))

    expect(period.poolDate).toBe("2026-11-01")
    expect(period.periodStartsAt.toISOString()).toBe("2026-11-01T04:00:00.000Z")
    expect(period.periodEndsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z")
    expect(period.drawAt.toISOString()).toBe("2026-11-02T05:10:00.000Z")
  })
})

describe("The Daily progress state", () => {
  it("advances to the next ad when the current ad completes", () => {
    expect(
      resolveDailySessionProgressState({
        event: "completed",
        position: 3,
        positionMs: 6000,
        sessionCurrentAdIndex: 3,
        sessionCurrentPositionMs: 5500,
        sessionStatus: "started",
        viewStatus: "started",
      }),
    ).toEqual({
      status: "started",
      currentAdIndex: 4,
      currentPositionMs: 0,
    })
  })

  it("does not move backward for a late heartbeat from a completed ad", () => {
    expect(
      resolveDailySessionProgressState({
        event: "heartbeat",
        position: 3,
        positionMs: 6000,
        sessionCurrentAdIndex: 4,
        sessionCurrentPositionMs: 0,
        sessionStatus: "started",
        viewStatus: "completed",
      }),
    ).toEqual({
      status: "started",
      currentAdIndex: 4,
      currentPositionMs: 0,
    })
  })

  it("does not pause or move backward for a late exit from a completed ad", () => {
    expect(
      resolveDailySessionProgressState({
        event: "exited",
        position: 2,
        positionMs: 6000,
        sessionCurrentAdIndex: 3,
        sessionCurrentPositionMs: 0,
        sessionStatus: "started",
        viewStatus: "completed",
      }),
    ).toEqual({
      status: "started",
      currentAdIndex: 3,
      currentPositionMs: 0,
    })
  })
})
