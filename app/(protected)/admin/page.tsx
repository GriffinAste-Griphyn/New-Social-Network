import Link from "next/link"
import type { ReactNode } from "react"
import {
  AlertTriangle,
  BadgeDollarSign,
  Building2,
  Check,
  Clock3,
  LogOut,
  ShieldAlert,
  Trash2,
  Users,
  WalletCards,
} from "lucide-react"

import {
  approveModeratedStoryAction,
  rejectModeratedStoryAction,
} from "@/lib/admin-actions"
import {
  getAdminOverview,
  listFlaggedStories,
  requireAdminSession,
  type AdminModerationStory,
} from "@/lib/admin-store"
import { logoutAction } from "@/lib/auth-actions"

type AdminPageProps = {
  searchParams: Promise<{
    error?: string
    moderation?: string
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

function flashMessage(params: Awaited<AdminPageProps["searchParams"]>) {
  if (params.error) return { tone: "error" as const, message: params.error }

  if (params.moderation === "approved") {
    return { tone: "success" as const, message: "Story approved." }
  }

  if (params.moderation === "removed") {
    return { tone: "success" as const, message: "Story removed." }
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
          <p className="mt-3 text-3xl font-semibold tracking-tight text-[#111827]">
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

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#111827] text-white">
      <ShieldAlert className="size-8" />
    </div>
  )
}

function ModerationRow({ story }: { story: AdminModerationStory }) {
  return (
    <article className="grid gap-4 rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm lg:grid-cols-[12rem_1fr_auto]">
      <div className="aspect-[9/16] overflow-hidden rounded-[8px] bg-[#f3f4f6]">
        <StoryPreview story={story} />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#fef3c7] px-3 py-1 text-xs font-medium text-[#92400e]">
            Flagged
          </span>
          <span className="text-sm text-[#6b7280]">
            {formatDate(story.createdAt)}
          </span>
        </div>

        <h2 className="mt-3 text-xl font-semibold text-[#111827]">
          {story.creatorName ?? "Unnamed creator"}
        </h2>
        <p className="mt-1 text-sm text-[#6b7280]">
          {story.creatorHandle ? `@${story.creatorHandle}` : story.creatorEmail}
        </p>

        <p className="mt-5 text-sm font-medium text-[#374151]">
          Moderation reason
        </p>
        <p className="mt-1 text-sm leading-6 text-[#6b7280]">
          {story.moderationReason ?? "Flagged by automated review."}
        </p>

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

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const [session, params] = await Promise.all([
    requireAdminSession(),
    searchParams,
  ])
  const [overview, flaggedStories] = await Promise.all([
    getAdminOverview(),
    listFlaggedStories(),
  ])
  const flash = flashMessage(params)

  return (
    <main className="min-h-screen bg-[#f3f4f6] px-4 py-5 text-[#111827] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-medium text-[#6b7280]">Admin</p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Marketplace operations
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-sm text-[#4b5563]">
              {session.email}
            </span>
            <Link
              href="/feed"
              className="inline-flex h-10 items-center rounded-[8px] border border-[#d1d5db] bg-white px-4 text-sm font-medium text-[#374151]"
            >
              Feed
            </Link>
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
            value={formatNumber(overview.flaggedStoryCount)}
            subtext="Stories held before feed distribution"
          />
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <article className="rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Budget snapshot</h2>
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
                <span className="font-semibold">
                  {formatMoney(overview.fundedBudgetCents)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-[#f9fafb] px-4 py-3">
                <span className="text-sm font-medium text-[#6b7280]">
                  Available
                </span>
                <span className="font-semibold">
                  {formatMoney(overview.activeBudgetCents)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-[#f9fafb] px-4 py-3">
                <span className="text-sm font-medium text-[#6b7280]">
                  Pending
                </span>
                <span className="font-semibold">
                  {formatMoney(overview.pendingBudgetCents)}
                </span>
              </div>
            </div>
          </article>

          <article className="rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Moderation flow</h2>
                <p className="mt-1 text-sm text-[#6b7280]">
                  Flagged stories stay out of the live feed until reviewed.
                </p>
              </div>
              <Clock3 className="size-5 text-[#374151]" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[8px] bg-[#f9fafb] p-4">
                <p className="text-sm text-[#6b7280]">Flagged</p>
                <p className="mt-2 text-2xl font-semibold">
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
              <h2 className="text-xl font-semibold">Review queue</h2>
              <p className="mt-1 text-sm text-[#6b7280]">
                Automated flags from story captions, overlays, tags, and links.
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
              <h3 className="mt-3 text-lg font-semibold">No stories in review</h3>
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
