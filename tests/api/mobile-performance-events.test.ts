import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { recordMobilePerformanceEvents } from "@/lib/mobile-performance-events"
import { enforceRequestRateLimits } from "@/lib/request-security"

vi.mock("@/lib/auth", () => ({
  getCompleteMobileSession: vi.fn(),
}))

vi.mock("@/lib/request-security", () => ({
  enforceRequestRateLimits: vi.fn(),
  mutationRateLimits: {
    mobileTelemetryUser: { limit: 300, windowMs: 15 * 60 * 1000 },
  },
  requestIpSubject: vi.fn(() => "203.0.113.40"),
}))

vi.mock("@/lib/mobile-performance-events", () => ({
  mobilePerformanceEventNames: [
    "api_request",
    "api_server_timing",
    "feed_disk_cache_clear",
    "feed_disk_cache_hit",
    "feed_disk_cache_miss",
    "feed_disk_cache_restore",
    "feed_disk_cache_write",
    "feed_disk_restore",
    "feed_load",
    "feed_media_preheat",
    "feed_refresh_failed",
    "media_cache_summary",
    "media_file_cache_failed",
    "media_file_cache_hit",
    "media_file_cache_skip",
    "media_file_cache_write",
    "story_open",
    "story_open_warm",
    "story_stack_cache_clear",
    "story_stack_cache_hit",
    "story_stack_cache_miss",
    "story_stack_disk_cache_hit",
    "story_stack_disk_cache_miss",
    "story_stack_disk_cache_write",
    "story_stack_disk_restore",
    "story_stack_display_cache_hit",
    "story_stack_fetch_join",
    "story_stack_network",
    "story_stack_prefetch_end",
    "story_stack_prefetch_start",
    "video_disk_cache_hit",
    "video_first_frame",
    "video_item_ready",
    "video_stalled",
  ],
  recordMobilePerformanceEvents: vi.fn(),
}))

const session = {
  id: "user_123",
  email: "creator@example.com",
  handle: "creator",
  displayName: "Creator",
  avatarUrl: null,
  onboardingIntent: "create" as const,
  creatorStatus: "active" as const,
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.40",
    },
    body: JSON.stringify(body),
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("mobile performance events API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(recordMobilePerformanceEvents).mockResolvedValue({ accepted: 1 })
  })

  it("records bounded mobile timing events", async () => {
    const { POST } = await import("@/app/api/mobile/performance-events/route")
    const response = await POST(
      jsonRequest("/api/mobile/performance-events", {
        events: [
          {
            name: "story_open",
            durationMs: 184,
            metadata: {
              id: "story_123",
              source: "home",
            },
            clientCreatedAt: "2026-05-27T15:15:00.000Z",
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      accepted: 1,
    })
    expect(recordMobilePerformanceEvents).toHaveBeenCalledWith({
      userId: session.id,
      events: [
        {
          name: "story_open",
          durationMs: 184,
          metadata: {
            id: "story_123",
            source: "home",
          },
          clientCreatedAt: new Date("2026-05-27T15:15:00.000Z"),
        },
      ],
    })
  })

  it("rejects unknown event names", async () => {
    const { POST } = await import("@/app/api/mobile/performance-events/route")
    const response = await POST(
      jsonRequest("/api/mobile/performance-events", {
        events: [{ name: "unknown_metric", durationMs: 10 }],
      }),
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: "Could not record performance events.",
    })
    expect(recordMobilePerformanceEvents).not.toHaveBeenCalled()
  })

  it("requires a mobile session", async () => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(null)

    const { POST } = await import("@/app/api/mobile/performance-events/route")
    const response = await POST(
      jsonRequest("/api/mobile/performance-events", {
        events: [{ name: "feed_load", durationMs: 42 }],
      }),
    )

    expect(response.status).toBe(401)
    expect(await responseJson(response)).toMatchObject({
      error: "Unauthorized",
    })
  })
})
