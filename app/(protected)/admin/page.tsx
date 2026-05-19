import type { ReactNode } from "react"
import {
  AlertTriangle,
  BadgeDollarSign,
  Building2,
  Check,
  Clock3,
  Flag,
  LogOut,
  ShieldAlert,
  Trash2,
  Users,
  WalletCards,
} from "lucide-react"

import {
  approveModeratedStoryAction,
  rejectModeratedStoryAction,
  reviewSafetyReportAction,
  settleCreatorPayoutAction,
} from "@/lib/admin-actions"
import {
  getAdminOverview,
  listAdminCreatorPayouts,
  listAdminSafetyReports,
  listFlaggedStories,
  requireAdminSession,
  type AdminCreatorPayout,
  type AdminSafetyReport,
  type AdminModerationStory,
} from "@/lib/admin-store"
import { formatSafetyReportReason } from "@/lib/social-safety"
import { logoutAction } from "@/lib/auth-actions"

type AdminPageProps = {
  searchParams: Promise<{
    error?: string
    moderation?: string
    paid?: string
  }>
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value)
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value)
}

function formatModerationCategories(value: string) {
  try {
    const categories = JSON.parse(value) as Array<{
      key?: string
      confidence?: number
      source?: string
    }>

    return categories.slice(0, 4).map((category) => {
      const confidence =
        typeof category.confidence === "number"
          ? ` ${(category.confidence * 100).toFixed(0)}%`
          : ""
      const source = category.source ? ` via ${category.source}` : ""

      return `${category.key ?? "other"}${confidence}${source}`
    })
  } catch {
    return []
  }
}

function flashMessage(params: Awaited<AdminPageProps["searchParams"]>) {
  if (params.error) return { tone: "error" as const, message: params.error }

  if (params.moderation === "approved") {
    return { tone: "success" as const, message: "Story approved." }
  }

  if (params.moderation === "removed") {
    return { tone: "success" as const, message: "Story removed." }
  }

  if (params.moderation === "report-actioned") {
    return { tone: "success" as const, message: "Report action applied." }
  }

  if (params.moderation === "report-reviewed") {
    return { tone: "success" as const, message: "Report reviewed." }
  }

  if (params.moderation === "payout-settled") {
    return {
      tone: "success" as const,
      message: `Creator payout settled. ${params.paid ?? "0"} transfer(s) created.`,
    }
  }

  return null
}

function MetricCard({
  icon,
  label,
  value,
  subtext,
}: {
  icon: ReactNode
  label: string
  value: string
  subtext: string
}) {
  return (
    <article className="rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#6b7280]">{label}</p>
          <p className="mt-3 text-3xl font-medium tracking-tight text-[#111827]">
            {value}
          </p>
        </div>
        <span className="flex size-10 items-center justify-center rounded-[8px] bg-[#f3f4f6] text-[#374151]">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-sm text-[#6b7280]">{subtext}</p>
    </article>
  )
}

function Flash({
  message,
}: {
  message: ReturnType<typeof flashMessage>
}) {
  if (!message) return null

  return (
    <div
      className={
        message.tone === "error"
          ? "rounded-[8px] border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]"
          : "rounded-[8px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#166534]"
      }
    >
      {message.message}
    </div>
  )
}

function StoryPreview({ story }: { story: AdminModerationStory }) {
  const imageUrl = story.thumbnailUrl ?? story.mediaUrl

  if (story.assetKind === "image" && imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className="h-full w-full object-cover"
      />
    )
  }

  if (story.assetKind === "video" && story.mediaUrl) {
    return (
      <video
        src={story.mediaUrl}
        poster={story.thumbnailUrl ?? undefined}
        controls
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    )
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#111827] text-white">
      <ShieldAlert className="size-8" />
    </div>
  )
}

