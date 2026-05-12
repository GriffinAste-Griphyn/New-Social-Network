import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

import { getMobileSession } from "@/lib/auth"
import { enforceRequestRateLimits } from "@/lib/request-security"
import { deleteUserAccount } from "@/lib/user-store"

vi.mock("@/lib/auth", () => ({
  getMobileSession: vi.fn(),
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

vi.mock("@/lib/user-store", () => ({
  deleteUserAccount: vi.fn(),
}))

const session = {
  id: "user_123",
  email: "viewer@example.com",
  handle: "viewer",
  displayName: "Viewer",
  avatarUrl: null,
  onboardingIntent: "explore" as const,
  creatorStatus: "inactive" as const,
}

function deleteRequest() {
  return new Request("https://app.example.com/api/mobile/account", {
    method: "DELETE",
    headers: {
      authorization: "Bearer mobile-token",
      "x-forwarded-for": "203.0.113.40",
    },
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("mobile account API", () => {
  beforeEach(() => {
    vi.mocked(getMobileSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(deleteUserAccount).mockResolvedValue({
      ok: true,
      message: "Your account has been deleted.",
    })
  })

  it("deletes the signed-in account", async () => {
    const { DELETE } = await import("@/app/api/mobile/account/route")
    const response = await DELETE(deleteRequest())

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({ ok: true })
    expect(deleteUserAccount).toHaveBeenCalledWith("user_123")
  })

  it("requires a mobile session", async () => {
    vi.mocked(getMobileSession).mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/mobile/account/route")
    const response = await DELETE(deleteRequest())

    expect(response.status).toBe(401)
    expect(deleteUserAccount).not.toHaveBeenCalled()
  })

  it("does not delete when rate limited", async () => {
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(
      NextResponse.json({ error: "Too many requests." }, { status: 429 }),
    )

    const { DELETE } = await import("@/app/api/mobile/account/route")
    const response = await DELETE(deleteRequest())

    expect(response.status).toBe(429)
    expect(deleteUserAccount).not.toHaveBeenCalled()
  })
})
