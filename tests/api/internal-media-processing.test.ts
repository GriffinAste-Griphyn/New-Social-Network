import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import { scheduleMediaProcessingSlice } from "@/lib/media-pipeline/schedule"

vi.mock("@/lib/media-pipeline/schedule", () => ({
  scheduleMediaProcessingSlice: vi.fn(),
}))

const originalCronSecret = process.env.CRON_SECRET

describe("internal media processing dispatch", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.CRON_SECRET = "test-cron-secret"
  })

  afterAll(() => {
    process.env.CRON_SECRET = originalCronSecret
  })

  it("rejects requests without the internal bearer token", async () => {
    const { POST } = await import("@/app/api/internal/media-processing/route")
    const response = await POST(
      new Request("https://example.com/api/internal/media-processing", {
        method: "POST",
        body: JSON.stringify({ jobId: "media-job-123", source: "test" }),
      }),
    )

    expect(response.status).toBe(401)
    expect(scheduleMediaProcessingSlice).not.toHaveBeenCalled()
  })

  it("rejects malformed dispatch payloads", async () => {
    const { POST } = await import("@/app/api/internal/media-processing/route")
    const response = await POST(
      new Request("https://example.com/api/internal/media-processing", {
        method: "POST",
        headers: {
          authorization: "Bearer test-cron-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jobId: "not-a-media-job", source: "test" }),
      }),
    )

    expect(response.status).toBe(400)
    expect(scheduleMediaProcessingSlice).not.toHaveBeenCalled()
  })

  it("accepts a valid bounded processing slice", async () => {
    const { POST } = await import("@/app/api/internal/media-processing/route")
    const payload = {
      jobId: "media-job-123",
      source: "slice_continue",
      attempt: 2,
    }
    const response = await POST(
      new Request("https://example.com/api/internal/media-processing", {
        method: "POST",
        headers: {
          authorization: "Bearer test-cron-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    )

    expect(response.status).toBe(202)
    expect(scheduleMediaProcessingSlice).toHaveBeenCalledWith(payload)
  })
})
