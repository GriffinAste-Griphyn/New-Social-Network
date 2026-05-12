import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  postWalletFundingFromStripe,
  upsertAdvertiserPaymentMethod,
  voidPendingWalletFundingFromStripe,
} from "@/lib/advertiser-store"
import { syncCreatorLedgerTransferFromWebhook } from "@/lib/creator-earnings"
import { getStripeClient } from "@/lib/stripe"
import { syncCreatorStripeAccountFromWebhook } from "@/lib/stripe-connect"

vi.mock("@/lib/env", () => ({
  env: {
    STRIPE_WEBHOOK_SECRET: "whsec_test",
  },
}))

vi.mock("@/lib/stripe", () => ({
  getStripeClient: vi.fn(),
}))

vi.mock("@/lib/advertiser-store", () => ({
  postWalletFundingFromStripe: vi.fn(),
  upsertAdvertiserPaymentMethod: vi.fn(),
  voidPendingWalletFundingFromStripe: vi.fn(),
}))

vi.mock("@/lib/creator-earnings", () => ({
  syncCreatorLedgerTransferFromWebhook: vi.fn(),
}))

vi.mock("@/lib/stripe-connect", () => ({
  syncCreatorStripeAccountFromWebhook: vi.fn(),
}))

const constructEvent = vi.fn()
const retrieveSetupIntent = vi.fn()
const retrievePaymentMethod = vi.fn()
const updateCustomer = vi.fn()

function webhookRequest(signature = "sig_test") {
  return new Request("https://app.example.com/api/stripe/webhook", {
    method: "POST",
    headers: {
      "stripe-signature": signature,
    },
    body: JSON.stringify({ id: "evt_123" }),
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("Stripe webhook API", () => {
  beforeEach(() => {
    vi.mocked(getStripeClient).mockReturnValue({
      webhooks: {
        constructEvent,
      },
      setupIntents: {
        retrieve: retrieveSetupIntent,
      },
      paymentMethods: {
        retrieve: retrievePaymentMethod,
      },
      customers: {
        update: updateCustomer,
      },
    } as unknown as ReturnType<typeof getStripeClient>)
  })

  it("rejects requests without a Stripe signature", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const response = await POST(
      new Request("https://app.example.com/api/stripe/webhook", {
        method: "POST",
        body: "{}",
      }),
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: "Missing Stripe signature.",
    })
  })

  it("posts advertiser wallet funding for checkout completion", async () => {
    constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          object: "checkout.session",
          id: "cs_test",
          amount_total: 2500,
          currency: "usd",
          payment_intent: "pi_test",
          metadata: {
            flow: "advertiser_wallet_funding",
            advertiserAccountId: "advertiser_123",
          },
        },
      },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toEqual({ received: true })
    expect(postWalletFundingFromStripe).toHaveBeenCalledWith({
      advertiserAccountId: "advertiser_123",
      amountCents: 2500,
      currency: "usd",
      stripeCheckoutSessionId: "cs_test",
      stripePaymentIntentId: "pi_test",
    })
  })

  it("stores advertiser payment method setup from checkout", async () => {
    constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          object: "checkout.session",
          id: "cs_setup",
          customer: "cus_test",
          setup_intent: "seti_test",
          metadata: {
            flow: "advertiser_payment_method_setup",
            advertiserAccountId: "advertiser_123",
          },
        },
      },
    })
    retrieveSetupIntent.mockResolvedValue({
      payment_method: {
        id: "pm_card",
        type: "card",
        card: {
          brand: "visa",
          last4: "4242",
          exp_month: 12,
          exp_year: 2030,
        },
        billing_details: {
          name: "Brand Owner",
          email: "brand@example.com",
        },
      },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    expect(updateCustomer).toHaveBeenCalledWith("cus_test", {
      invoice_settings: {
        default_payment_method: "pm_card",
      },
    })
    expect(upsertAdvertiserPaymentMethod).toHaveBeenCalledWith({
      advertiserAccountId: "advertiser_123",
      stripeCustomerId: "cus_test",
      stripePaymentMethodId: "pm_card",
      type: "card",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      billingName: "Brand Owner",
      billingEmail: "brand@example.com",
    })
  })

  it("voids pending wallet funding when checkout expires", async () => {
    constructEvent.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: {
          object: "checkout.session",
          id: "cs_expired",
          metadata: {
            flow: "advertiser_wallet_funding",
            advertiserAccountId: "advertiser_123",
          },
        },
      },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    expect(voidPendingWalletFundingFromStripe).toHaveBeenCalledWith({
      stripeCheckoutSessionId: "cs_expired",
    })
  })

  it("syncs creator Stripe accounts and ledger transfers", async () => {
    const accountEventObject = {
      object: "v2.core.account",
      id: "acct_test",
    }
    constructEvent.mockReturnValueOnce({
      type: "v2.core.account.updated",
      data: { object: accountEventObject },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const accountResponse = await POST(webhookRequest())

    expect(accountResponse.status).toBe(200)
    expect(syncCreatorStripeAccountFromWebhook).toHaveBeenCalledWith(
      accountEventObject,
    )

    const transferObject = {
      object: "transfer",
      id: "tr_test",
    }
    constructEvent.mockReturnValueOnce({
      type: "transfer.created",
      data: { object: transferObject },
    })

    const transferResponse = await POST(webhookRequest())

    expect(transferResponse.status).toBe(200)
    expect(syncCreatorLedgerTransferFromWebhook).toHaveBeenCalledWith(
      transferObject,
    )
  })
})
