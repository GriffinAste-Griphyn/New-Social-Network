import { NextResponse } from "next/server"

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
      bucket: "mobile:auth:resend-verification-code-ip",
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

  const authResult = await authenticateUser(parsed.data)

  if (authResult.ok) {
    return NextResponse.json({
      ok: true,
      alreadyVerified: true,
      message: "Email is already verified. Sign in to continue.",
    })
  }

  if (!("reason" in authResult) || authResult.reason !== "email_unverified") {
    return NextResponse.json({ error: authResult.message }, { status: 401 })
  }

  try {
    await sendUserVerificationEmail(authResult.user)
  } catch (error) {
    const message =
      error instanceof Error
        ? `Could not send verification code: ${error.message}`
        : "Could not send verification code."

    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    alreadyVerified: false,
    message: "We sent you a new verification code.",
  })
}
