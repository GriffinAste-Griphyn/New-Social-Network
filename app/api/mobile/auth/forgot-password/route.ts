import { NextResponse } from "next/server"

import { passwordResetRequestSchema } from "@/lib/auth-validators"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { requestPasswordReset } from "@/lib/user-store"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:auth:forgot-password-ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.authResetIp,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = passwordResetRequestSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    )
  }

  try {
    const result = await requestPasswordReset(parsed.data)

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 429 })
    }

    return NextResponse.json({
      ok: true,
      message: result.message,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Could not send reset email: ${error.message}`
            : "Could not send reset email.",
      },
      { status: 502 },
    )
  }
}
