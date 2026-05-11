import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { createCreatorStripeOnboardingUrl } from "@/lib/stripe-connect"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:stripe:onboarding:user",
      subject: session.id,
      options: mutationRateLimits.stripeWriteUser,
    },
    {
      bucket: "mobile:stripe:onboarding:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.stripeWriteUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  try {
    const url = await createCreatorStripeOnboardingUrl({
      session,
      refreshUrl: "ubeye://profile?stripe=refresh",
      returnUrl: "ubeye://profile?stripe=returned",
    })

    return NextResponse.json({ ok: true, url })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not start Stripe onboarding.",
      },
      { status: 400 },
    )
  }
}
