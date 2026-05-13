import { afterEach, describe, expect, it, vi } from "vitest"

import { formatStoryPostedAt } from "@/lib/story-time"

describe("formatStoryPostedAt", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows elapsed hours for stories posted earlier today", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-13T20:00:00.000Z"))

    expect(formatStoryPostedAt(new Date("2026-05-13T12:00:00.000Z"))).toBe(
      "8h ago",
    )
    expect(formatStoryPostedAt(new Date("2026-05-13T05:00:00.000Z"))).toBe(
      "15h ago",
    )
  })
})
