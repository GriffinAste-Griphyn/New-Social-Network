import { eq } from "drizzle-orm"

import type { CompleteAuthSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { creatorProfiles } from "@/lib/db/schema"
import { env } from "@/lib/env"
import { getStripeClient } from "@/lib/stripe"

type StripeV2Account = {
  id: string
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: {
          stripe_transfers?: {
            status?: string
          }
        }
      }
    }
  }
  metadata?: Record<string, string>
  requirements?: {
    entries?: Array<{
      reference?: {
        type?: string
        resource?: string
      }
      minimum_deadline?: {
        status?: string
      }
      impact?: {
        restricts_capabilities?: Array<{
          capability?: string
          configuration?: string
          deadline?: {
            status?: string
          }
        }>
      }
    }>
    summary?: {
      minimum_deadline?: {
        status?: string
      }
    }
  }
}

export type CreatorStripeStatus = {
  stripeConnectedAccountId: string | null
  stripePayoutsEnabled: boolean
  stripeOnboardingComplete: boolean
  stripeRequirementsStatus: string | null
  stripeRequirementsDue: string | null
  stripeConnectedAt: Date | null
  stripeUpdatedAt: Date | null
}

export async function getCreatorStripeStatus(
  userId: string,
): Promise<CreatorStripeStatus> {
  const [profile] = await getDb()
    .select({
      stripeConnectedAccountId: creatorProfiles.stripeConnectedAccountId,
      stripePayoutsEnabled: creatorProfiles.stripePayoutsEnabled,
      stripeOnboardingComplete: creatorProfiles.stripeOnboardingComplete,
      stripeRequirementsStatus: creatorProfiles.stripeRequirementsStatus,
      stripeRequirementsDue: creatorProfiles.stripeRequirementsDue,
      stripeConnectedAt: creatorProfiles.stripeConnectedAt,
      stripeUpdatedAt: creatorProfiles.stripeUpdatedAt,
    })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1)

  return {
    stripeConnectedAccountId: profile?.stripeConnectedAccountId ?? null,
    stripePayoutsEnabled: profile?.stripePayoutsEnabled ?? false,
    stripeOnboardingComplete: profile?.stripeOnboardingComplete ?? false,
    stripeRequirementsStatus: profile?.stripeRequirementsStatus ?? null,
    stripeRequirementsDue: profile?.stripeRequirementsDue ?? null,
    stripeConnectedAt: profile?.stripeConnectedAt ?? null,
    stripeUpdatedAt: profile?.stripeUpdatedAt ?? null,
  }
}

function getStripeV2(stripe: NonNullable<ReturnType<typeof getStripeClient>>) {
  return stripe.v2 as unknown as {
    core: {
      accounts: {
        create: (params: Record<string, unknown>) => Promise<StripeV2Account>
        retrieve: (
          accountId: string,
          params?: Record<string, unknown>,
        ) => Promise<StripeV2Account>
      }
      accountLinks: {
        create: (params: Record<string, unknown>) => Promise<{ url: string }>
      }
    }
  }
}

function serializeRequirementsDue(account: StripeV2Account) {
  const entries = account.requirements?.entries ?? []
  const due = entries
    .filter((entry) => {
      const status =
        entry.minimum_deadline?.status ??
        entry.impact?.restricts_capabilities?.[0]?.deadline?.status

      return status === "currently_due" || status === "past_due"
    })
    .map((entry) => entry.reference?.resource ?? entry.reference?.type)
    .filter(Boolean)

  return due.length > 0 ? JSON.stringify(due) : null
}

function getRequirementsStatus(account: StripeV2Account) {
  return account.requirements?.summary?.minimum_deadline?.status ?? null
}

function isStripePayoutsEnabled(account: StripeV2Account) {
  return (
    account.configuration?.recipient?.capabilities?.stripe_balance
      ?.stripe_transfers?.status === "active"
  )
}

