import { NextResponse } from "next/server"
import type Stripe from "stripe"

import { env } from "@/lib/env"
import { postWalletFundingFromStripe } from "@/lib/advertiser-store"
import { getStripeClient } from "@/lib/stripe"
import { syncCreatorStripeAccountFromWebhook } from "@/lib/stripe-connect"

export const runtime = "nodejs"

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.metadata?.flow !== "advertiser_wallet_funding") {
    return
  }

  const advertiserAccountId = session.metadata.advertiserAccountId
  const amountCents = session.amount_total ?? Number(session.metadata.amountCents)

  if (!advertiserAccountId || !amountCents) {
    throw new Error("Stripe session is missing wallet funding metadata.")
  }

  await postWalletFundingFromStripe({
    advertiserAccountId,
    amountCents,
    currency: session.currency ?? "usd",
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
  })
}

export async function POST(request: Request) {
  const stripe = getStripeClient()

  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured." },
      { status: 500 },
    )
  }

  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe signature." },
      { status: 400 },
    )
  }

  const rawBody = await request.text()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    )
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid Stripe webhook.",
      },
      { status: 400 },
    )
  }

  const stripeObject = event.data.object as { object?: string }

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object)
  }

  if (stripeObject.object === "v2.core.account") {
    await syncCreatorStripeAccountFromWebhook(
      stripeObject as Parameters<typeof syncCreatorStripeAccountFromWebhook>[0],
    )
  }

  return NextResponse.json({ received: true })
}
