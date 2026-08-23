import { describe, expect, it } from "vitest"

import {
  parseStoryElements,
  storyCaptionSchema,
  storyTextOverlaySchema,
} from "@/lib/story-validators"

describe("story input validation", () => {
  it("keeps a comma-containing text overlay as one overlay", () => {
    const formData = new FormData()
    formData.set(
      "textOverlays",
      "Tell PG not to get excited yet, it is a cherry pie.",
    )

    expect(parseStoryElements(formData)).toEqual([
      expect.objectContaining({
        kind: "text",
        label: "Tell PG not to get excited yet, it is a cherry pie.",
      }),
    ])
  })

  it("uses the same 220-character ceiling for captions and text overlays", () => {
    expect(storyCaptionSchema.safeParse("x".repeat(220)).success).toBe(true)
    expect(storyTextOverlaySchema.safeParse("x".repeat(220)).success).toBe(true)
    expect(storyCaptionSchema.safeParse("x".repeat(221)).success).toBe(false)
    expect(storyTextOverlaySchema.safeParse("x".repeat(221)).success).toBe(false)
  })
})
