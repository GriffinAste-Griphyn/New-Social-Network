import Link from "next/link"
import type { ComponentType, ReactNode } from "react"
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Building2,
  CheckCircle2,
  CreditCard,
  FileText,
  Gauge,
  Hash,
  Landmark,
  LogOut,
  ReceiptText,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Wallet,
} from "lucide-react"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { ChipInputField } from "@/components/app/chip-input-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  createAdvertiserAccountAction,
  saveAdvertiserAccountAction,
  saveBrandFundingProfileAction,
  startAdvertiserFundingAction,
  startAdvertiserPaymentMethodAction,
} from "@/lib/advertiser-actions"
import { logoutAction } from "@/lib/auth-actions"
import type {
  AdvertiserPaymentMethod,
  AdvertiserPayoutReport,
  AdvertiserWalletTransaction,
  BrandFundingProfile,
  BrandFundingTarget,
} from "@/lib/advertiser-store"
import { getAdvertiserWorkspaceForUser } from "@/lib/advertiser-store"
import { requireSession } from "@/lib/auth"

type AdvertiserPageProps = {
  searchParams: Promise<{
    error?: string
    funding?: string
    payment_method?: string
    saved?: string
    tab?: string
  }>
}

type AdvertiserTab = "overview" | "account" | "rules" | "wallet" | "activity"

const fundingPresets = [250, 1000, 5000]

function resolveAdvertiserTab(value: string | undefined): AdvertiserTab {
  if (
    value === "account" ||
    value === "rules" ||
    value === "wallet" ||
    value === "activity"
  ) {
    return value
  }

  return "overview"
}

function formatMoney(cents: number | null | undefined) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100)
}

function centsToDollars(value: number | null | undefined) {
  if (!value) return ""

  return String(value / 100)
}

function formatDate(date: Date | null | undefined) {
  if (!date) return "Pending"

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function formatDateTime(date: Date | null | undefined) {
  if (!date) return "Pending"

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
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

function blockedTermValues(targets: BrandFundingTarget[]) {
  return targets
    .filter(
      (target) =>
        target.kind === "exclusion" && !target.value.startsWith("creator:"),
    )
    .map((target) => target.value)
    .join(", ")
}

function creatorExclusionValues(targets: BrandFundingTarget[]) {
  return targets
    .filter(
      (target) =>
        target.kind === "exclusion" && target.value.startsWith("creator:"),
    )
    .map((target) => {
      const value = target.value.replace(/^creator:/, "")

      return value.startsWith("@") ? value : `@${value}`
    })
    .join(", ")
}

function payableTargetCount(targets: BrandFundingTarget[]) {
  return targets.filter((target) => target.kind !== "exclusion").length
}

function fundedMatchCapacity(balanceCents: number, payoutAmountCents?: number | null) {
  if (!payoutAmountCents || payoutAmountCents <= 0) {
    return 0
  }

  return Math.floor(balanceCents / payoutAmountCents)
}

function matchingStatusLabel(status: string | null | undefined) {
  if (status === "active") {
    return "active"
  }

  if (status === "paused") {
    return "paused"
  }

  return "inactive"
}

function statusTone(status: string) {
  if (status === "active" || status === "posted" || status === "paid") {
    return "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]"
  }

  if (status === "pending" || status === "draft" || status === "charged") {
    return "border-[#fde68a] bg-[#fffbeb] text-[#92400e]"
  }

  if (status === "paused" || status === "void" || status === "inactive") {
    return "border-[#e4e4e7] bg-[#f4f4f5] text-[#52525b]"
  }

  return "border-[#fecdd3] bg-[#fff1f2] text-[#be123c]"
}

function Flash({
  error,
  funding,
  paymentMethod,
  saved,
}: {
  error?: string
  funding?: string
  paymentMethod?: string
  saved?: string
}) {
  const message =
    error ??
    (funding === "success"
      ? "Funds are processing. The balance updates after Stripe confirms payment."
      : funding === "cancelled"
        ? "Funding was cancelled."
        : paymentMethod === "success"
          ? "Payment method setup completed. It can take a moment to appear."
          : paymentMethod === "cancelled"
            ? "Payment method setup was cancelled."
          : saved === "preferences"
            ? "Funding rules saved."
            : saved === "account"
              ? "Account details saved."
              : null)

  if (!message) {
    return null
  }

  return (
    <div
      className={
        error || funding === "cancelled" || paymentMethod === "cancelled"
          ? "rounded-[8px] border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]"
          : "rounded-[8px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#166534]"
      }
    >
      {message}
    </div>
  )
}

function DesktopOnlyNotice() {
  return (
    <main className="min-h-screen bg-[#f7f7f4] px-5 py-8 text-[#18181b] lg:hidden">
      <div className="mx-auto max-w-md rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-[8px] bg-[#18181b] text-white">
          <MonitorIcon />
        </div>
        <h1 className="mt-5 text-2xl font-[350] tracking-tight">
          Advertiser portal is desktop only
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#71717a]">
          Use a desktop browser to create advertiser accounts, configure brand
          funding rules, and add wallet funds.
        </p>
      </div>
    </main>
  )
}

function MonitorIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 5h16v11H4z" />
      <path d="M9 21h6" />
      <path d="M12 16v5" />
    </svg>
  )
}

