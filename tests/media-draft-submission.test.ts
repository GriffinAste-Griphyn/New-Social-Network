import { describe, expect, it } from "vitest"
import { videoStoryReservationTime } from "@/lib/media-draft-submission"

describe("private video draft submission time", () => {
  const lease = new Date("2026-09-14T01:00:00Z")
  const post = "2026-09-14T01:30:00Z"
  const now = new Date("2026-09-14T02:00:00Z")
  it("uses Post time instead of recording/editing time and remains stable on retry", () => {
    expect(videoStoryReservationTime(lease, post, now)).toEqual(new Date(post))
    expect(videoStoryReservationTime(lease, post, new Date("2026-09-14T03:00:00Z"))).toEqual(new Date(post))
  })
  it("preserves existing clients and bounds client clocks", () => {
    expect(videoStoryReservationTime(lease, undefined, now)).toEqual(lease)
    expect(videoStoryReservationTime(lease, "invalid", now)).toEqual(lease)
    expect(videoStoryReservationTime(lease, "2026-09-14T00:00:00Z", now)).toEqual(lease)
    expect(videoStoryReservationTime(lease, "2026-09-15T00:00:00Z", now)).toEqual(now)
  })
})
