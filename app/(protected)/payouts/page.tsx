import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowLeft, RefreshCw, ShieldCheck, WalletCards } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  startCreatorStripeOnboardingAction,
  syncCreatorStripeAccountAction,
} from "@/lib/creator-payout-actions"
import { requireSession } from "@/lib/auth"
import { settleCreatorPayouts } from "@/lib/creator-earnings"
import { getCreatorStats } from "@/lib/creator-stats"
import {
  getCreatorStripeStatus,
  syncCreatorStripeAccount,
} from "@/lib/stripe-connect"

type PayoutsPageProps = {
  searchParams: Promise<{
    error?: string
    stripe?: string
  }>
}

function formatDate(value: Date | null) {
  if (!value) return "Not synced yet"

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value)
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function Flash({ error, stripe }: { error?: string; stripe?: string }) {
  const message =
    error ??
    (stripe === "returned"
      ? "Stripe onboarding returned. Your payout status is synced below."
      : stripe === "synced"
        ? "Stripe payout status synced."
        : stripe === "refresh"
          ? "That Stripe link expired. Start onboarding again."
          : null)

  if (!message) return null

  return (
    <div
      className={
        error
          ? "rounded-[8px] border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]"
          : "rounded-[8px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#166534]"
      }
    >
      {message}
    </div>
  )
}

export default async function PayoutsPage({ searchParams }: PayoutsPageProps) {
  const session = await requireSession("/payouts")
  const params = await searchParams
  const status =
    params.stripe === "returned"
      ? await syncCreatorStripeAccount(session.id)
          .then(async (syncedStatus) => {
            await settleCreatorPayouts(session.id)
            return syncedStatus
          })
          .catch(() => getCreatorStripeStatus(session.id))
      : await getCreatorStripeStatus(session.id)
  const stats = await getCreatorStats(session.id)
  const isConnected = Boolean(status.stripeConnectedAccountId)
  const isReady = status.stripePayoutsEnabled && status.stripeOnboardingComplete
  const statusLabel = isReady
    ? "Payouts ready"
    : isConnected
      ? "Action needed"
      : "Not connected"

  return (
    <main className="min-h-screen bg-[#f6f5f2] px-4 py-6 text-[#18181b] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/feed"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#52525b] hover:text-[#18181b]"
        >
          <ArrowLeft className="size-4" />
          Back to feed
        </Link>

        <div className="mt-5">
          <Flash error={params.error} stripe={params.stripe} />
        </div>

        <section className="mt-5 rounded-[8px] border border-[#e4e4e7] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-[#71717a]">
                Creator monetization
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                Stripe payouts
              </h1>
              <p className="mt-3 text-sm leading-6 text-[#71717a]">
                Connect a Stripe account so approved brand-match and ad-share
                earnings can be paid out without storing sensitive financial
                details in UBEYE.
              </p>
            </div>
            <div
              className={
                isReady
                  ? "rounded-full bg-[#dcfce7] px-3 py-1 text-sm font-medium text-[#166534]"
                  : "rounded-full bg-[#fef3c7] px-3 py-1 text-sm font-medium text-[#92400e]"
              }
            >
              {statusLabel}
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <StatusCard
              icon={<WalletCards className="size-5" />}
              label="Connected account"
              value={isConnected ? "Created" : "Missing"}
            />
            <StatusCard
              icon={<ShieldCheck className="size-5" />}
              label="Payout capability"
              value={status.stripePayoutsEnabled ? "Enabled" : "Pending"}
            />
            <StatusCard
              icon={<RefreshCw className="size-5" />}
              label="Last sync"
              value={formatDate(status.stripeUpdatedAt)}
            />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <StatusCard
              icon={<WalletCards className="size-5" />}
              label="Available"
              value={formatMoney(stats.earnings.availableCents)}
            />
            <StatusCard
              icon={<WalletCards className="size-5" />}
              label="Pending"
              value={formatMoney(stats.earnings.pendingCents)}
            />
            <StatusCard
              icon={<WalletCards className="size-5" />}
              label="Paid"
              value={formatMoney(stats.earnings.paidCents)}
            />
            <StatusCard
              icon={<WalletCards className="size-5" />}
              label="Reversed"
              value={formatMoney(stats.earnings.reversedCents)}
            />
          </div>

          {status.stripeRequirementsDue ? (
            <div className="mt-5 rounded-[8px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
              Stripe still needs account details before payouts are enabled.
              Continue onboarding to finish the remaining requirements.
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <form action={startCreatorStripeOnboardingAction}>
              <Button className="h-11 rounded-[8px] bg-[#635bff] px-5 text-white hover:bg-[#5148e5]">
                <WalletCards className="size-4" />
                {isConnected ? "Continue Stripe setup" : "Connect Stripe"}
              </Button>
            </form>
            {isConnected ? (
              <form action={syncCreatorStripeAccountAction}>
                <Button
                  variant="outline"
                  className="h-11 rounded-[8px] border-[#d4d4d8] bg-white px-5"
                >
                  <RefreshCw className="size-4" />
                  Sync and settle
                </Button>
              </form>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}

function StatusCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <article className="rounded-[8px] bg-[#f5f6f8] p-4">
      <div className="flex items-center justify-between gap-3 text-[#6b7280]">
        <p className="text-sm font-medium">{label}</p>
        {icon}
      </div>
      <p className="mt-3 text-xl font-semibold tracking-tight">{value}</p>
    </article>
  )
}