async function upsertCreatorStripeAccount(input: {
  userId: string
  account: StripeV2Account
}) {
  const requirementsStatus = getRequirementsStatus(input.account)
  const requirementsDue = serializeRequirementsDue(input.account)
  const payoutsEnabled = isStripePayoutsEnabled(input.account)
  const onboardingComplete =
    payoutsEnabled ||
    (requirementsStatus !== "currently_due" && requirementsStatus !== "past_due")
  const now = new Date()

  await getDb()
    .insert(creatorProfiles)
    .values({
      userId: input.userId,
      monetizationEnabled: payoutsEnabled,
      stripeConnectedAccountId: input.account.id,
      stripePayoutsEnabled: payoutsEnabled,
      stripeOnboardingComplete: onboardingComplete,
      stripeRequirementsStatus: requirementsStatus,
      stripeRequirementsDue: requirementsDue,
      stripeConnectedAt: now,
      stripeUpdatedAt: now,
    })
    .onConflictDoUpdate({
      target: creatorProfiles.userId,
      set: {
        monetizationEnabled: payoutsEnabled,
        stripeConnectedAccountId: input.account.id,
        stripePayoutsEnabled: payoutsEnabled,
        stripeOnboardingComplete: onboardingComplete,
        stripeRequirementsStatus: requirementsStatus,
        stripeRequirementsDue: requirementsDue,
        stripeConnectedAt: now,
        stripeUpdatedAt: now,
        updatedAt: now,
      },
    })
}

async function createConnectedAccount(session: CompleteAuthSession) {
  const stripe = getStripeClient()

  if (!stripe) {
    throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY first.")
  }

  return getStripeV2(stripe).core.accounts.create({
    contact_email: session.email,
    dashboard: "express",
    display_name: session.displayName,
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              requested: true,
            },
          },
        },
      },
    },
    defaults: {
      currency: "usd",
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
      profile: {
        product_description:
          "Creator payouts for New Social Network story earnings.",
      },
    },
    metadata: {
      userId: session.id,
      handle: session.handle,
      flow: "creator_payouts",
    },
  })
}

async function getOrCreateConnectedAccount(session: CompleteAuthSession) {
  const existing = await getCreatorStripeStatus(session.id)

  if (existing.stripeConnectedAccountId) {
    return existing.stripeConnectedAccountId
  }

  const account = await createConnectedAccount(session)

  await upsertCreatorStripeAccount({
    userId: session.id,
    account,
  })

  return account.id
}

export async function createCreatorStripeOnboardingUrl(input: {
  session: CompleteAuthSession
  refreshUrl: string
  returnUrl: string
}) {
  const stripe = getStripeClient()

  if (!stripe) {
    throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY first.")
  }

  const accountId = await getOrCreateConnectedAccount(input.session)
  const link = await getStripeV2(stripe).core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
        collection_options: {
          fields: "eventually_due",
          future_requirements: "include",
        },
      },
    },
  })

  return link.url
}

export async function syncCreatorStripeAccount(userId: string) {
  const current = await getCreatorStripeStatus(userId)

  if (!current.stripeConnectedAccountId) {
    return current
  }

  const stripe = getStripeClient()

  if (!stripe) {
    throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY first.")
  }

  const account = await getStripeV2(stripe).core.accounts.retrieve(
    current.stripeConnectedAccountId,
    {
      include: ["configuration.recipient", "requirements"],
    },
  )

  await upsertCreatorStripeAccount({ userId, account })

  return getCreatorStripeStatus(userId)
}

export async function syncCreatorStripeAccountFromWebhook(account: StripeV2Account) {
  const userId = account.metadata?.userId

  if (!userId) {
    return
  }

  await upsertCreatorStripeAccount({ userId, account })
}

export function buildAppUrl(pathname: string) {
  return new URL(pathname, env.NEXT_PUBLIC_APP_URL).toString()
}
