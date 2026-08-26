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
    "feed_media_commit",
    "feed_media_deferred",
    "feed_media_preparation",
    "feed_media_preheat",
    "feed_refresh_failed",
    "media_cache_summary",
    "media_file_cache_failed",
    "media_file_cache_hit",
    "media_file_cache_skip",
    "media_file_cache_write",
    "thumbnail_generation_swap",
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
    "story_transition_visible",
    "video_disk_cache_hit",
    "video_dismissed",
    "video_ended",
    "video_player_pool_wait",
    "video_player_prepared",
    "video_player_staged",
    "video_preroll_reused",
    "video_prerolled",
    "video_retry",
    "video_recovered",
    "video_startup",
    "video_upload_failed",
    "video_upload_phase",
    "video_upload_retry",
    "video_upload_succeeded",
    "video_first_frame",
    "video_item_ready",
    "video_stalled",
    "video_terminal_failure",
    "video_quality_ramp",
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

  it("accepts upload diagnostic events", async () => {
    const { POST } = await import("@/app/api/mobile/performance-events/route")
    const response = await POST(
      jsonRequest("/api/mobile/performance-events", {
        events: [
          {
            name: "video_upload_failed",
            durationMs: 2400,
            metadata: {
              attempt: "attempt_123",
              phase: "videoUpload",
              retries: "2",
              reason: "network",
            },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(recordMobilePerformanceEvents).toHaveBeenCalledWith({
      userId: session.id,
      events: [
        expect.objectContaining({
          name: "video_upload_failed",
          durationMs: 2400,
          metadata: {
            attempt: "attempt_123",
            phase: "videoUpload",
            retries: "2",
            reason: "network",
          },
        }),
      ],
    })
  })

  it("accepts feed commit and thumbnail swap diagnostics", async () => {
    const { POST } = await import("@/app/api/mobile/performance-events/route")
    const response = await POST(
      jsonRequest("/api/mobile/performance-events", {
        events: [
          { name: "feed_media_commit", metadata: { id: "story_123" } },
          {
            name: "thumbnail_generation_swap",
            metadata: { id: "story_123" },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(recordMobilePerformanceEvents).toHaveBeenCalledWith({
      userId: session.id,
      events: [
        expect.objectContaining({ name: "feed_media_commit" }),
        expect.objectContaining({ name: "thumbnail_generation_swap" }),
      ],
    })
  })

  it("accepts playback recovery diagnostic events", async () => {
    const { POST } = await import("@/app/api/mobile/performance-events/route")
    const response = await POST(
      jsonRequest("/api/mobile/performance-events", {
        events: [
          {
            name: "video_retry",
            metadata: {
              reason: "startup_timeout",
              attempt: "1",
              url: "video.m3u8",
            },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(recordMobilePerformanceEvents).toHaveBeenCalledWith({
      userId: session.id,
      events: [
        expect.objectContaining({
          name: "video_retry",
          metadata: {
            reason: "startup_timeout",
            attempt: "1",
            url: "video.m3u8",
          },
        }),
      ],
    })
  })

  it("accepts playback startup and recovery diagnostics", async () => {
    const { POST } = await import("@/app/api/mobile/performance-events/route")
    const response = await POST(
      jsonRequest("/api/mobile/performance-events", {
        events: [
          {
            name: "video_startup",
            metadata: {
              delivery: "hls",
              cache: "miss",
              url: "video.m3u8",
            },
          },
          {
            name: "video_recovered",
            durationMs: 350,
            metadata: {
              reason: "stall",
              url: "video.m3u8",
            },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(recordMobilePerformanceEvents).toHaveBeenCalledWith({
      userId: session.id,
      events: [
        expect.objectContaining({
          name: "video_startup",
          metadata: {
            delivery: "hls",
            cache: "miss",
            url: "video.m3u8",
          },
        }),
        expect.objectContaining({
          name: "video_recovered",
          durationMs: 350,
          metadata: {
            reason: "stall",
            url: "video.m3u8",
          },
        }),
      ],
    })
  })

  it("accepts correlated terminal playback failures", async () => {
    const { POST } = await import("@/app/api/mobile/performance-events/route")
    const response = await POST(
      jsonRequest("/api/mobile/performance-events", {
        events: [
          {
            name: "video_terminal_failure",
            metadata: {
              playback: "playback_123",
              reason: "stall_recovery_timeout",
              rebuilds: "1",
              same_item_recoveries: "1",
            },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(recordMobilePerformanceEvents).toHaveBeenCalledWith({
      userId: session.id,
      events: [
        expect.objectContaining({
          name: "video_terminal_failure",
          metadata: expect.objectContaining({
            playback: "playback_123",
            reason: "stall_recovery_timeout",
          }),
        }),
      ],
    })
  })

  it("accepts sampled time-to-1080p diagnostics", async () => {
    const { POST } = await import("@/app/api/mobile/performance-events/route")
    const response = await POST(
      jsonRequest("/api/mobile/performance-events", {
        events: [
          {
            name: "video_quality_ramp",
            durationMs: 438,
            metadata: {
              result: "reached",
              target: "1080p",
              width: "1080",
              height: "1920",
            },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(recordMobilePerformanceEvents).toHaveBeenCalledWith({
      userId: session.id,
      events: [
        expect.objectContaining({
          name: "video_quality_ramp",
          durationMs: 438,
          metadata: {
            result: "reached",
            target: "1080p",
            width: "1080",
            height: "1920",
          },
        }),
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
