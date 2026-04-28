import Link from "next/link"
import { Plus, Save } from "lucide-react"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  createAdvertiserAccountAction,
  saveBrandFundingProfileAction,
  startAdvertiserFundingAction,
} from "@/lib/advertiser-actions"
import type {
  AdvertiserPayoutReport,
  BrandFundingTarget,
} from "@/lib/advertiser-store"
import { getAdvertiserWorkspaceForUser } from "@/lib/advertiser-store"
import { requireSession } from "@/lib/auth"

type AdvertiserPageProps = {
  searchParams: Promise<{
    error?: string
    funding?: string
    saved?: string
    tab?: string
  }>
}

type AdvertiserTab = "settings" | "reporting"

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function centsToDollars(value: number | null) {
  if (!value) return ""

  return String(value / 100)
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function resolveAdvertiserTab(value: string | undefined): AdvertiserTab {
  return value === "reporting" ? "reporting" : "settings"
}

function targetValues(
  targets: BrandFundingTarget[],
  kind: BrandFundingTarget["kind"],
) {
  return targets
    .filter((target) => target.kind === kind)
    .map((target) => target.value)
    .join(", ")
}

function Flash({
  error,
  funding,
  saved,
}: {
  error?: string
  funding?: string
  saved?: string
}) {
  const message =
    error ??
    (funding === "success"
      ? "Funds are processing. Your balance updates after payment confirms."
      : saved === "preferences"
        ? "Payout settings saved."
        : null)

  if (!message) {
    return null
  }

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

function EmptyAdvertiserState({ email }: { email: string }) {
  return (
    <main className="min-h-screen bg-[#f6f5f2] px-4 py-6 text-[#18181b] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-sm text-[#71717a]">Advertiser portal</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Create advertiser account
          </h1>
        </header>

        <form
          action={createAdvertiserAccountAction}
          className="rounded-[8px] border border-[#e4e4e7] bg-white p-6 shadow-sm"
        >
          <div className="max-w-xl">
            <h2 className="text-xl font-semibold tracking-tight">
              Set up your brand
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#71717a]">
              Create the account you will fund for creator payouts.
            </p>
          </div>

          <div className="mt-6 grid gap-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Company or brand name
              </label>
              <Input id="name" name="name" required className="h-11 rounded-[8px]" />
            </div>
            <div className="space-y-2">
              <label htmlFor="websiteUrl" className="text-sm font-medium">
                Website
              </label>
              <Input
                id="websiteUrl"
                name="websiteUrl"
                type="url"
                placeholder="https://example.com"
                className="h-11 rounded-[8px]"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="billingEmail" className="text-sm font-medium">
                Billing email
              </label>
              <Input
                id="billingEmail"
                name="billingEmail"
                type="email"
                defaultValue={email}
                required
                className="h-11 rounded-[8px]"
              />
            </div>
          </div>

          <div className="mt-6">
            <AuthSubmitButton
              idleLabel="Create account"
              pendingLabel="Creating..."
            />
          </div>
        </form>
      </div>
    </main>
  )
}

export default async function AdvertiserPage({
  searchParams,
}: AdvertiserPageProps) {
  const session = await requireSession("/advertiser")
  const params = await searchParams
  const workspace = await getAdvertiserWorkspaceForUser(session.id)
  const activeTab = resolveAdvertiserTab(params.tab)

  if (!workspace) {
    return <EmptyAdvertiserState email={session.email} />
  }

  const {
    account,
    balanceCents,
    pendingCents,
    profile,
    payoutReports,
    targets,
    totalPaidCents,
  } = workspace
  const brandNames = targetValues(targets, "brand_name")
  const keywords = targetValues(targets, "keyword")
  const exclusions = targetValues(targets, "exclusion")

  return (
    <main className="min-h-screen bg-[#f6f5f2] px-4 py-6 text-[#18181b] sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <AdvertiserSidebar
          accountName={account.name}
          activeTab={activeTab}
        />

        <div className="min-w-0">
          <div className="mb-4">
            <Flash
              error={params.error}
              funding={params.funding}
              saved={params.saved}
            />
          </div>

          {activeTab === "settings" ? (
            <PayoutSettingsTab
              accountName={account.name}
              balanceCents={balanceCents}
              pendingCents={pendingCents}
              profile={profile}
              targets={targets}
              brandNames={brandNames}
              keywords={keywords}
              exclusions={exclusions}
            />
          ) : (
            <PayoutReportSection
              reports={payoutReports}
              totalPaidCents={totalPaidCents}
            />
          )}
        </div>
      </div>
    </main>
  )
}

function AdvertiserSidebar({
  accountName,
  activeTab,
}: {
  accountName: string
  activeTab: AdvertiserTab
}) {
  const navItems: Array<{
    href: string
    label: string
    value: AdvertiserTab
  }> = [
    {
      href: "/advertiser",
      label: "Payout settings",
      value: "settings",
    },
    {
      href: "/advertiser?tab=reporting",
      label: "Reporting",
      value: "reporting",
    },
  ]

  return (
    <aside className="rounded-[8px] border border-[#e4e4e7] bg-white p-4 shadow-sm lg:sticky lg:top-6 lg:self-start">
      <div className="border-b border-[#e4e4e7] pb-4">
        <p className="text-sm text-[#71717a]">Advertiser portal</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {accountName}
        </h1>
      </div>

      <nav className="mt-4 flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        {navItems.map((item) => {
          const isActive = activeTab === item.value

          return (
            <Link
              key={item.value}
              href={item.href}
              className={
                isActive
                  ? "inline-flex min-h-10 items-center rounded-[8px] bg-[#18181b] px-3 text-sm font-medium text-white"
                  : "inline-flex min-h-10 items-center rounded-[8px] px-3 text-sm font-medium text-[#52525b] hover:bg-[#f4f4f5] hover:text-[#18181b]"
              }
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}

function PayoutSettingsTab({
  accountName,
  balanceCents,
  brandNames,
  exclusions,
  keywords,
  pendingCents,
  profile,
  targets,
}: {
  accountName: string
  balanceCents: number
  brandNames: string
  exclusions: string
  keywords: string
  pendingCents: number
  profile: {
    id: string
    approvalMode: string
    allowedCategories: string | null
    blockedCategories: string | null
    dailyCapCents: number | null
    displayName: string
    monthlyCapCents: number | null
    notes: string | null
    payoutAmountCents: number | null
  } | null
  targets: BrandFundingTarget[]
}) {
  return (
    <>
      <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Account funds
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#71717a]">
              Add funds to cover payouts as qualified creator conversations
              happen.
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-3xl font-semibold tracking-tight">
              {formatMoney(balanceCents)}
            </p>
            <p className="mt-1 text-sm text-[#71717a]">
              Available
              {pendingCents > 0 ? `, ${formatMoney(pendingCents)} pending` : ""}
            </p>
          </div>
        </div>

        <form
          action={startAdvertiserFundingAction}
          className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]"
        >
          <div className="space-y-2">
            <label htmlFor="amountDollars" className="text-sm font-medium">
              Amount to add
            </label>
            <Input
              id="amountDollars"
              name="amountDollars"
              type="number"
              min={25}
              step={25}
              defaultValue={250}
              className="h-11 rounded-[8px]"
            />
          </div>
          <Button
            type="submit"
            className="mt-auto h-11 rounded-[8px] bg-[#18181b] px-5 text-white hover:bg-[#27272a]"
          >
            <Plus className="size-4" />
            Add funds
          </Button>
        </form>
      </section>

      <form
        action={saveBrandFundingProfileAction}
        className="mt-5 rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm"
      >
        <input type="hidden" name="profileId" value={profile?.id ?? ""} />
        <input type="hidden" name="status" value="active" />
        <input
          type="hidden"
          name="approvalMode"
          value={profile?.approvalMode ?? "auto"}
        />
        <input
          type="hidden"
          name="monthlyCapDollars"
          value={centsToDollars(profile?.monthlyCapCents ?? null)}
        />
        <input
          type="hidden"
          name="allowedCategories"
          value={profile?.allowedCategories ?? ""}
        />
        <input
          type="hidden"
          name="blockedCategories"
          value={profile?.blockedCategories ?? ""}
        />
        <input
          type="hidden"
          name="handles"
          value={targetValues(targets, "handle")}
        />
        <input
          type="hidden"
          name="hashtags"
          value={targetValues(targets, "hashtag")}
        />
        <input
          type="hidden"
          name="domains"
          value={targetValues(targets, "domain")}
        />
        <input
          type="hidden"
          name="products"
          value={targetValues(targets, "product")}
        />
        <input type="hidden" name="notes" value={profile?.notes ?? ""} />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Payout settings
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#71717a]">
              Choose what you want to pay for, and how much you are willing to
              pay when the system finds a qualified organic conversation.
            </p>
          </div>
          <Button
            type="submit"
            className="h-10 rounded-[8px] bg-[#18181b] px-4 text-white hover:bg-[#27272a]"
          >
            <Save className="size-4" />
            Save
          </Button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="displayName" className="text-sm font-medium">
              Brand name
            </label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={profile?.displayName ?? accountName}
              required
              className="h-11 rounded-[8px]"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="payoutAmountDollars"
              className="text-sm font-medium"
            >
              Pay up to per conversation
            </label>
            <Input
              id="payoutAmountDollars"
              name="payoutAmountDollars"
              type="number"
              min={0}
              step={1}
              defaultValue={centsToDollars(profile?.payoutAmountCents ?? null)}
              placeholder="25"
              className="h-11 rounded-[8px]"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label htmlFor="dailyCapDollars" className="text-sm font-medium">
              Daily limit
            </label>
            <Input
              id="dailyCapDollars"
              name="dailyCapDollars"
              type="number"
              min={0}
              step={25}
              defaultValue={centsToDollars(profile?.dailyCapCents ?? null)}
              placeholder="500"
              className="h-11 rounded-[8px]"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="brandNames" className="text-sm font-medium">
              Pay when conversations mention
            </label>
            <Textarea
              id="brandNames"
              name="brandNames"
              defaultValue={brandNames || accountName}
              placeholder="Brand names, campaign names, products"
              className="min-h-28 resize-none rounded-[8px]"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="keywords" className="text-sm font-medium">
              Helpful keywords
            </label>
            <Textarea
              id="keywords"
              name="keywords"
              defaultValue={keywords}
              placeholder="Use cases, product lines, buying moments"
              className="min-h-28 resize-none rounded-[8px]"
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label htmlFor="exclusions" className="text-sm font-medium">
            Do not pay for
          </label>
          <Textarea
            id="exclusions"
            name="exclusions"
            defaultValue={exclusions}
            placeholder="Competitors, unsafe topics, terms to exclude"
            className="min-h-24 resize-none rounded-[8px]"
          />
        </div>
      </form>
    </>
  )
}

function PayoutReportSection({
  reports,
  totalPaidCents,
}: {
  reports: AdvertiserPayoutReport[]
  totalPaidCents: number
}) {
  return (
    <section className="mt-5 rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Reporting</h2>
          <p className="mt-2 text-sm leading-6 text-[#71717a]">
            See which creators received funds from qualified conversations.
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-2xl font-semibold tracking-tight">
            {formatMoney(totalPaidCents)}
          </p>
          <p className="mt-1 text-sm text-[#71717a]">Paid to creators</p>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-[8px] border border-[#e4e4e7]">
        {reports.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead className="bg-[#fafafa] text-[#71717a]">
                <tr>
                  <th className="px-4 py-3 font-medium">Creator</th>
                  <th className="px-4 py-3 font-medium">Conversation</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e4e7]">
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {report.creatorName ?? "Creator"}
                      </p>
                      <p className="mt-0.5 text-xs text-[#71717a]">
                        {report.creatorHandle
                          ? `@${report.creatorHandle}`
                          : report.creatorId}
                      </p>
                    </td>
                    <td className="max-w-[260px] px-4 py-3 text-[#52525b]">
                      <p className="truncate">
                        {report.storyCaption || "Qualified conversation"}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {report.amountCents === null
                        ? "Pending"
                        : formatMoney(report.amountCents)}
                    </td>
                    <td className="px-4 py-3 capitalize text-[#52525b]">
                      {report.status}
                    </td>
                    <td className="px-4 py-3 text-[#52525b]">
                      {formatDate(report.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-[#fafafa] px-4 py-6 text-sm text-[#71717a]">
            No creator payouts yet. Once conversations qualify, the creator,
            amount, status, and date will appear here.
          </div>
        )}
      </div>
    </section>
  )
}
