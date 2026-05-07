import { NextResponse } from "next/server"
import type Stripe from "stripe"

import { env } from "@/lib/env"
import {
  postWalletFundingFromStripe,
  upsertAdvertiserPaymentMethod,
} from "@/lib/advertiser-store"
import { syncCreatorLedgerTransferFromWebhook } from "@/lib/creator-earnings"
import { getStripeClient } from "@/lib/stripe"
import { syncCreatorStripeAccountFromWebhook } from "@/lib/stripe-connect"

export const runtime = "nodejs"

async function handleCheckoutCompleted(
  stripe: NonNullable<ReturnType<typeof getStripeClient>>,
  session: Stripe.Checkout.Session,
) {
  if (session.metadata?.flow !== "advertiser_wallet_funding") {
    if (session.metadata?.flow === "advertiser_payment_method_setup") {
      await handlePaymentMethodSetupCompleted(stripe, session)
    }

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

async function handlePaymentMethodSetupCompleted(
  stripe: NonNullable<ReturnType<typeof getStripeClient>>,
  session: Stripe.Checkout.Session,
) {
  const advertiserAccountId = session.metadata?.advertiserAccountId
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id
  const setupIntentId =
    typeof session.setup_intent === "string"
      ? session.setup_intent
      : session.setup_intent?.id

  if (!advertiserAccountId || !stripeCustomerId || !setupIntentId) {
    throw new Error("Stripe session is missing payment method setup metadata.")
  }

  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, {
    expand: ["payment_method"],
  })
  const paymentMethod =
    typeof setupIntent.payment_method === "string"
      ? await stripe.paymentMethods.retrieve(setupIntent.payment_method)
      : setupIntent.payment_method

  if (!paymentMethod) {
    throw new Error("Stripe setup intent did not include a payment method.")
  }

  await stripe.customers.update(stripeCustomerId, {
    invoice_settings: {
      default_payment_method: paymentMethod.id,
    },
  })

  await upsertAdvertiserPaymentMethod({
    advertiserAccountId,
    stripeCustomerId,
    stripePaymentMethodId: paymentMethod.id,
    type: paymentMethod.type,
    brand: paymentMethod.card?.brand ?? null,
    last4: paymentMethod.card?.last4 ?? null,
    expMonth: paymentMethod.card?.exp_month ?? null,
    expYear: paymentMethod.card?.exp_year ?? null,
    billingName: paymentMethod.billing_details.name ?? null,
    billingEmail: paymentMethod.billing_details.email ?? null,
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
    await handleCheckoutCompleted(stripe, event.data.object)
  }

  if (stripeObject.object === "v2.core.account") {
    await syncCreatorStripeAccountFromWebhook(
      stripeObject as Parameters<typeof syncCreatorStripeAccountFromWebhook>[0],
    )
  }

  if (stripeObject.object === "transfer") {
    await syncCreatorLedgerTransferFromWebhook(
      event.data.object as Stripe.Transfer,
    )
  }

  return NextResponse.json({ received: true })
}
