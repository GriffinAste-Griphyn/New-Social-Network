import { NextResponse } from "next/server"

import { mobileSignupSchema, signupSchema } from "@/lib/auth-validators"
import { sendUserVerificationEmail } from "@/lib/email-verification"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { registerUser } from "@/lib/user-store"
import {
  currentLegalVersions,
  versionedLegalAcceptanceIosBuild,
} from "@/lib/legal"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:auth:signup-ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.authSignupIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const requestBody = await request.json().catch(() => null)
  const appBuild = Number(request.headers.get("x-ubeye-app-build"))
  const isLegacyIosBuild =
    Number.isInteger(appBuild) &&
    appBuild > 0 &&
    appBuild < versionedLegalAcceptanceIosBuild
  const parsed = isLegacyIosBuild
    ? signupSchema.safeParse(requestBody)
    : mobileSignupSchema.safeParse(requestBody)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Enter a valid email and password.",
      },
      { status: 400 },
    )
  }

  const signupInput = isLegacyIosBuild
    ? {
        ...parsed.data,
        acceptedTerms: true as const,
        termsVersion: currentLegalVersions.terms,
        communityGuidelinesVersion:
          currentLegalVersions.communityGuidelines,
        privacyPolicyVersion: currentLegalVersions.privacyPolicy,
      }
    : parsed.data
  const result = await registerUser(signupInput)

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }

  try {
    await sendUserVerificationEmail(result.user)
  } catch (error) {
    const message =
      error instanceof Error
        ? `Account created, but verification email failed: ${error.message}`
        : "Account created, but verification email failed."

    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    pendingEmail: result.user.email,
    message:
      "Enter the verification code we sent to your email.",
  })
}
