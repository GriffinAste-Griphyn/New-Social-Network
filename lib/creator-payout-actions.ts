"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { requireSession } from "@/lib/auth"
import {
  buildAppUrl,
  createCreatorStripeOnboardingUrl,
  syncCreatorStripeAccount,
} from "@/lib/stripe-connect"

function buildPayoutErrorUrl(message: string) {
  return `/payouts?error=${encodeURIComponent(message)}`
}

export async function startCreatorStripeOnboardingAction() {
  const session = await requireSession("/payouts")
  let url: string

  try {
    url = await createCreatorStripeOnboardingUrl({
      session,
      refreshUrl: buildAppUrl("/payouts?stripe=refresh"),
      returnUrl: buildAppUrl("/payouts?stripe=returned"),
    })
  } catch (error) {
    redirect(
      buildPayoutErrorUrl(
        error instanceof Error
          ? error.message
          : "Could not start Stripe onboarding.",
      ),
    )
  }

  redirect(url)
}

export async function syncCreatorStripeAccountAction() {
  const session = await requireSession("/payouts")

  try {
    await syncCreatorStripeAccount(session.id)
  } catch (error) {
    redirect(
      buildPayoutErrorUrl(
        error instanceof Error
          ? error.message
          : "Could not sync Stripe payout status.",
      ),
    )
  }

  revalidatePath("/payouts")
  redirect("/payouts?stripe=synced")
}
