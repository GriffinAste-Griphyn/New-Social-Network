import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createMobileSessionToken,
  isProfileComplete,
} from "@/lib/auth"
import {
  sendUserVerificationEmail,
  verifyEmailCode,
} from "@/lib/email-verification"
import { enforceRequestRateLimits } from "@/lib/request-security"
import {
  authenticateUser,
  completeUserProfileForUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
} from "@/lib/user-store"

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
  authenticateUser: vi.fn(),
  completeUserProfileForUser: vi.fn(),
  registerUser: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}))

vi.mock("@/lib/email-verification", () => ({
  sendUserVerificationEmail: vi.fn(),
  verifyEmailCode: vi.fn(),
}))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")

  return {
    ...actual,
    createMobileSessionToken: vi.fn(),
  }
})

const testUser = {
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
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify(body),
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("mobile auth API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(createMobileSessionToken).mockResolvedValue("mobile-token")
  })

  it("creates an account and sends verification email", async () => {
    vi.mocked(registerUser).mockResolvedValue({ ok: true, user: testUser })

    const { POST } = await import("@/app/api/mobile/auth/signup/route")
    const response = await POST(
      jsonRequest("/api/mobile/auth/signup", {
        email: "Creator@Example.com",
        password: "password123",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      pendingEmail: testUser.email,
    })
    expect(registerUser).toHaveBeenCalledWith({
      email: "creator@example.com",
      password: "password123",
    })
    expect(sendUserVerificationEmail).toHaveBeenCalledWith(testUser)
  })

  it("resends verification and blocks login for unverified email", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      ok: false,
      reason: "email_unverified",
      message: "Verify your email.",
      user: { ...testUser, handle: null, displayName: null },
    })

    const { POST } = await import("@/app/api/mobile/auth/login/route")
    const response = await POST(
      jsonRequest("/api/mobile/auth/login", {
        email: "creator@example.com",
        password: "password123",
      }),
    )

    expect(response.status).toBe(403)
    expect(await responseJson(response)).toMatchObject({
      pendingEmail: testUser.email,
    })
    expect(sendUserVerificationEmail).toHaveBeenCalledWith({
      ...testUser,
      handle: null,
      displayName: null,
    })
  })

  it("verifies a mobile email code and returns a mobile token", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      ok: false,
      reason: "email_unverified",
      message: "Verify your email.",
      user: { ...testUser, handle: null, displayName: null },
    })
    vi.mocked(verifyEmailCode).mockResolvedValue({
      ok: true,
      user: testUser,
      message: "Email verified.",
    })

    const { POST } = await import(
      "@/app/api/mobile/auth/verify-code/route"
    )
    const response = await POST(
      jsonRequest("/api/mobile/auth/verify-code", {
        email: "creator@example.com",
        password: "password123",
        code: "123456",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      user: testUser,
      mobileToken: "mobile-token",
    })
    expect(verifyEmailCode).toHaveBeenCalledWith({
      userId: "user_123",
      code: "123456",
    })
  })

  it("rejects an invalid mobile email verification code", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      ok: false,
      reason: "email_unverified",
      message: "Verify your email.",
      user: { ...testUser, handle: null, displayName: null },
    })
    vi.mocked(verifyEmailCode).mockResolvedValue({
      ok: false,
      message: "Verification code is invalid or expired.",
    })

    const { POST } = await import(
      "@/app/api/mobile/auth/verify-code/route"
    )
    const response = await POST(
      jsonRequest("/api/mobile/auth/verify-code", {
        email: "creator@example.com",
        password: "password123",
        code: "123456",
      }),
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: "Verification code is invalid or expired.",
    })
    expect(createMobileSessionToken).not.toHaveBeenCalled()
  })

  it("resends a mobile verification code for an unverified account", async () => {
    const incompleteUser = { ...testUser, handle: null, displayName: null }

    vi.mocked(authenticateUser).mockResolvedValue({
      ok: false,
      reason: "email_unverified",
      message: "Verify your email.",
      user: incompleteUser,
    })

    const { POST } = await import(
      "@/app/api/mobile/auth/resend-verification-code/route"
    )
    const response = await POST(
      jsonRequest("/api/mobile/auth/resend-verification-code", {
        email: "creator@example.com",
        password: "password123",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      alreadyVerified: false,
    })
    expect(sendUserVerificationEmail).toHaveBeenCalledWith(incompleteUser)
  })

  it("reports already verified when resending a code for a verified account", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({ ok: true, user: testUser })

    const { POST } = await import(
      "@/app/api/mobile/auth/resend-verification-code/route"
    )
    const response = await POST(
      jsonRequest("/api/mobile/auth/resend-verification-code", {
        email: "creator@example.com",
        password: "password123",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      alreadyVerified: true,
    })
    expect(sendUserVerificationEmail).not.toHaveBeenCalled()
  })

  it("returns a mobile token for verified login", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({ ok: true, user: testUser })

    const { POST } = await import("@/app/api/mobile/auth/login/route")
    const response = await POST(
      jsonRequest("/api/mobile/auth/login", {
        email: "creator@example.com",
        password: "password123",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      user: testUser,
      profileComplete: true,
      mobileToken: "mobile-token",
    })
    expect(isProfileComplete(testUser)).toBe(true)
  })

  it("completes a mobile profile after authenticating credentials", async () => {
    const incompleteUser = { ...testUser, handle: null, displayName: null }

    vi.mocked(authenticateUser).mockResolvedValue({
      ok: true,
      user: incompleteUser,
    })
    vi.mocked(completeUserProfileForUser).mockResolvedValue({
      ok: true,
      user: testUser,
    })

    const { POST } = await import(
      "@/app/api/mobile/auth/complete-profile/route"
    )
    const response = await POST(
      jsonRequest("/api/mobile/auth/complete-profile", {
        email: "creator@example.com",
        password: "password123",
        displayName: "Creator",
        handle: "@Creator",
        onboardingIntent: "create",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
      user: testUser,
      mobileToken: "mobile-token",
    })
    expect(completeUserProfileForUser).toHaveBeenCalledWith("user_123", {
      displayName: "Creator",
      handle: "creator",
      onboardingIntent: "create",
    })
  })

  it("requests a mobile password reset email", async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue({
      ok: true,
      message: "If an account exists for that email, a reset link has been sent.",
    })

    const { POST } = await import(
      "@/app/api/mobile/auth/forgot-password/route"
    )
    const response = await POST(
      jsonRequest("/api/mobile/auth/forgot-password", {
        email: "Creator@Example.com",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
    })
    expect(requestPasswordReset).toHaveBeenCalledWith({
      email: "creator@example.com",
    })
  })

  it("resets a mobile password with a valid token", async () => {
    vi.mocked(resetPassword).mockResolvedValue({
      ok: true,
      message: "Password updated. Sign in with your new password.",
    })

    const { POST } = await import(
      "@/app/api/mobile/auth/reset-password/route"
    )
    const response = await POST(
      jsonRequest("/api/mobile/auth/reset-password", {
        token: "reset-token",
        password: "newpassword123",
      }),
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      ok: true,
    })
    expect(resetPassword).toHaveBeenCalledWith({
      token: "reset-token",
      password: "newpassword123",
    })
  })
})
