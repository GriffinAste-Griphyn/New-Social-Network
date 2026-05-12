import { NextResponse } from "next/server"

import { passwordResetSchema } from "@/lib/auth-validators"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { resetPassword } from "@/lib/user-store"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:auth:reset-password-ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.authResetIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = passwordResetSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          "Enter a valid reset token and new password.",
      },
      { status: 400 },
    )
  }

  const result = await resetPassword(parsed.data)

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    message: result.message,
  })
}
