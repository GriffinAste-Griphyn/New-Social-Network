import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  getUserNotificationPreferences,
  setUserNotificationPreferences,
} from "@/lib/user-notification-preferences"

vi.mock("@/lib/auth", () => ({
  getCompleteMobileSession: vi.fn(),
}))

vi.mock("@/lib/request-security", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/request-security")>(
      "@/lib/request-security",
    )

  return {
    ...actual,
    enforceRequestRateLimits: vi.fn(),
  }
})

vi.mock("@/lib/user-notification-preferences", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/user-notification-preferences")>(
      "@/lib/user-notification-preferences",
    )

  return {
    ...actual,
    getUserNotificationPreferences: vi.fn(),
    setUserNotificationPreferences: vi.fn(),
  }
})

const session = {
  id: "user_123",
  email: "creator@example.com",
  handle: "creator",
  displayName: "Creator",
  avatarUrl: null,
  onboardingIntent: "create" as const,
  creatorStatus: "active" as const,
}

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.40",
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("mobile notification preferences API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(getUserNotificationPreferences).mockResolvedValue([
      { type: "creator_stories", enabled: true },
      { type: "replies", enabled: true },
      { type: "follows", enabled: true },
    ])
    vi.mocked(setUserNotificationPreferences).mockResolvedValue([
      { type: "creator_stories", enabled: false },
      { type: "replies", enabled: true },
      { type: "follows", enabled: true },
    ])
  })

  it("returns the current notification preferences", async () => {
    const { GET } = await import(
      "@/app/api/mobile/notification-preferences/route"
    )
    const response = await GET(
      jsonRequest("/api/mobile/notification-preferences", {}, "GET"),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      preferences: [
        { type: "creator_stories", enabled: true },
        { type: "replies", enabled: true },
        { type: "follows", enabled: true },
      ],
    })
    expect(getUserNotificationPreferences).toHaveBeenCalledWith(session.id)
  })

  it("updates selected notification preferences", async () => {
    const { POST } = await import(
      "@/app/api/mobile/notification-preferences/route"
    )
    const response = await POST(
      jsonRequest("/api/mobile/notification-preferences", {
        preferences: [{ type: "creator_stories", enabled: false }],
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      preferences: [{ type: "creator_stories", enabled: false }],
    })
    expect(setUserNotificationPreferences).toHaveBeenCalledWith({
      userId: session.id,
      preferences: [{ type: "creator_stories", enabled: false }],
    })
  })

  it("rejects unknown notification preference types", async () => {
    const { POST } = await import(
      "@/app/api/mobile/notification-preferences/route"
    )
    const response = await POST(
      jsonRequest("/api/mobile/notification-preferences", {
        preferences: [{ type: "bad_type", enabled: false }],
      }),
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: "Could not update notification preferences.",
    })
    expect(setUserNotificationPreferences).not.toHaveBeenCalled()
  })
})
