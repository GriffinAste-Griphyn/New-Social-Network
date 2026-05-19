"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { getSession, isProfileComplete } from "@/lib/auth"
import {
  buildAppUrl,
  createCreatorStripeOnboardingUrl,
  syncCreatorStripeAccount,
} from "@/lib/stripe-connect"
import {
  assertSameOriginAction,
  enforceActionRateLimits,
  mutationRateLimits,
} from "@/lib/request-security"

function buildPayoutErrorUrl(message: string) {
  return `/creator/payouts?error=${encodeURIComponent(message)}`
}

async function requireCreatorPayoutSession() {
  const session = await getSession()

  if (!session) {
    redirect("/creator/login?next=%2Fcreator%2Fpayouts")
  }

  if (!isProfileComplete(session)) {
    redirect("/onboarding/profile?next=%2Fcreator%2Fpayouts")
  }

  return session
}

async function enforcePayoutOrigin() {
  try {
    await assertSameOriginAction()
  } catch (error) {
    redirect(
      buildPayoutErrorUrl(
        error instanceof Error ? error.message : "Invalid request.",
      ),
    )
  }
}

async function enforcePayoutRateLimit(userId: string) {
  try {
    await enforceActionRateLimits([
      {
        bucket: "web:payouts:stripe",
        subject: userId,
        options: mutationRateLimits.stripeWriteUser,
      },
    ])
  } catch (error) {
    redirect(
      buildPayoutErrorUrl(
        error instanceof Error ? error.message : "Invalid request.",
      ),
    )
  }
}

export async function startCreatorStripeOnboardingAction() {
  await enforcePayoutOrigin()
  const session = await requireCreatorPayoutSession()
  await enforcePayoutRateLimit(session.id)
  let url: string

  try {
    url = await createCreatorStripeOnboardingUrl({
      session,
      refreshUrl: buildAppUrl("/creator/payouts?stripe=refresh"),
      returnUrl: buildAppUrl("/creator/payouts?stripe=returned"),
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
  await enforcePayoutOrigin()
  const session = await requireCreatorPayoutSession()
  await enforcePayoutRateLimit(session.id)

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

  revalidatePath("/creator/payouts")
  redirect("/creator/payouts?stripe=synced")
}
