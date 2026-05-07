"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireSession } from "@/lib/auth"
import {
  createAdvertiserAccount,
  createPendingWalletFunding,
  getAdvertiserWorkspaceForUser,
  updateAdvertiserAccount,
  updateAdvertiserStripeCustomer,
  updateBrandFundingProfile,
} from "@/lib/advertiser-store"
import { env } from "@/lib/env"
import { getStripeClient } from "@/lib/stripe"

const accountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  websiteUrl: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || null)
    .pipe(z.url().nullable()),
  billingEmail: z.email(),
})

const profileSchema = z.object({
  profileId: z.string().min(1),
  status: z.enum(["draft", "active", "paused"]),
  displayName: z.string().trim().min(2).max(120),
  approvalMode: z.enum(["auto", "manual"]).default("auto"),
  payoutAmountDollars: z.coerce.number().min(0).max(100_000).optional(),
  dailyCapDollars: z.coerce.number().min(0).max(1_000_000).optional(),
  monthlyCapDollars: z.coerce.number().min(0).max(10_000_000).optional(),
  allowedCategories: z.string().trim().max(1_000).optional(),
  blockedCategories: z.string().trim().max(1_000).optional(),
  brandNames: z.string().trim().max(2_000).optional(),
  handles: z.string().trim().max(2_000).optional(),
  keywords: z.string().trim().max(2_000).optional(),
  hashtags: z.string().trim().max(2_000).optional(),
  domains: z.string().trim().max(2_000).optional(),
  products: z.string().trim().max(2_000).optional(),
  exclusions: z.string().trim().max(2_000).optional(),
  notes: z.string().trim().max(2_000).optional(),
})

const fundingSchema = z.object({
  amountDollars: z.coerce.number().min(25).max(250_000),
})

function buildErrorUrl(message: string) {
  return `/advertiser?error=${encodeURIComponent(message)}`
}

function dollarsToCents(value: number | undefined) {
  if (!value) {
    return null
  }

  return Math.round(value * 100)
}

function splitList(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 50)
}

function normalizeHandle(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase()
}

function normalizeHashtag(value: string) {
  return value.trim().replace(/^#+/, "").toLowerCase()
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
}

function buildTargets(parsed: z.infer<typeof profileSchema>) {
  return [
    ...splitList(parsed.brandNames).map((value) => ({
      kind: "brand_name" as const,
      value,
    })),
    ...splitList(parsed.handles).map((value) => ({
      kind: "handle" as const,
      value: normalizeHandle(value),
    })),
    ...splitList(parsed.keywords).map((value) => ({
      kind: "keyword" as const,
      value: value.toLowerCase(),
    })),
    ...splitList(parsed.hashtags).map((value) => ({
      kind: "hashtag" as const,
      value: normalizeHashtag(value),
    })),
    ...splitList(parsed.domains).map((value) => ({
      kind: "domain" as const,
      value: normalizeDomain(value),
    })),
    ...splitList(parsed.products).map((value) => ({
      kind: "product" as const,
      value,
    })),
    ...splitList(parsed.exclusions).map((value) => ({
      kind: "exclusion" as const,
      value: value.toLowerCase(),
    })),
  ]
}

export async function createAdvertiserAccountAction(formData: FormData) {
  const session = await requireSession()
  const parsed = accountSchema.safeParse({
    name: formData.get("name"),
    websiteUrl: formData.get("websiteUrl"),
    billingEmail: formData.get("billingEmail"),
  })

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Check the advertiser account details."

    redirect(buildErrorUrl(message))
  }

  const existing = await getAdvertiserWorkspaceForUser(session.id)

  if (existing) {
    redirect("/advertiser")
  }

  await createAdvertiserAccount({
    ownerUserId: session.id,
    name: parsed.data.name,
    websiteUrl: parsed.data.websiteUrl,
    billingEmail: parsed.data.billingEmail,
  })

  revalidatePath("/advertiser")
  redirect("/advertiser")
}

export async function saveAdvertiserAccountAction(formData: FormData) {
  const session = await requireSession()
  const workspace = await getAdvertiserWorkspaceForUser(session.id)

  if (!workspace) {
    redirect(buildErrorUrl("Create an advertiser account before saving account details."))
  }

  const parsed = accountSchema.safeParse({
    name: formData.get("name"),
    websiteUrl: formData.get("websiteUrl"),
    billingEmail: formData.get("billingEmail"),
  })

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Check the advertiser account details."

    redirect(buildErrorUrl(message))
  }

  await updateAdvertiserAccount({
    advertiserAccountId: workspace.account.id,
    name: parsed.data.name,
    websiteUrl: parsed.data.websiteUrl,
    billingEmail: parsed.data.billingEmail,
  })

  revalidatePath("/advertiser")
  redirect("/advertiser?tab=account&saved=account")
}

