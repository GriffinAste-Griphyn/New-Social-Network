import { describe, expect, it } from "vitest"

import {
  directStoryImagePathname,
  directStoryImageUploadStartedAt,
} from "@/lib/story-storage"

describe("story upload ordering", () => {
  it("round-trips the image upload start time through its signed pathname", () => {
    const startedAt = new Date("2026-08-23T14:00:00.123Z")
    const pathname = directStoryImagePathname(
      "creator-1",
      "photo.jpg",
      startedAt,
    )

    expect(
      directStoryImageUploadStartedAt(
        pathname,
        new Date("2026-08-23T14:01:00.000Z"),
      ),
    ).toEqual(startedAt)
  })

  it("ignores legacy and untrusted timestamps", () => {
    const now = new Date("2026-08-23T14:00:00.000Z")

    expect(
      directStoryImageUploadStartedAt(
        "stories/web-direct/creator-1/legacy-upload",
        now,
      ),
    ).toBeNull()
    expect(
      directStoryImageUploadStartedAt(
        `stories/web-direct/creator-1/${now.getTime() + 10 * 60 * 1_000}-11111111-1111-4111-8111-111111111111`,
        now,
      ),
    ).toBeNull()
  })
})
