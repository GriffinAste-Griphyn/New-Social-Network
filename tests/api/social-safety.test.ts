import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  blockUser,
  createSafetyReport,
  listBlockedProfiles,
  unblockUser,
} from "@/lib/social-safety"

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

vi.mock("@/lib/social-safety", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/social-safety")>(
      "@/lib/social-safety",
    )

  return {
    ...actual,
    blockUser: vi.fn(),
    createSafetyReport: vi.fn(),
    listBlockedProfiles: vi.fn(),
    unblockUser: vi.fn(),
  }
})

const session = {
  id: "user_123",
  email: "viewer@example.com",
  handle: "viewer",
  displayName: "Viewer",
  avatarUrl: null,
  onboardingIntent: "explore" as const,
  creatorStatus: "inactive" as const,
}

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.30",
    },
    body: JSON.stringify(body),
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("mobile social safety API", () => {
  beforeEach(() => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
  })

  it("lists blocked profiles", async () => {
    vi.mocked(listBlockedProfiles).mockResolvedValue([
      {
        id: "blocked_123",
        name: "Blocked",
        handle: "blocked",
        imageUrl: null,
        createdAt: new Date("2026-05-12T00:00:00.000Z"),
      },
    ])

    const { GET } = await import("@/app/api/mobile/blocks/route")
    const response = await GET(
      new Request("https://app.example.com/api/mobile/blocks"),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      blocked: [
        {
          id: "blocked_123",
          handle: "blocked",
        },
      ],
    })
  })

  it("blocks and unblocks accounts", async () => {
    const { POST, DELETE } = await import("@/app/api/mobile/blocks/route")

    const blockResponse = await POST(
      jsonRequest("/api/mobile/blocks", {
        userId: "blocked_123",
        reason: "Harassment",
      }),
    )

    expect(blockResponse.status).toBe(200)
    expect(blockUser).toHaveBeenCalledWith({
      blockerId: "user_123",
      blockedId: "blocked_123",
      reason: "Harassment",
    })

    const unblockResponse = await DELETE(
      jsonRequest(
        "/api/mobile/blocks",
        {
          userId: "blocked_123",
        },
        "DELETE",
      ),
    )

    expect(unblockResponse.status).toBe(200)
    expect(unblockUser).toHaveBeenCalledWith({
      blockerId: "user_123",
      blockedId: "blocked_123",
    })
  })

  it("submits story, user, and interaction reports", async () => {
    vi.mocked(createSafetyReport).mockResolvedValue("report_123")

    const { POST } = await import("@/app/api/mobile/reports/route")
    const response = await POST(
      jsonRequest("/api/mobile/reports", {
        targetKind: "story",
        targetId: "story_123",
        reason: "harassment",
        details: "Targeted abuse",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      reportId: "report_123",
    })
    expect(createSafetyReport).toHaveBeenCalledWith({
      reporterId: "user_123",
      targetKind: "story",
      targetId: "story_123",
      reason: "harassment",
      details: "Targeted abuse",
    })
  })

  it("requires a complete mobile session", async () => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(null)

    const { POST } = await import("@/app/api/mobile/reports/route")
    const response = await POST(
      jsonRequest("/api/mobile/reports", {
        targetKind: "user",
        targetId: "user_456",
        reason: "spam",
      }),
    )

    expect(response.status).toBe(401)
    expect(createSafetyReport).not.toHaveBeenCalled()
  })
})
