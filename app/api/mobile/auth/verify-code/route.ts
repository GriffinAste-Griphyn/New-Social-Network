import { NextResponse } from "next/server"
import { z } from "zod"

import { createMobileSessionToken, isProfileComplete } from "@/lib/auth"
import { loginSchema } from "@/lib/auth-validators"
import { verifyEmailCode } from "@/lib/email-verification"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { authenticateUser } from "@/lib/user-store"

export const runtime = "nodejs"

const verifyCodeSchema = loginSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/),
})

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:auth:verify-code-ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.authLoginIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = verifyCodeSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your email, password, and 6-digit verification code." },
      { status: 400 },
    )
  }

  const authResult = await authenticateUser({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (authResult.ok) {
    return NextResponse.json({
      ok: true,
      user: {
        ...authResult.user,
        avatarUrl: publicProfileAvatarUrl(authResult.user.avatarUrl, request),
      },
      profileComplete: isProfileComplete(authResult.user),
      mobileToken: await createMobileSessionToken(authResult.user, request),
    })
  }

  if (!("reason" in authResult) || authResult.reason !== "email_unverified") {
    return NextResponse.json({ error: authResult.message }, { status: 401 })
  }

  const verificationResult = await verifyEmailCode({
    userId: authResult.user.id,
    code: parsed.data.code,
  })

  if (!verificationResult.ok || !verificationResult.user) {
    return NextResponse.json(
      { error: verificationResult.message },
      { status: 400 },
    )
  }

  return NextResponse.json({
    ok: true,
    user: {
      ...verificationResult.user,
      avatarUrl: publicProfileAvatarUrl(verificationResult.user.avatarUrl, request),
    },
    profileComplete: isProfileComplete(verificationResult.user),
    mobileToken: await createMobileSessionToken(verificationResult.user, request),
  })
}
