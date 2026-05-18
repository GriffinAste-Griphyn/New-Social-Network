import { NextResponse } from "next/server"

import { createMobileSessionToken, isProfileComplete } from "@/lib/auth"
import { loginSchema } from "@/lib/auth-validators"
import { sendUserVerificationEmail } from "@/lib/email-verification"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { authenticateUser } from "@/lib/user-store"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:auth:check-verification-ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.authLoginIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid email and password." },
      { status: 400 },
    )
  }

  const result = await authenticateUser(parsed.data)

  if (!result.ok) {
    if ("reason" in result && result.reason === "email_unverified") {
      try {
        await sendUserVerificationEmail(result.user)
      } catch (error) {
        const message =
          error instanceof Error
            ? `Email is not verified, and resend failed: ${error.message}`
            : "Email is not verified, and resend failed."

        return NextResponse.json({ error: message }, { status: 502 })
      }

      return NextResponse.json(
        {
          error:
            "Email is not verified yet. We sent you a fresh verification code.",
        },
        { status: 403 },
      )
    }

    return NextResponse.json({ error: result.message }, { status: 401 })
  }

  return NextResponse.json({
    ok: true,
    user: result.user,
    profileComplete: isProfileComplete(result.user),
    mobileToken: await createMobileSessionToken(result.user, request),
  })
}
