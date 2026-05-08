import { NextResponse } from "next/server"
import { z } from "zod"

import { createMobileSessionToken, isProfileComplete } from "@/lib/auth"
import { loginSchema, profileSetupSchema } from "@/lib/auth-validators"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import {
  authenticateUser,
  completeUserProfileForUser,
} from "@/lib/user-store"

export const runtime = "nodejs"

const mobileProfileSetupSchema = loginSchema.and(profileSetupSchema)

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:auth:complete-profile-ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.authLoginIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = mobileProfileSetupSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    const issue =
      parsed.error instanceof z.ZodError
        ? parsed.error.issues[0]?.message
        : undefined

    return NextResponse.json(
      { error: issue ?? "Check your profile details." },
      { status: 400 },
    )
  }

  const authResult = await authenticateUser({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: "reason" in authResult ? 403 : 401 },
    )
  }

  const result = await completeUserProfileForUser(authResult.user.id, {
    displayName: parsed.data.displayName,
    handle: parsed.data.handle,
    onboardingIntent: parsed.data.onboardingIntent,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    user: result.user,
    profileComplete: isProfileComplete(result.user),
    mobileToken: await createMobileSessionToken(result.user, request),
  })
}