function ModerationRow({ story }: { story: AdminModerationStory }) {
  const isUserReport = story.moderationReason?.startsWith("User report:")
  const moderationCategories = story.moderationCheck
    ? formatModerationCategories(story.moderationCheck.categories)
    : []

  return (
    <article className="grid gap-4 rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm lg:grid-cols-[12rem_1fr_auto]">
      <div className="aspect-[9/16] overflow-hidden rounded-[8px] bg-[#f3f4f6]">
        <StoryPreview story={story} />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#fef3c7] px-3 py-1 text-xs font-medium text-[#92400e]">
            {isUserReport ? "Reported" : "Flagged"}
          </span>
          <span className="text-sm text-[#6b7280]">
            {formatDate(story.createdAt)}
          </span>
        </div>

        <h2 className="mt-3 text-xl font-[350] text-[#111827]">
          {story.creatorName ?? "Unnamed creator"}
        </h2>
        <p className="mt-1 text-sm text-[#6b7280]">
          {story.creatorHandle ? `@${story.creatorHandle}` : story.creatorEmail}
        </p>

        <p className="mt-5 text-sm font-medium text-[#374151]">
          Moderation reason
        </p>
        <p className="mt-1 text-sm leading-6 text-[#6b7280]">
          {story.moderationReason ?? "Flagged for review."}
        </p>
        {story.moderationCheck ? (
          <div className="mt-4 rounded-[8px] border border-[#e5e7eb] bg-[#f9fafb] p-3">
            <div className="flex flex-wrap gap-2 text-xs font-medium text-[#374151]">
              <span>Provider: {story.moderationCheck.provider}</span>
              <span>Action: {story.moderationCheck.action}</span>
            </div>
            {story.moderationCheck.reason ? (
              <p className="mt-2 text-sm leading-6 text-[#6b7280]">
                {story.moderationCheck.reason}
              </p>
            ) : null}
            {moderationCategories.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {moderationCategories.map((label) => (
                  <span
                    key={label}
                    className="rounded-full bg-white px-2 py-1 text-xs font-medium text-[#6b7280]"
                  >
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
            {story.moderationCheck.error ? (
              <p className="mt-2 text-xs text-[#be123c]">
                {story.moderationCheck.error}
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="mt-5 text-sm font-medium text-[#374151]">Caption</p>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#111827]">
          {story.caption?.trim() || "No caption."}
        </p>
      </div>

      <div className="flex gap-2 lg:flex-col">
        <form action={approveModeratedStoryAction}>
          <input type="hidden" name="storyId" value={story.id} />
          <button className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#111827] px-4 text-sm font-medium text-white">
            <Check className="size-4" />
            Approve
          </button>
        </form>

        <form action={rejectModeratedStoryAction}>
          <input type="hidden" name="storyId" value={story.id} />
          <button className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#fecdd3] bg-[#fff1f2] px-4 text-sm font-medium text-[#be123c]">
            <Trash2 className="size-4" />
            Remove
          </button>
        </form>
      </div>
    </article>
  )
}

function SafetyReportRow({ report }: { report: AdminSafetyReport }) {
  const targetLabel =
    report.targetUser?.handle ??
    report.targetUser?.email ??
    report.story?.id ??
    report.interaction?.id ??
    "Unknown target"
  const body =
    report.targetKind === "interaction"
      ? report.interaction?.body || report.interaction?.reaction || "Reply"
      : report.targetKind === "story"
        ? report.story?.caption || "Story"
        : report.details || "Account report"

  return (
    <article className="grid gap-4 rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm lg:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#fee2e2] px-3 py-1 text-xs font-medium text-[#991b1b]">
            {report.targetKind}
          </span>
          <span className="rounded-full bg-[#eef2ff] px-3 py-1 text-xs font-medium text-[#3730a3]">
            {formatSafetyReportReason(report.reason)}
          </span>
          <span className="text-sm text-[#6b7280]">
            {formatDate(report.createdAt)}
          </span>
        </div>

        <h3 className="mt-3 text-lg font-[350] text-[#111827]">
          {targetLabel}
        </h3>
        <p className="mt-1 text-sm text-[#6b7280]">
          Reported by{" "}
          {report.reporter.handle
            ? `@${report.reporter.handle}`
            : report.reporter.email}
        </p>

        <p className="mt-4 max-w-3xl text-sm leading-6 text-[#111827]">
          {body}
        </p>
        {report.details ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6b7280]">
            {report.details}
          </p>
        ) : null}
      </div>

      <div className="flex gap-2 lg:flex-col">
        <form action={reviewSafetyReportAction}>
          <input type="hidden" name="reportId" value={report.id} />
          <input type="hidden" name="status" value="dismissed" />
          <button className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#d1d5db] bg-white px-4 text-sm font-medium text-[#374151]">
            <Check className="size-4" />
            Dismiss
          </button>
        </form>

        <form action={reviewSafetyReportAction}>
          <input type="hidden" name="reportId" value={report.id} />
          <input type="hidden" name="status" value="actioned" />
          <button className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#fecdd3] bg-[#fff1f2] px-4 text-sm font-medium text-[#be123c]">
            <Trash2 className="size-4" />
            Action
          </button>
        </form>
      </div>
    </article>
  )
}

function CreatorPayoutRow({ payout }: { payout: AdminCreatorPayout }) {
  const isReady =
    Boolean(payout.stripeConnectedAccountId) &&
    payout.stripePayoutsEnabled &&
    payout.stripeOnboardingComplete
  const statusLabel = isReady
    ? "Ready"
    : payout.stripeConnectedAccountId
      ? "Stripe action needed"
      : "No Stripe account"

  return (
    <article className="grid gap-4 rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm lg:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              isReady
                ? "rounded-full bg-[#dcfce7] px-3 py-1 text-xs font-medium text-[#166534]"
                : "rounded-full bg-[#fef3c7] px-3 py-1 text-xs font-medium text-[#92400e]"
            }
          >
            {statusLabel}
          </span>
          <span className="text-sm text-[#6b7280]">
            {payout.ledgerCount} ledger item
            {payout.ledgerCount === 1 ? "" : "s"}
          </span>
          <span className="text-sm text-[#6b7280]">
            Latest {formatDate(payout.latestCreatedAt)}
          </span>
        </div>

        <h3 className="mt-3 text-lg font-[350] text-[#111827]">
          {payout.creatorName ?? "Unnamed creator"}
        </h3>
        <p className="mt-1 text-sm text-[#6b7280]">
          {payout.creatorHandle
            ? `@${payout.creatorHandle}`
            : payout.creatorEmail}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[8px] bg-[#f9fafb] px-4 py-3">
            <p className="text-sm text-[#6b7280]">Available</p>
            <p className="mt-2 text-xl font-medium">
              {formatMoney(payout.amountCents)}
            </p>
          </div>
          <div className="rounded-[8px] bg-[#f9fafb] px-4 py-3">
            <p className="text-sm text-[#6b7280]">Oldest available</p>
            <p className="mt-2 text-sm font-medium">
              {payout.oldestAvailableAt
                ? formatDate(payout.oldestAvailableAt)
                : "Now"}
            </p>
          </div>
          <div className="rounded-[8px] bg-[#f9fafb] px-4 py-3">
            <p className="text-sm text-[#6b7280]">Stripe requirements</p>
            <p className="mt-2 text-sm font-medium">
              {payout.stripeRequirementsStatus ?? "None reported"}
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 lg:flex-col">
        <form action={settleCreatorPayoutAction}>
          <input type="hidden" name="userId" value={payout.userId} />
          <button
            disabled={!isReady}
            className={
              isReady
                ? "inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#111827] px-4 text-sm font-medium text-white"
                : "inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-[8px] bg-[#e5e7eb] px-4 text-sm font-medium text-[#6b7280]"
            }
          >
            <BadgeDollarSign className="size-4" />
            Settle
          </button>
        </form>
      </div>
    </article>
  )
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const [session, params] = await Promise.all([
    requireAdminSession(),
    searchParams,
  ])
  const [overview, flaggedStories, safetyReports, creatorPayouts] = await Promise.all([
    getAdminOverview(),
    listFlaggedStories(),
    listAdminSafetyReports(),
    listAdminCreatorPayouts(),
  ])
  const flash = flashMessage(params)

  return (
    <main className="min-h-screen bg-[#f3f4f6] px-4 py-5 text-[#111827] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-medium text-[#6b7280]">Admin</p>
            <h1 className="text-2xl font-[350] tracking-tight">
              Marketplace operations
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-sm text-[#4b5563]">
              {session.email}
            </span>
            <form action={logoutAction}>
              <button className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#111827] px-4 text-sm font-medium text-white">
                <LogOut className="size-4" />
                Sign out
              </button>
            </form>
          </div>
        </header>

        <div className="mt-4">
          <Flash message={flash} />
        </div>

        <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={<Building2 className="size-5" />}
            label="Advertisers"
            value={formatNumber(overview.advertiserCount)}
            subtext={`${formatNumber(overview.activeAdvertiserCount)} with active funding rules`}
          />
          <MetricCard
            icon={<Users className="size-5" />}
            label="Users"
            value={formatNumber(overview.userCount)}
            subtext={`${formatNumber(overview.creatorCount)} active creators`}
          />
          <MetricCard
            icon={<WalletCards className="size-5" />}
            label="Active budget"
            value={formatMoney(overview.activeBudgetCents)}
            subtext={`${formatMoney(overview.fundedBudgetCents)} total funded`}
          />
          <MetricCard
            icon={<AlertTriangle className="size-5" />}
            label="Review queue"
            value={formatNumber(
              overview.flaggedStoryCount + overview.pendingReportCount,
            )}
            subtext={`${formatNumber(overview.pendingReportCount)} user reports`}
          />
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <article className="rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-[350]">Budget snapshot</h2>
                <p className="mt-1 text-sm text-[#6b7280]">
                  Posted wallet movement across advertiser accounts.
                </p>
              </div>
              <BadgeDollarSign className="size-5 text-[#374151]" />
            </div>

            <div className="mt-5 grid gap-3">
              <div className="flex items-center justify-between rounded-[8px] bg-[#f9fafb] px-4 py-3">
                <span className="text-sm font-medium text-[#6b7280]">
                  Funded
                </span>
                <span className="font-medium">
                  {formatMoney(overview.fundedBudgetCents)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-[#f9fafb] px-4 py-3">
                <span className="text-sm font-medium text-[#6b7280]">
                  Available
                </span>
                <span className="font-medium">
                  {formatMoney(overview.activeBudgetCents)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-[#f9fafb] px-4 py-3">
                <span className="text-sm font-medium text-[#6b7280]">
                  Pending
                </span>
                <span className="font-medium">
                  {formatMoney(overview.pendingBudgetCents)}
                </span>
              </div>
            </div>
          </article>

          <article className="rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-[350]">Moderation flow</h2>
                <p className="mt-1 text-sm text-[#6b7280]">
                  Flagged stories stay out of the live feed until reviewed.
                </p>
              </div>
              <Clock3 className="size-5 text-[#374151]" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[8px] bg-[#f9fafb] p-4">
                <p className="text-sm text-[#6b7280]">Flagged</p>
                <p className="mt-2 text-2xl font-medium">
                  {formatNumber(overview.flaggedStoryCount)}
                </p>
              </div>
              <div className="rounded-[8px] bg-[#f9fafb] p-4">
                <p className="text-sm text-[#6b7280]">Approve action</p>
                <p className="mt-2 text-sm font-medium">Moves story live</p>
              </div>
              <div className="rounded-[8px] bg-[#f9fafb] p-4">
                <p className="text-sm text-[#6b7280]">Remove action</p>
                <p className="mt-2 text-sm font-medium">Marks story removed</p>
              </div>
            </div>
          </article>
        </section>

        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-[350]">Creator payouts</h2>
              <p className="mt-1 text-sm text-[#6b7280]">
                Manually settle approved, available earnings for creators whose
                Stripe payout account is ready.
              </p>
            </div>
            <BadgeDollarSign className="size-5 text-[#374151]" />
          </div>

          {creatorPayouts.length > 0 ? (
            <div className="grid gap-4">
              {creatorPayouts.map((payout) => (
                <CreatorPayoutRow key={payout.userId} payout={payout} />
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-8 text-center shadow-sm">
              <BadgeDollarSign className="mx-auto size-8 text-[#9ca3af]" />
              <h3 className="mt-3 text-lg font-[350]">
                No payouts awaiting settlement
              </h3>
              <p className="mt-1 text-sm text-[#6b7280]">
                Approved creator earnings will appear here once they are
                available for review.
              </p>
            </div>
          )}
        </section>

        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-[350]">User reports</h2>
              <p className="mt-1 text-sm text-[#6b7280]">
                Reports against stories, accounts, and replies.
              </p>
            </div>
            <Flag className="size-5 text-[#374151]" />
          </div>

          {safetyReports.length > 0 ? (
            <div className="grid gap-4">
              {safetyReports.map((report) => (
                <SafetyReportRow key={report.id} report={report} />
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-8 text-center shadow-sm">
              <Flag className="mx-auto size-8 text-[#9ca3af]" />
              <h3 className="mt-3 text-lg font-[350]">No user reports</h3>
              <p className="mt-1 text-sm text-[#6b7280]">
                Reports submitted from web or mobile will appear here.
              </p>
            </div>
          )}
        </section>

        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-[350]">Review queue</h2>
              <p className="mt-1 text-sm text-[#6b7280]">
                User reports and automated flags from captions, overlays, tags,
                and links.
              </p>
            </div>
          </div>

          {flaggedStories.length > 0 ? (
            <div className="grid gap-4">
              {flaggedStories.map((story) => (
                <ModerationRow key={story.id} story={story} />
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-8 text-center shadow-sm">
              <ShieldAlert className="mx-auto size-8 text-[#9ca3af]" />
              <h3 className="mt-3 text-lg font-[350]">No stories in review</h3>
              <p className="mt-1 text-sm text-[#6b7280]">
                New flags will appear here before they can enter the feed.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
