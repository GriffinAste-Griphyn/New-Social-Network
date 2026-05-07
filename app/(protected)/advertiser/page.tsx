import Link from "next/link"
import type { ComponentType, ReactNode } from "react"
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  FileText,
  Landmark,
  ListFilter,
  Plus,
  ReceiptText,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
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
import type {
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

type AdvertiserTab = "overview" | "wallet" | "rules" | "activity" | "account"

const fundingPresets = [250, 1000, 5000]

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

function resolveAdvertiserTab(value: string | undefined): AdvertiserTab {
  if (
    value === "wallet" ||
    value === "rules" ||
    value === "activity" ||
    value === "account"
  ) {
    return value
  }

  return "overview"
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

function statusTone(status: string) {
  if (status === "active" || status === "posted" || status === "paid") {
    return "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]"
  }

  if (status === "pending" || status === "draft" || status === "charged") {
    return "border-[#fde68a] bg-[#fffbeb] text-[#92400e]"
  }

  if (status === "paused" || status === "void") {
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
          ? "Payment method setup completed."
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
        error || funding === "cancelled"
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
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
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
            <Link href="/" className="text-2xl font-semibold tracking-tight">
              UBEYE
            </Link>
            <div className="mt-16 max-w-xl">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#71717a]">
                Advertiser portal
              </p>
              <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-tight">
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
                <h2 className="text-xl font-semibold tracking-tight">
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
    profile,
    payoutReports,
    targets,
    totalPaidCents,
    transactions,
  } = workspace
  const brandNames = targetValues(targets, "brand_name")
  const handles = targetValues(targets, "handle")
  const keywords = targetValues(targets, "keyword")
  const hashtags = targetValues(targets, "hashtag")
  const domains = targetValues(targets, "domain")
  const products = targetValues(targets, "product")
  const exclusions = targetValues(targets, "exclusion")
  const capturedCents = Math.abs(
    transactions
      .filter((transaction) => transaction.type === "capture")
      .reduce((sum, transaction) => sum + transaction.amountCents, 0),
  )
  const hasFundingRules =
    Boolean(profile?.payoutAmountCents && profile.payoutAmountCents > 0) &&
    targets.some((target) => target.kind !== "exclusion")

  return (
    <DesktopShell>
      <main className="min-h-screen bg-[#f7f7f4] text-[#18181b]">
        <div className="mx-auto grid min-h-screen max-w-[1440px] grid-cols-[280px_minmax(0,1fr)]">
          <AdvertiserSidebar
            accountName={account.name}
            activeTab={activeTab}
            balanceCents={balanceCents}
            profileStatus={profile?.status ?? "draft"}
          />

          <div className="min-w-0 border-l border-[#e4e4e7] px-8 py-6">
            <div className="mb-5">
              <Flash
                error={params.error}
                funding={params.funding}
                paymentMethod={params.payment_method}
                saved={params.saved}
              />
            </div>

            <header className="mb-6 flex items-start justify-between gap-6">
              <div>
                <p className="text-sm font-medium text-[#71717a]">
                  Advertiser account
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight">
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
                  Rules {profile?.status ?? "draft"}
                </Badge>
              </div>
            </header>

            {activeTab === "overview" ? (
              <OverviewTab
                balanceCents={balanceCents}
                capturedCents={capturedCents}
                hasFundingRules={hasFundingRules}
                pendingCents={pendingCents}
                profile={profile}
                recentReports={payoutReports}
                recentTransactions={transactions}
                targets={targets}
                totalPaidCents={totalPaidCents}
              />
            ) : null}

            {activeTab === "wallet" ? (
              <WalletTab
                balanceCents={balanceCents}
                pendingCents={pendingCents}
                transactions={transactions}
              />
            ) : null}

            {activeTab === "rules" ? (
              <RulesTab
                accountName={account.name}
                brandNames={brandNames}
                domains={domains}
                exclusions={exclusions}
                handles={handles}
                hashtags={hashtags}
                keywords={keywords}
                products={products}
                profile={profile}
              />
            ) : null}

            {activeTab === "activity" ? (
              <ActivityTab reports={payoutReports} totalPaidCents={totalPaidCents} />
            ) : null}

            {activeTab === "account" ? (
              <AccountTab account={account} />
            ) : null}
          </div>
        </div>
      </main>
    </DesktopShell>
  )
}

function AdvertiserSidebar({
  accountName,
  activeTab,
  balanceCents,
  profileStatus,
}: {
  accountName: string
  activeTab: AdvertiserTab
  balanceCents: number
  profileStatus: string
}) {
  const navItems: Array<{
    href: string
    icon: ComponentType<{ className?: string }>
    label: string
    value: AdvertiserTab
  }> = [
    { href: "/advertiser", icon: Activity, label: "Overview", value: "overview" },
    { href: "/advertiser?tab=wallet", icon: Wallet, label: "Wallet", value: "wallet" },
    {
      href: "/advertiser?tab=rules",
      icon: SlidersHorizontal,
      label: "Funding rules",
      value: "rules",
    },
    {
      href: "/advertiser?tab=activity",
      icon: ReceiptText,
      label: "Creator payouts",
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
      <Link href="/" className="text-2xl font-semibold tracking-tight">
        UBEYE
      </Link>

      <div className="mt-8 rounded-[8px] border border-[#e4e4e7] bg-[#fafafa] p-4">
        <p className="truncate text-sm font-medium text-[#71717a]">
          {accountName}
        </p>
        <p className="mt-3 text-3xl font-semibold tracking-tight">
          {formatMoney(balanceCents)}
        </p>
        <p className="mt-1 text-xs text-[#71717a]">Available funds</p>
        <Separator className="my-4 bg-[#e4e4e7]" />
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#71717a]">Rules</span>
          <span className="capitalize text-[#18181b]">{profileStatus}</span>
        </div>
      </div>

      <nav className="mt-5 grid gap-1" aria-label="Advertiser portal">
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

      <div className="mt-auto rounded-[8px] border border-[#d9f99d] bg-[#f7fee7] p-4 text-sm text-[#3f6212]">
        <ShieldCheck className="mb-3 size-5" />
        Funds are debited only when matching logic creates an auditable creator
        payout event.
      </div>
    </aside>
  )
}

function OverviewTab({
  balanceCents,
  capturedCents,
  hasFundingRules,
  pendingCents,
  profile,
  recentReports,
  recentTransactions,
  targets,
  totalPaidCents,
}: {
  balanceCents: number
  capturedCents: number
  hasFundingRules: boolean
  pendingCents: number
  profile: BrandFundingProfile | null
  recentReports: AdvertiserPayoutReport[]
  recentTransactions: AdvertiserWalletTransaction[]
  targets: BrandFundingTarget[]
  totalPaidCents: number
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard
          icon={Wallet}
          label="Available"
          value={formatMoney(balanceCents)}
          detail={pendingCents > 0 ? `${formatMoney(pendingCents)} pending` : "Posted funds"}
        />
        <MetricCard
          icon={Banknote}
          label="Creator payouts"
          value={formatMoney(totalPaidCents)}
          detail="Paid through ledger"
        />
        <MetricCard
          icon={CircleDollarSign}
          label="Captured"
          value={formatMoney(capturedCents)}
          detail="Debited from wallet"
        />
        <MetricCard
          icon={ListFilter}
          label="Signals"
          value={String(targets.length)}
          detail={`${targets.filter((target) => target.kind !== "exclusion").length} payable`}
        />
      </div>

      <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Account readiness
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#71717a]">
              Complete the account, funding, and rules setup before creator
              conversations can draw from this wallet.
            </p>
          </div>
          <Button asChild className="h-10 rounded-[8px] bg-[#18181b] text-white hover:bg-[#27272a]">
            <Link href="/advertiser?tab=wallet">
              <Plus className="size-4" />
              Add funds
            </Link>
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <ReadinessItem
            complete={balanceCents > 0}
            title="Wallet funded"
            detail={balanceCents > 0 ? formatMoney(balanceCents) : "No available funds"}
          />
          <ReadinessItem
            complete={hasFundingRules}
            title="Rules active"
            detail={
              hasFundingRules
                ? `${formatMoney(profile?.payoutAmountCents)} per match`
                : "Set payout and signals"
            }
          />
          <ReadinessItem
            complete={profile?.status === "active"}
            title="Profile active"
            detail={profile?.status ?? "Draft"}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <TransactionLedger transactions={recentTransactions.slice(0, 6)} />
        <PayoutTable reports={recentReports.slice(0, 6)} compact />
      </div>
    </div>
  )
}

function WalletTab({
  balanceCents,
  pendingCents,
  transactions,
}: {
  balanceCents: number
  pendingCents: number
  transactions: AdvertiserWalletTransaction[]
}) {
  return (
    <div className="grid gap-5">
      <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Wallet funding</h2>
            <p className="mt-2 text-sm leading-6 text-[#71717a]">
              Add prepaid funds for creator payouts. Stripe confirms funding
              before the balance becomes available.
            </p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-semibold tracking-tight">
              {formatMoney(balanceCents)}
            </p>
            <p className="mt-1 text-sm text-[#71717a]">
              Available{pendingCents > 0 ? `, ${formatMoney(pendingCents)} pending` : ""}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
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

        <form action={startAdvertiserPaymentMethodAction} className="mt-3">
          <Button
            type="submit"
            variant="ghost"
            className="h-10 rounded-[8px] px-3 text-[#52525b]"
          >
            <Landmark className="size-4" />
            Set up payment method
          </Button>
        </form>
      </section>

      <TransactionLedger transactions={transactions} />
    </div>
  )
}

function RulesTab({
  accountName,
  brandNames,
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
  domains: string
  exclusions: string
  handles: string
  hashtags: string
  keywords: string
  products: string
  profile: BrandFundingProfile | null
}) {
  return (
    <form
      action={saveBrandFundingProfileAction}
      className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm"
    >
      <input type="hidden" name="profileId" value={profile?.id ?? ""} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Funding rules</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#71717a]">
            These rules decide which creator conversations can debit the
            advertiser wallet and credit creator earnings.
          </p>
        </div>
        <Button
          type="submit"
          className="h-10 rounded-[8px] bg-[#18181b] px-4 text-white hover:bg-[#27272a]"
        >
          <Save className="size-4" />
          Save rules
        </Button>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-4">
        <Field label="Profile status" htmlFor="status">
          <select
            id="status"
            name="status"
            defaultValue={profile?.status ?? "draft"}
            className="h-11 w-full rounded-[8px] border border-[#d4d4d8] bg-white px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-[#a1a1aa]/40"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </Field>
        <Field label="Approval mode" htmlFor="approvalMode">
          <select
            id="approvalMode"
            name="approvalMode"
            defaultValue={profile?.approvalMode ?? "auto"}
            className="h-11 w-full rounded-[8px] border border-[#d4d4d8] bg-white px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-[#a1a1aa]/40"
          >
            <option value="auto">Auto qualify</option>
            <option value="manual">Manual review</option>
          </select>
        </Field>
        <Field label="Public brand name" htmlFor="displayName">
          <Input
            id="displayName"
            name="displayName"
            defaultValue={profile?.displayName ?? accountName}
            required
            className="h-11 rounded-[8px]"
          />
        </Field>
        <Field label="Pay per qualified event" htmlFor="payoutAmountDollars">
          <Input
            id="payoutAmountDollars"
            name="payoutAmountDollars"
            type="number"
            min={0}
            step={1}
            defaultValue={centsToDollars(profile?.payoutAmountCents)}
            placeholder="25"
            className="h-11 rounded-[8px]"
          />
        </Field>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
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

      <div className="grid gap-4 xl:grid-cols-2">
        <TextAreaField
          label="Brand names"
          name="brandNames"
          defaultValue={brandNames || accountName}
          placeholder="Nike, Nike Running"
        />
        <TextAreaField
          label="Handles"
          name="handles"
          defaultValue={handles}
          placeholder="@brand, @support"
        />
        <TextAreaField
          label="Hashtags"
          name="hashtags"
          defaultValue={hashtags}
          placeholder="#brand, #productdrop"
        />
        <TextAreaField
          label="Domains"
          name="domains"
          defaultValue={domains}
          placeholder="example.com"
        />
        <TextAreaField
          label="Products"
          name="products"
          defaultValue={products}
          placeholder="Product names, collection names, SKUs"
        />
        <TextAreaField
          label="Keywords"
          name="keywords"
          defaultValue={keywords}
          placeholder="Buying moments, use cases, category phrases"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TextAreaField
          label="Allowed categories"
          name="allowedCategories"
          defaultValue={profile?.allowedCategories ?? ""}
          placeholder="Fitness, travel, food"
        />
        <TextAreaField
          label="Blocked categories"
          name="blockedCategories"
          defaultValue={profile?.blockedCategories ?? ""}
          placeholder="Politics, adult, unsafe topics"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TextAreaField
          label="Exclusions"
          name="exclusions"
          defaultValue={exclusions}
          placeholder="Competitors, terms, categories, unsafe claims"
        />
        <TextAreaField
          label="Internal notes"
          name="notes"
          defaultValue={profile?.notes ?? ""}
          placeholder="Review guidance and operational notes"
        />
      </div>
    </form>
  )
}

function ActivityTab({
  reports,
  totalPaidCents,
}: {
  reports: AdvertiserPayoutReport[]
  totalPaidCents: number
}) {
  return (
    <div className="grid gap-5">
      <MetricCard
        icon={BadgeCheck}
        label="Paid to creators"
        value={formatMoney(totalPaidCents)}
        detail={`${reports.length} recent payout events`}
      />
      <PayoutTable reports={reports} />
    </div>
  )
}

function AccountTab({
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
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <form
        action={saveAdvertiserAccountAction}
        className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Account details
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#71717a]">
              Billing identity used for wallet funding and advertiser reporting.
            </p>
          </div>
          <Button
            type="submit"
            className="h-10 rounded-[8px] bg-[#18181b] px-4 text-white hover:bg-[#27272a]"
          >
            <Save className="size-4" />
            Save account
          </Button>
        </div>

        <div className="mt-6 grid gap-4">
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

      <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">System record</h2>
        <div className="mt-5 grid gap-4 text-sm">
          <RecordRow label="Account ID" value={account.id} />
          <RecordRow label="Status" value={account.status} />
          <RecordRow
            label="Stripe customer"
            value={account.stripeCustomerId ?? "Not created"}
          />
          <RecordRow label="Created" value={formatDate(account.createdAt)} />
          <RecordRow label="Updated" value={formatDate(account.updatedAt)} />
        </div>
      </section>
    </div>
  )
}

function MetricCard({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[#71717a]">{label}</p>
        <div className="flex size-9 items-center justify-center rounded-[8px] bg-[#f4f4f5] text-[#3f3f46]">
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-[#71717a]">{detail}</p>
    </section>
  )
}

function ReadinessItem({
  complete,
  detail,
  title,
}: {
  complete: boolean
  detail: string
  title: string
}) {
  return (
    <div className="rounded-[8px] border border-[#e4e4e7] bg-[#fafafa] p-4">
      <div className="flex items-center gap-3">
        {complete ? (
          <CheckCircle2 className="size-5 text-[#15803d]" />
        ) : (
          <FileText className="size-5 text-[#a16207]" />
        )}
        <p className="font-medium">{title}</p>
      </div>
      <p className="mt-2 text-sm text-[#71717a]">{detail}</p>
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
          <h2 className="text-xl font-semibold tracking-tight">Wallet ledger</h2>
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
          <h2 className="text-xl font-semibold tracking-tight">Creator payouts</h2>
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

function TextAreaField({
  defaultValue,
  label,
  name,
  placeholder,
}: {
  defaultValue: string
  label: string
  name: string
  placeholder: string
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <Textarea
        id={name}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="min-h-28 resize-none rounded-[8px]"
      />
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