function DesktopShell({ children }: { children: ReactNode }) {
  return (
    <>
      <DesktopOnlyNotice />
      <div className="hidden lg:block">{children}</div>
    </>
  )
}

function EmptyAdvertiserState({
  email,
  error,
}: {
  email: string
  error?: string
}) {
  return (
    <DesktopShell>
      <main className="min-h-screen bg-[#f7f7f4] px-8 py-8 text-[#18181b]">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,0.85fr)_minmax(28rem,1fr)] gap-8">
          <section className="pt-8">
            <Link href="/" className="text-2xl font-medium tracking-tight">
              UBEYE
            </Link>
            <div className="mt-16 max-w-xl">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#71717a]">
                Advertiser portal
              </p>
              <h1 className="mt-4 text-5xl font-[350] leading-[1.02] tracking-tight">
                Create the account that funds creator conversations.
              </h1>
              <div className="mt-8 grid gap-3 text-sm text-[#52525b]">
                {[
                  "Fund a prepaid advertiser balance.",
                  "Define brand signals creators can qualify against.",
                  "Track debits, creator credits, and payout status.",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 className="size-4 text-[#15803d]" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <form
            action={createAdvertiserAccountAction}
            className="self-start rounded-[8px] border border-[#e4e4e7] bg-white p-6 shadow-sm"
          >
            {error ? (
              <div className="mb-5 rounded-[8px] border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]">
                {error}
              </div>
            ) : null}

            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-[8px] bg-[#18181b] text-white">
                <Building2 className="size-5" />
              </div>
              <div>
                <h2 className="text-xl font-[350] tracking-tight">
                  Account setup
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#71717a]">
                  This is the billing and funding account for your brand.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4">
              <Field label="Company or brand name" htmlFor="name">
                <Input id="name" name="name" required className="h-11 rounded-[8px]" />
              </Field>
              <Field label="Website" htmlFor="websiteUrl">
                <Input
                  id="websiteUrl"
                  name="websiteUrl"
                  type="url"
                  placeholder="https://example.com"
                  className="h-11 rounded-[8px]"
                />
              </Field>
              <Field label="Billing email" htmlFor="billingEmail">
                <Input
                  id="billingEmail"
                  name="billingEmail"
                  type="email"
                  defaultValue={email}
                  required
                  className="h-11 rounded-[8px]"
                />
              </Field>
            </div>

            <div className="mt-6">
              <AuthSubmitButton
                idleLabel="Create advertiser account"
                pendingLabel="Creating account..."
              />
            </div>
          </form>
        </div>
      </main>
    </DesktopShell>
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
    return <EmptyAdvertiserState email={session.email} error={params.error} />
  }

  const {
    account,
    balanceCents,
    pendingCents,
    paymentMethod,
    profile,
    payoutReports,
    targets,
    transactions,
  } = workspace
  const brandNames = targetValues(targets, "brand_name")
  const handles = targetValues(targets, "handle")
  const keywords = targetValues(targets, "keyword")
  const hashtags = targetValues(targets, "hashtag")
  const domains = targetValues(targets, "domain")
  const products = targetValues(targets, "product")
  const exclusions = blockedTermValues(targets)
  const creatorExclusions = creatorExclusionValues(targets)
  const hasFundingRules =
    Boolean(profile?.payoutAmountCents && profile.payoutAmountCents > 0) &&
    payableTargetCount(targets) > 0

  return (
    <DesktopShell>
      <main className="min-h-screen bg-[#f6f7f5] text-[#18181b]">
        <div className="mx-auto grid min-h-screen max-w-[1480px] grid-cols-[300px_minmax(0,1fr)]">
          <FundingRail
            accountName={account.name}
            activeTab={activeTab}
            balanceCents={balanceCents}
            hasFundingRules={hasFundingRules}
            matchCapacity={fundedMatchCapacity(
              balanceCents,
              profile?.payoutAmountCents,
            )}
            profileStatus={profile?.status ?? "draft"}
            signalCount={payableTargetCount(targets)}
          />

          <div className="min-w-0 border-l border-[#e4e4e7] px-8 py-6">
            <Flash
              error={params.error}
              funding={params.funding}
              paymentMethod={params.payment_method}
              saved={params.saved}
            />

            <header className="mt-5 flex flex-wrap items-start justify-between gap-5">
              <div>
                <p className="text-sm font-medium text-[#71717a]">
                  Advertiser funding console
                </p>
                <h1 className="mt-1 text-3xl font-[350] tracking-tight">
                  {account.name}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`h-8 rounded-[8px] px-3 capitalize ${statusTone(account.status)}`}
                >
                  {account.status}
                </Badge>
                <Badge
                  variant="outline"
                  className={`h-8 rounded-[8px] px-3 capitalize ${statusTone(profile?.status ?? "draft")}`}
                >
                  Matching {matchingStatusLabel(profile?.status)}
                </Badge>
                {activeTab === "rules" ? (
                  <Button
                    form="funding-rules-form"
                    type="submit"
                    className="h-9 rounded-[8px] bg-[#18181b] px-4 text-white hover:bg-[#27272a]"
                  >
                    <Save className="size-4" />
                    Save rules
                  </Button>
                ) : null}
              </div>
            </header>

            {activeTab === "overview" ? (
              <OverviewConsole
                balanceCents={balanceCents}
                hasFundingRules={hasFundingRules}
                pendingCents={pendingCents}
                profile={profile}
              />
            ) : null}

            {activeTab === "account" ? <AccountConsole account={account} /> : null}

            {activeTab === "rules" ? (
              <div className="mt-6 grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_24rem]">
                <RulesConsole
                  accountName={account.name}
                  brandNames={brandNames}
                  creatorExclusions={creatorExclusions}
                  domains={domains}
                  exclusions={exclusions}
                  handles={handles}
                  hashtags={hashtags}
                  keywords={keywords}
                  products={products}
                  profile={profile}
                />
                <aside className="grid gap-4 2xl:sticky 2xl:top-6">
                  <FundingSummary
                    balanceCents={balanceCents}
                    hasFundingRules={hasFundingRules}
                    profile={profile}
                    signalCount={payableTargetCount(targets)}
                  />
                  <GuardrailSummary
                    creatorExclusions={creatorExclusions}
                    exclusions={exclusions}
                    profile={profile}
                  />
                </aside>
              </div>
            ) : null}

            {activeTab === "wallet" ? (
              <div className="mt-6 grid gap-6">
                <WalletConsole
                  balanceCents={balanceCents}
                  pendingCents={pendingCents}
                  paymentMethod={paymentMethod}
                />
                <TransactionLedger transactions={transactions} />
              </div>
            ) : null}

            {activeTab === "activity" ? (
              <div className="mt-6 grid gap-6 2xl:grid-cols-2">
                <PayoutTable reports={payoutReports} />
                <TransactionLedger transactions={transactions} />
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </DesktopShell>
  )
}

function OverviewConsole({
  balanceCents,
  hasFundingRules,
  pendingCents,
  profile,
}: {
  balanceCents: number
  hasFundingRules: boolean
  pendingCents: number
  profile: BrandFundingProfile | null
}) {
  const matchingStatus = matchingStatusLabel(profile?.status)

  return (
    <section className="mt-6 max-w-4xl rounded-[8px] border border-[#e4e4e7] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[#71717a]">
            <Activity className="size-4" />
            Overview
          </div>
          <h2 className="mt-2 text-xl font-[350] tracking-tight">
            Account funding
          </h2>
        </div>
        <Badge
          variant="outline"
          className={`h-8 rounded-[8px] px-3 capitalize ${statusTone(matchingStatus)}`}
        >
          Matching {matchingStatus}
        </Badge>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-sm font-medium text-[#71717a]">Available funds</p>
          <p className="mt-2 text-3xl font-medium tracking-tight">
            {formatMoney(balanceCents)}
          </p>
          {pendingCents > 0 ? (
            <p className="mt-1 text-sm text-[#71717a]">
              {formatMoney(pendingCents)} pending
            </p>
          ) : null}
        </div>

        <div>
          <p className="text-sm font-medium text-[#71717a]">Rules</p>
          <p className="mt-2 text-2xl font-medium tracking-tight">
            {hasFundingRules ? "Ready" : "Needs setup"}
          </p>
          {hasFundingRules ? (
            <p className="mt-1 text-sm text-[#71717a]">
              {formatMoney(profile?.payoutAmountCents)} per match
            </p>
          ) : null}
        </div>

        <div>
          <p className="text-sm font-medium text-[#71717a]">Matching</p>
          <p className="mt-2 text-2xl font-medium capitalize tracking-tight">
            {matchingStatus}
          </p>
        </div>
      </div>

      <Separator className="my-6 bg-[#e4e4e7]" />

      <div className="flex flex-wrap gap-3">
        <Button
          asChild
          className="h-10 rounded-[8px] bg-[#18181b] px-4 text-white hover:bg-[#27272a]"
        >
          <Link href="/advertiser?tab=wallet">
            <Wallet className="size-4" />
            Add funds
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-10 rounded-[8px] border-[#d4d4d8] bg-white px-4"
        >
          <Link href="/advertiser?tab=rules">
            <SlidersHorizontal className="size-4" />
            Edit rules
          </Link>
        </Button>
      </div>
    </section>
  )
}

function FundingRail({
  accountName,
  activeTab,
  balanceCents,
  hasFundingRules,
  matchCapacity,
  profileStatus,
  signalCount,
}: {
  accountName: string
  activeTab: AdvertiserTab
  balanceCents: number
  hasFundingRules: boolean
  matchCapacity: number
  profileStatus: string
  signalCount: number
}) {
  const navItems: Array<{
    href: string
    icon: ComponentType<{ className?: string }>
    label: string
    value: AdvertiserTab
  }> = [
    { href: "/advertiser", icon: Activity, label: "Overview", value: "overview" },
    {
      href: "/advertiser?tab=rules",
      icon: SlidersHorizontal,
      label: "Match rules",
      value: "rules",
    },
    {
      href: "/advertiser?tab=wallet",
      icon: Wallet,
      label: "Wallet",
      value: "wallet",
    },
    {
      href: "/advertiser?tab=activity",
      icon: ReceiptText,
      label: "Activity",
      value: "activity",
    },
    {
      href: "/advertiser?tab=account",
      icon: Building2,
      label: "Account",
      value: "account",
    },
  ]

  return (
    <aside className="flex min-h-screen flex-col bg-white px-4 py-5">
      <Link href="/" className="text-2xl font-medium tracking-tight">
        UBEYE
      </Link>

      <div className="mt-8 rounded-[8px] border border-[#e4e4e7] bg-[#fafafa] p-4">
        <p className="truncate text-sm font-medium text-[#71717a]">
          {accountName}
        </p>
        <p className="mt-3 text-3xl font-medium tracking-tight">
          {formatMoney(balanceCents)}
        </p>
        <p className="mt-1 text-xs text-[#71717a]">Available funds</p>
        <Separator className="my-4 bg-[#e4e4e7]" />
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#71717a]">Matching</span>
          <span className="capitalize text-[#18181b]">
            {matchingStatusLabel(profileStatus)}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-2">
        <RailStat icon={Target} label="Funded matches" value={String(matchCapacity)} />
        <RailStat icon={Hash} label="Payable signals" value={String(signalCount)} />
        <RailStat
          icon={Gauge}
          label="Matching"
          value={hasFundingRules && profileStatus === "active" ? "Active" : "Inactive"}
        />
      </div>

      <nav className="mt-5 grid gap-1" aria-label="Advertiser console sections">
        {navItems.map((item) => {
          const isActive = activeTab === item.value

          return (
            <Link
              key={item.value}
              href={item.href}
              className={
                isActive
                  ? "flex h-11 items-center gap-3 rounded-[8px] bg-[#18181b] px-3 text-sm font-medium text-white"
                  : "flex h-11 items-center gap-3 rounded-[8px] px-3 text-sm font-medium text-[#52525b] hover:bg-[#f4f4f5] hover:text-[#18181b]"
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <form action={logoutAction} className="mt-4">
        <button
          type="submit"
          className="flex h-11 w-full items-center gap-3 rounded-[8px] px-3 text-left text-sm font-medium text-[#52525b] hover:bg-[#f4f4f5] hover:text-[#18181b]"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </form>

      <div className="mt-auto rounded-[8px] border border-[#d9f99d] bg-[#f7fee7] p-4 text-sm text-[#3f6212]">
        <ShieldCheck className="mb-3 size-5" />
        Funds are debited only when matching logic creates an auditable creator
        payout event.
      </div>
    </aside>
  )
}

function RailStat({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[8px] border border-[#e4e4e7] px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm text-[#71717a]">
        <Icon className="size-4" />
        <span>{label}</span>
      </div>
      <span className="text-sm font-medium text-[#18181b]">{value}</span>
    </div>
  )
}

function AccountConsole({
  account,
}: {
  account: {
    billingEmail: string
    createdAt: Date
    id: string
    name: string
    status: string
    stripeCustomerId: string | null
    updatedAt: Date
    websiteUrl: string | null
  }
}) {
  return (
    <section id="account" className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
      <form action={saveAdvertiserAccountAction}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-[#71717a]">
              <Building2 className="size-4" />
              Account
            </div>
            <h2 className="mt-2 text-xl font-[350] tracking-tight">
              Brand identity and billing
            </h2>
          </div>
          <Button
            type="submit"
            variant="outline"
            className="h-10 rounded-[8px] border-[#d4d4d8] bg-white"
          >
            <Save className="size-4" />
            Save account
          </Button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-3">
          <Field label="Company or brand name" htmlFor="name">
            <Input
              id="name"
              name="name"
              defaultValue={account.name}
              required
              className="h-11 rounded-[8px]"
            />
          </Field>
          <Field label="Website" htmlFor="websiteUrl">
            <Input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              defaultValue={account.websiteUrl ?? ""}
              placeholder="https://example.com"
              className="h-11 rounded-[8px]"
            />
          </Field>
          <Field label="Billing email" htmlFor="billingEmail">
            <Input
              id="billingEmail"
              name="billingEmail"
              type="email"
              defaultValue={account.billingEmail}
              required
              className="h-11 rounded-[8px]"
            />
          </Field>
        </div>
      </form>
    </section>
  )
}

function RulesConsole({
  accountName,
  brandNames,
  creatorExclusions,
  domains,
  exclusions,
  handles,
  hashtags,
  keywords,
  products,
  profile,
}: {
  accountName: string
  brandNames: string
  creatorExclusions: string
  domains: string
  exclusions: string
  handles: string
  hashtags: string
  keywords: string
  products: string
  profile: BrandFundingProfile | null
}) {
  return (
    <section id="rules" className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
      <form id="funding-rules-form" action={saveBrandFundingProfileAction}>
        <input type="hidden" name="profileId" value={profile?.id ?? ""} />
        <input type="hidden" name="status" value={profile?.status ?? "draft"} />
        <input
          type="hidden"
          name="approvalMode"
          value={profile?.approvalMode ?? "auto"}
        />
        <input
          type="hidden"
          name="displayName"
          value={profile?.displayName ?? accountName}
        />
        <input
          type="hidden"
          name="payoutAmountDollars"
          value={centsToDollars(profile?.payoutAmountCents)}
        />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-[#71717a]">
              <SlidersHorizontal className="size-4" />
              Match rules
            </div>
            <h2 className="mt-2 text-xl font-[350] tracking-tight">
              What should qualify for funding
            </h2>
          </div>
          <Button
            type="submit"
            className="h-10 rounded-[8px] bg-[#18181b] px-4 text-white hover:bg-[#27272a]"
          >
            <Save className="size-4" />
            Save rules
          </Button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Field label="Daily cap" htmlFor="dailyCapDollars">
            <Input
              id="dailyCapDollars"
              name="dailyCapDollars"
              type="number"
              min={0}
              step={25}
              defaultValue={centsToDollars(profile?.dailyCapCents)}
              placeholder="500"
              className="h-11 rounded-[8px]"
            />
          </Field>
          <Field label="Monthly cap" htmlFor="monthlyCapDollars">
            <Input
              id="monthlyCapDollars"
              name="monthlyCapDollars"
              type="number"
              min={0}
              step={100}
              defaultValue={centsToDollars(profile?.monthlyCapCents)}
              placeholder="10000"
              className="h-11 rounded-[8px]"
            />
          </Field>
        </div>

        <Separator className="my-6 bg-[#e4e4e7]" />

        <div className="grid gap-5">
          <SignalGroup title="Inclusions" icon={Target}>
            <ChipInputField
              label="Brand names"
              name="brandNames"
              defaultValue={brandNames || accountName}
              placeholder="Nike"
            />
            <ChipInputField
              label="Handles"
              name="handles"
              defaultValue={handles}
              placeholder="@brand"
            />
            <ChipInputField
              label="Hashtags"
              name="hashtags"
              defaultValue={hashtags}
              placeholder="#productdrop"
            />
            <ChipInputField
              label="Keywords"
              name="keywords"
              defaultValue={keywords}
              placeholder="running shoes"
            />
            <ChipInputField
              label="Products"
              name="products"
              defaultValue={products}
              placeholder="Air Zoom"
            />
            <ChipInputField
              label="Domains"
              name="domains"
              defaultValue={domains}
              placeholder="example.com"
            />
          </SignalGroup>

          <SignalGroup title="Guardrails" icon={Ban}>
            <ChipInputField
              label="Blocked terms"
              name="exclusions"
              defaultValue={exclusions}
              placeholder="competitor"
            />
            <ChipInputField
              label="Blocked creators"
              name="creatorExclusions"
              defaultValue={creatorExclusions}
              placeholder="@creator"
            />
            <Field label="Allowed categories" htmlFor="allowedCategories">
              <Input
                id="allowedCategories"
                name="allowedCategories"
                defaultValue={profile?.allowedCategories ?? ""}
                placeholder="Fitness, travel, food"
                className="h-11 rounded-[8px]"
              />
            </Field>
            <Field label="Blocked categories" htmlFor="blockedCategories">
              <Input
                id="blockedCategories"
                name="blockedCategories"
                defaultValue={profile?.blockedCategories ?? ""}
                placeholder="Politics, adult, unsafe topics"
                className="h-11 rounded-[8px]"
              />
            </Field>
          </SignalGroup>

          <Field label="Internal notes" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              defaultValue={profile?.notes ?? ""}
              placeholder="Review guidance and operational notes"
              className="min-h-24 resize-none rounded-[8px]"
            />
          </Field>
        </div>
      </form>
    </section>
  )
}

function SignalGroup({
  children,
  icon: Icon,
  title,
}: {
  children: ReactNode
  icon: ComponentType<{ className?: string }>
  title: string
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#18181b]">
        <Icon className="size-4 text-[#52525b]" />
        {title}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">{children}</div>
    </div>
  )
}

function WalletConsole({
  balanceCents,
  paymentMethod,
  pendingCents,
}: {
  balanceCents: number
  paymentMethod: AdvertiserPaymentMethod | null
  pendingCents: number
}) {
  return (
    <section id="wallet" className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[#71717a]">
            <Wallet className="size-4" />
            Wallet
          </div>
          <h2 className="mt-2 text-xl font-[350] tracking-tight">
            Fund the account
          </h2>
        </div>
        <div className="text-right">
          <p className="text-3xl font-medium tracking-tight">
            {formatMoney(balanceCents)}
          </p>
          <p className="mt-1 text-sm text-[#71717a]">
            Available{pendingCents > 0 ? `, ${formatMoney(pendingCents)} pending` : ""}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {fundingPresets.map((amount) => (
          <form key={amount} action={startAdvertiserFundingAction}>
            <input type="hidden" name="amountDollars" value={amount} />
            <Button
              type="submit"
              variant="outline"
              className="h-12 w-full rounded-[8px] border-[#d4d4d8] bg-white text-base hover:bg-[#f4f4f5]"
            >
              Add {formatMoney(amount * 100)}
            </Button>
          </form>
        ))}
      </div>

      <form
        action={startAdvertiserFundingAction}
        className="mt-5 grid gap-3 border-t border-[#e4e4e7] pt-5 md:grid-cols-[1fr_auto]"
      >
        <Field label="Custom amount" htmlFor="amountDollars">
          <Input
            id="amountDollars"
            name="amountDollars"
            type="number"
            min={25}
            step={25}
            defaultValue={250}
            className="h-11 rounded-[8px]"
          />
        </Field>
        <Button
          type="submit"
          className="mt-auto h-11 rounded-[8px] bg-[#18181b] px-5 text-white hover:bg-[#27272a]"
        >
          <CreditCard className="size-4" />
          Continue to Stripe
        </Button>
      </form>

      <form action={startAdvertiserPaymentMethodAction} className="mt-5">
        <Button
          type="submit"
          variant="outline"
          className="h-11 rounded-[8px] border-[#d4d4d8] bg-white px-4 text-[#18181b]"
        >
          <Landmark className="size-4" />
          {paymentMethod ? "Update payment method" : "Set up payment method"}
        </Button>
        {paymentMethod ? (
          <p className="mt-3 text-sm text-[#71717a]">
            Default payment method:{" "}
            <span className="font-medium capitalize text-[#18181b]">
              {paymentMethod.brand ?? paymentMethod.type}
            </span>
            {paymentMethod.last4 ? ` ending in ${paymentMethod.last4}` : ""}
          </p>
        ) : null}
      </form>
    </section>
  )
}

function FundingSummary({
  balanceCents,
  hasFundingRules,
  profile,
  signalCount,
}: {
  balanceCents: number
  hasFundingRules: boolean
  profile: BrandFundingProfile | null
  signalCount: number
}) {
  const capacity = fundedMatchCapacity(balanceCents, profile?.payoutAmountCents)

  return (
    <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-[#71717a]">
        <ShieldCheck className="size-4" />
        Funding summary
      </div>
      <div className="mt-4 grid gap-3">
        <SummaryRow complete={balanceCents > 0} label="Wallet funded" value={formatMoney(balanceCents)} />
        <SummaryRow
          complete={Boolean(profile?.payoutAmountCents && profile.payoutAmountCents > 0)}
          label="Payout set"
          value={formatMoney(profile?.payoutAmountCents)}
        />
        <SummaryRow complete={signalCount > 0} label="Rules set" value={String(signalCount)} />
        <SummaryRow
          complete={profile?.status === "active" && hasFundingRules}
          label="Matching status"
          value={matchingStatusLabel(profile?.status)}
        />
      </div>
      <Separator className="my-4 bg-[#e4e4e7]" />
      <p className="text-sm leading-6 text-[#52525b]">
        This account can fund up to{" "}
        <span className="font-medium text-[#18181b]">{capacity}</span> matched
        post{capacity === 1 ? "" : "s"} before the wallet needs more funds.
      </p>
    </section>
  )
}

function GuardrailSummary({
  creatorExclusions,
  exclusions,
  profile,
}: {
  creatorExclusions: string
  exclusions: string
  profile: BrandFundingProfile | null
}) {
  return (
    <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-[#71717a]">
        <AlertTriangle className="size-4" />
        Enforcement notes
      </div>
      <div className="mt-4 grid gap-3 text-sm">
        <p className="leading-6 text-[#52525b]">
          Matching currently evaluates creator tags and `@/#` caption mentions.
        </p>
        <RecordRow
          label="Blocked terms"
          value={exclusions || "None"}
        />
        <RecordRow
          label="Blocked creators"
          value={creatorExclusions || "None"}
        />
        <RecordRow
          label="Category filters"
          value={
            profile?.allowedCategories || profile?.blockedCategories
              ? "Stored for review"
              : "None"
          }
        />
      </div>
    </section>
  )
}

function SummaryRow({
  complete,
  label,
  value,
}: {
  complete: boolean
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        {complete ? (
          <CheckCircle2 className="size-4 text-[#15803d]" />
        ) : (
          <FileText className="size-4 text-[#a16207]" />
        )}
        <span className="text-[#52525b]">{label}</span>
      </div>
      <span className="max-w-40 truncate font-medium capitalize text-[#18181b]">
        {value}
      </span>
    </div>
  )
}

function TransactionLedger({
  transactions,
}: {
  transactions: AdvertiserWalletTransaction[]
}) {
  return (
    <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-[350] tracking-tight">Wallet ledger</h2>
          <p className="mt-2 text-sm leading-6 text-[#71717a]">
            Posted and pending advertiser wallet movements.
          </p>
        </div>
        <ReceiptText className="size-5 text-[#71717a]" />
      </div>

      <div className="mt-5 overflow-hidden rounded-[8px] border border-[#e4e4e7]">
        {transactions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-[#fafafa] text-[#71717a]">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e4e7]">
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-4 py-3 text-[#52525b]">
                      {formatDateTime(transaction.postedAt ?? transaction.createdAt)}
                    </td>
                    <td className="px-4 py-3 capitalize">{transaction.type}</td>
                    <td className="max-w-[280px] px-4 py-3 text-[#52525b]">
                      <p className="truncate">
                        {transaction.description ?? "Wallet transaction"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-[8px] border px-2 py-1 text-xs font-medium capitalize ${statusTone(transaction.status)}`}
                      >
                        {transaction.status}
                      </span>
                    </td>
                    <td
                      className={
                        transaction.amountCents < 0
                          ? "px-4 py-3 text-right font-medium text-[#be123c]"
                          : "px-4 py-3 text-right font-medium text-[#166534]"
                      }
                    >
                      {transaction.amountCents < 0 ? "-" : "+"}
                      {formatMoney(Math.abs(transaction.amountCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyTable copy="No wallet transactions yet." />
        )}
      </div>
    </section>
  )
}

function PayoutTable({
  compact = false,
  reports,
}: {
  compact?: boolean
  reports: AdvertiserPayoutReport[]
}) {
  return (
    <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-[350] tracking-tight">Creator payouts</h2>
          <p className="mt-2 text-sm leading-6 text-[#71717a]">
            Qualified creator activity funded by this advertiser account.
          </p>
        </div>
        <ArrowUpRight className="size-5 text-[#71717a]" />
      </div>

      <div className="mt-5 overflow-hidden rounded-[8px] border border-[#e4e4e7]">
        {reports.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-[#fafafa] text-[#71717a]">
                <tr>
                  <th className="px-4 py-3 font-medium">Creator</th>
                  <th className="px-4 py-3 font-medium">Conversation</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
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
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-[8px] border px-2 py-1 text-xs font-medium capitalize ${statusTone(report.status)}`}
                      >
                        {report.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#52525b]">
                      {formatDate(report.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {report.amountCents === null
                        ? "Pending"
                        : formatMoney(report.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyTable
            copy={
              compact
                ? "No recent creator payouts."
                : "No creator payouts yet. Qualified creator activity will appear here."
            }
          />
        )}
      </div>
    </section>
  )
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode
  htmlFor: string
  label: string
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[#e4e4e7] pb-3 last:border-b-0 last:pb-0">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">
        {label}
      </p>
      <p className="mt-1 break-words font-medium text-[#18181b]">{value}</p>
    </div>
  )
}

function EmptyTable({ copy }: { copy: string }) {
  return <div className="bg-[#fafafa] px-4 py-8 text-sm text-[#71717a]">{copy}</div>
}
