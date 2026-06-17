import { describe, expect, it } from "vitest"

import {
  getDailyPeriod,
  resolveDailySessionProgressState,
} from "@/lib/daily"

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
