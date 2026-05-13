import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"
import { settleCreatorPayouts } from "@/lib/creator-earnings"
import { registerMobilePushToken } from "@/lib/creator-notifications"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  getCreatorStripeStatus,
  syncCreatorStripeAccount,
} from "@/lib/stripe-connect"

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

vi.mock("@/lib/creator-notifications", () => ({
  registerMobilePushToken: vi.fn(),
}))

vi.mock("@/lib/stripe-connect", () => ({
  getCreatorStripeStatus: vi.fn(),
  syncCreatorStripeAccount: vi.fn(),
}))

vi.mock("@/lib/creator-earnings", () => ({
  settleCreatorPayouts: vi.fn(),
}))

vi.mock("@/lib/creator-stats", () => ({
  getCreatorStats: vi.fn(),
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

describe("mobile push and Stripe APIs", () => {
  beforeEach(() => {
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
  })

  it("keeps accepting Expo push tokens", async () => {
    const { POST } = await import("@/app/api/mobile/push-tokens/route")
    const response = await POST(
      jsonRequest("/api/mobile/push-tokens", {
        expoPushToken: "ExpoPushToken[test-token]",
        platform: "ios",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({ ok: true })
    expect(registerMobilePushToken).toHaveBeenCalledWith({
      userId: session.id,
      expoPushToken: "ExpoPushToken[test-token]",
      apnsDeviceToken: undefined,
      apnsEnvironment: undefined,
      platform: "ios",
    })
  })

  it("accepts native APNs push tokens without requiring Expo tokens", async () => {
    const apnsDeviceToken = "a".repeat(64)

    const { POST } = await import("@/app/api/mobile/push-tokens/route")
    const response = await POST(
      jsonRequest("/api/mobile/push-tokens", {
        apnsDeviceToken,
        apnsEnvironment: "sandbox",
        platform: "ios",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({ ok: true })
    expect(registerMobilePushToken).toHaveBeenCalledWith({
      userId: session.id,
      expoPushToken: undefined,
      apnsDeviceToken,
      apnsEnvironment: "sandbox",
      platform: "ios",
    })
  })

  it("rejects push registration without any token", async () => {
    const { POST } = await import("@/app/api/mobile/push-tokens/route")
    const response = await POST(
      jsonRequest("/api/mobile/push-tokens", {
        platform: "ios",
      }),
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: "Could not register this device for notifications.",
    })
    expect(registerMobilePushToken).not.toHaveBeenCalled()
  })

  it("returns legacy and Swift-friendly Stripe status fields", async () => {
    vi.mocked(getCreatorStripeStatus).mockResolvedValue({
      stripeConnectedAccountId: "acct_123",
      stripePayoutsEnabled: true,
      stripeOnboardingComplete: true,
      stripeRequirementsStatus: "currently_due",
      stripeRequirementsDue: JSON.stringify(["external_account"]),
      stripeConnectedAt: new Date("2026-05-01T00:00:00.000Z"),
      stripeUpdatedAt: new Date("2026-05-02T00:00:00.000Z"),
    })
    vi.mocked(getCreatorStats).mockResolvedValue({
      earnings: {
        availableCents: 1200,
        pendingCents: 300,
        paidCents: 5000,
      },
      stories: [],
    })

    const { GET } = await import(
      "@/app/api/mobile/stripe/connect/status/route"
    )
    const response = await GET(
      jsonRequest("/api/mobile/stripe/connect/status", {}, "GET"),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      status: {
        stripeConnectedAccountId: "acct_123",
        stripePayoutsEnabled: true,
        stripeOnboardingComplete: true,
        connected: true,
        payoutsEnabled: true,
        onboardingComplete: true,
        requirementsStatus: "currently_due",
        requirementsDue: ["external_account"],
      },
      earnings: {
        availableCents: 1200,
      },
    })
    expect(syncCreatorStripeAccount).not.toHaveBeenCalled()
    expect(settleCreatorPayouts).not.toHaveBeenCalled()
  })
})
