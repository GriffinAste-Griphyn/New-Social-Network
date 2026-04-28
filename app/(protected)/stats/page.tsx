import Image from "next/image"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import {
  ArrowLeft,
  BarChart3,
  Clock3,
  Eye,
  MessageCircle,
  Radio,
  Users,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { requireSession } from "@/lib/auth"
import type { CreatorStoryStats } from "@/lib/creator-stats"
import { getCreatorStats } from "@/lib/creator-stats"

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function StoryThumb({ story }: { story: CreatorStoryStats }) {
  const imageUrl = story.thumbnailUrl ?? story.mediaUrl

  if (story.assetKind === "video" && story.thumbnailUrl === null) {
    return (
      <div className="flex size-14 items-center justify-center rounded-[8px] bg-[#111827] text-white">
        <Radio className="size-5" />
      </div>
    )
  }

  return (
    <div className="relative size-14 overflow-hidden rounded-[8px] bg-[#f5f6f8]">
      <Image
        src={imageUrl}
        alt="Story thumbnail"
        fill
        sizes="56px"
        className="object-cover"
      />
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  subtext,
}: {
  icon: ReactNode
  label: string
  value: string
  subtext?: string
}) {
  return (
    <article className="rounded-[8px] bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[#6b7280]">{label}</p>
        <span className="flex size-9 items-center justify-center rounded-full bg-[#f5f6f8] text-[#374151]">
          {icon}
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-[#17191f]">
        {value}
      </p>
      {subtext ? (
        <p className="mt-1 text-sm text-[#6b7280]">{subtext}</p>
      ) : null}
    </article>
  )
}

export default async function CreatorStatsPage() {
  const session = await requireSession()

  if (session.creatorStatus !== "active") {
    redirect("/feed")
  }

  const stats = await getCreatorStats(session.id)
  const recentStories = stats.stories.slice(0, 12)

  return (
    <main className="min-h-screen bg-[#eef0f3] px-4 py-5 text-[#17191f] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1180px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-white px-4 py-3 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
          <div className="flex items-center gap-3">
            <a
              href="/feed"
              aria-label="Back to feed"
              className="flex size-10 items-center justify-center rounded-full bg-[#f5f6f8] text-[#374151]"
            >
              <ArrowLeft className="size-5" />
            </a>
            <div>
              <p className="text-sm text-[#6b7280]">@{session.handle}</p>
              <h1 className="text-2xl font-semibold tracking-tight">
                Creator stats
              </h1>
            </div>
          </div>

          <a
            href="/stories/me"
            className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#111827] px-4 text-sm font-medium text-white"
          >
            <Radio className="size-4" />
            My Story
          </a>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Users className="size-4" />}
            label="Followers"
            value={formatNumber(stats.followerCount)}
            subtext={`${formatNumber(stats.followingCount)} following`}
          />
          <StatCard
            icon={<Eye className="size-4" />}
            label="Views"
            value={formatNumber(stats.totalViews)}
            subtext={`${formatNumber(stats.uniqueViewers)} unique viewers`}
          />
          <StatCard
            icon={<BarChart3 className="size-4" />}
            label="Completion"
            value={`${stats.completionRate}%`}
            subtext={`${formatNumber(stats.completedViews)} completed views`}
          />
          <StatCard
            icon={<MessageCircle className="size-4" />}
            label="Comments"
            value={formatNumber(stats.comments)}
            subtext={`${formatNumber(stats.replies)} story replies`}
          />
        </section>

        <section className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <article className="rounded-[8px] bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Story activity</h2>
                <p className="mt-1 text-sm text-[#6b7280]">
                  {stats.totalStories} total stories
                </p>
              </div>
              <Badge className="border-none bg-[#f5f6f8] text-[#374151]">
                {stats.liveStories} live
              </Badge>
            </div>

            <div className="mt-5 grid gap-3">
              <div className="flex items-center justify-between rounded-[8px] bg-[#f5f6f8] px-4 py-3">
                <span className="text-sm font-medium text-[#6b7280]">Live</span>
                <span className="font-semibold">{stats.liveStories}</span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-[#f5f6f8] px-4 py-3">
                <span className="text-sm font-medium text-[#6b7280]">Expired</span>
                <span className="font-semibold">{stats.expiredStories}</span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-[#f5f6f8] px-4 py-3">
                <span className="text-sm font-medium text-[#6b7280]">Removed</span>
                <span className="font-semibold">{stats.removedStories}</span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-[#f5f6f8] px-4 py-3">
                <span className="text-sm font-medium text-[#6b7280]">
                  Avg. view time
                </span>
                <span className="font-semibold">
                  {stats.averageViewedSeconds}s
                </span>
              </div>
            </div>
          </article>

          <article className="rounded-[8px] bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Recent stories</h2>
                <p className="mt-1 text-sm text-[#6b7280]">
                  Per-item views and completion.
                </p>
              </div>
              <Clock3 className="size-5 text-[#9ca3af]" />
            </div>

            <div className="mt-4 divide-y divide-[#e5e7eb]">
              {recentStories.length > 0 ? (
                recentStories.map((story) => (
                  <div
                    key={story.id}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3"
                  >
                    <StoryThumb story={story} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">
                          {story.caption || "Untitled story"}
                        </p>
                        <Badge className="border-none bg-[#f5f6f8] text-[#374151]">
                          {story.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-[#6b7280]">
                        {formatDate(story.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatNumber(story.views)} views
                      </p>
                      <p className="mt-1 text-sm text-[#6b7280]">
                        {story.completionRate}% complete
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[8px] bg-[#f5f6f8] p-6 text-center">
                  <p className="font-semibold">No stories yet</p>
                  <p className="mt-1 text-sm text-[#6b7280]">
                    Post a story to start building your creator stats.
                  </p>
                </div>
              )}
            </div>
          </article>
        </section>
      </div>
    </main>
  )
}
