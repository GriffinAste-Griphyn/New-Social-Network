import Stripe from "stripe"

import { env } from "@/lib/env"

let stripeClient: Stripe | null | undefined

export function getStripeClient() {
  if (stripeClient !== undefined) {
    return stripeClient
  }

  if (!env.STRIPE_SECRET_KEY) {
    stripeClient = null
    return stripeClient
  }

  stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-04-22.dahlia",
  })

  return stripeClient
}
