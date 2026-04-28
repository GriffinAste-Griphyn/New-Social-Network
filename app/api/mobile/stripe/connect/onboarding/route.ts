import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { createCreatorStripeOnboardingUrl } from "@/lib/stripe-connect"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const url = await createCreatorStripeOnboardingUrl({
      session,
      refreshUrl: "newsocialnetwork://profile?stripe=refresh",
      returnUrl: "newsocialnetwork://profile?stripe=returned",
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