export async function saveBrandFundingProfileAction(formData: FormData) {
  const session = await requireSession()
  const workspace = await getAdvertiserWorkspaceForUser(session.id)

  if (!workspace?.profile) {
    redirect(buildErrorUrl("Create an advertiser account before saving preferences."))
  }

  const parsed = profileSchema.safeParse({
    profileId: formData.get("profileId"),
    status: formData.get("status"),
    displayName: formData.get("displayName"),
    approvalMode: formData.get("approvalMode"),
    payoutAmountDollars: formData.get("payoutAmountDollars"),
    dailyCapDollars: formData.get("dailyCapDollars"),
    monthlyCapDollars: formData.get("monthlyCapDollars"),
    allowedCategories: formData.get("allowedCategories"),
    blockedCategories: formData.get("blockedCategories"),
    brandNames: formData.get("brandNames"),
    handles: formData.get("handles"),
    keywords: formData.get("keywords"),
    hashtags: formData.get("hashtags"),
    domains: formData.get("domains"),
    products: formData.get("products"),
    exclusions: formData.get("exclusions"),
    notes: formData.get("notes"),
  })

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Check the funding preferences."

    redirect(buildErrorUrl(message))
  }

  await updateBrandFundingProfile({
    profileId: parsed.data.profileId,
    advertiserAccountId: workspace.account.id,
    status: parsed.data.status,
    displayName: parsed.data.displayName,
    approvalMode: parsed.data.approvalMode,
    payoutAmountCents: dollarsToCents(parsed.data.payoutAmountDollars),
    dailyCapCents: dollarsToCents(parsed.data.dailyCapDollars),
    monthlyCapCents: dollarsToCents(parsed.data.monthlyCapDollars),
    allowedCategories: parsed.data.allowedCategories || null,
    blockedCategories: parsed.data.blockedCategories || null,
    notes: parsed.data.notes || null,
    targets: buildTargets(parsed.data),
  })

  revalidatePath("/advertiser")
  redirect("/advertiser?saved=preferences")
}

async function ensureStripeCustomer() {
  const session = await requireSession()
  const workspace = await getAdvertiserWorkspaceForUser(session.id)

  if (!workspace) {
    redirect(buildErrorUrl("Create an advertiser account before adding funds."))
  }

  const stripe = getStripeClient()

  if (!stripe) {
    redirect(buildErrorUrl("Payment processing is not configured yet."))
  }

  if (workspace.account.stripeCustomerId) {
    return {
      stripe,
      session,
      workspace,
      customerId: workspace.account.stripeCustomerId,
    }
  }

  const customer = await stripe.customers.create({
    email: workspace.account.billingEmail,
    name: workspace.account.name,
    metadata: {
      advertiserAccountId: workspace.account.id,
      ownerUserId: session.id,
    },
  })

  await updateAdvertiserStripeCustomer({
    advertiserAccountId: workspace.account.id,
    stripeCustomerId: customer.id,
  })

  return {
    stripe,
    session,
    workspace,
    customerId: customer.id,
  }
}

export async function startAdvertiserFundingAction(formData: FormData) {
  const parsed = fundingSchema.safeParse({
    amountDollars: formData.get("amountDollars"),
  })

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Choose a funding amount."

    redirect(buildErrorUrl(message))
  }

  const amountCents = Math.round(parsed.data.amountDollars * 100)
  const { customerId, stripe, workspace } = await ensureStripeCustomer()
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    success_url: `${env.NEXT_PUBLIC_APP_URL}/advertiser?funding=success`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/advertiser?funding=cancelled`,
    client_reference_id: workspace.account.id,
    metadata: {
      flow: "advertiser_wallet_funding",
      advertiserAccountId: workspace.account.id,
      amountCents: String(amountCents),
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: "Advertiser wallet funding",
            description: "Non-transferable ad budget for brand funding matches.",
          },
        },
      },
    ],
  })

  await createPendingWalletFunding({
    advertiserAccountId: workspace.account.id,
    amountCents,
    currency: "usd",
    stripeCheckoutSessionId: checkoutSession.id,
  })

  if (!checkoutSession.url) {
    redirect(buildErrorUrl("Payment processing did not return a checkout URL."))
  }

  redirect(checkoutSession.url)
}

export async function startAdvertiserPaymentMethodAction() {
  const { customerId, stripe, workspace } = await ensureStripeCustomer()
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    success_url: `${env.NEXT_PUBLIC_APP_URL}/advertiser?payment_method=success`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/advertiser?payment_method=cancelled`,
    client_reference_id: workspace.account.id,
    metadata: {
      flow: "advertiser_payment_method_setup",
      advertiserAccountId: workspace.account.id,
    },
  })

  if (!checkoutSession.url) {
    redirect(buildErrorUrl("Payment processing did not return a checkout URL."))
  }

  redirect(checkoutSession.url)
}
