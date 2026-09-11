import { describe, expect, it } from "vitest"

import { isRetryableStoryModeration } from "@/lib/safety/moderation-retry"

describe("story moderation retry policy", () => {
  it("retries pending and known scanner-infrastructure holds", () => {
    expect(
      isRetryableStoryModeration({
        moderationStatus: "pending",
        moderationReason: null,
      }),
    ).toBe(true)
    expect(
      isRetryableStoryModeration({
        moderationStatus: "flagged",
        moderationReason:
          "Media moderation requires an absolute reviewable media URL.",
      }),
    ).toBe(true)
  })

  it("never retries a content-policy flag through the infrastructure path", () => {
    expect(
      isRetryableStoryModeration({
        moderationStatus: "flagged",
        moderationReason: "OpenAI moderation flagged violence in image.",
      }),
    ).toBe(false)
    expect(
      isRetryableStoryModeration({
        moderationStatus: "rejected",
        moderationReason:
          "Media moderation requires an absolute reviewable media URL.",
      }),
    ).toBe(false)
  })
})
