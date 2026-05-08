"use client"

import Image from "next/image"
import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import {
  BadgeDollarSign,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  MessageCircle,
  Radio,
  Users,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { CreatorStoryStats } from "@/lib/creator-stats"
import type { MyStoryItem } from "@/lib/story-store"

type MyStoryInsightsViewerProps = {
  stories: MyStoryItem[]
  storyStats: CreatorStoryStats[]
}

type MetricProps = {
  icon: ReactNode
  label: string
  value: string
  detail?: string
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value)
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function formatPostedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatRemaining(minutes: number) {
  if (minutes < 60) {
    return `${Math.max(1, minutes)}m remaining`
  }

  return `${Math.ceil(minutes / 60)}h remaining`
}

function Metric({ icon, label, value, detail }: MetricProps) {
  return (
    <div className="min-h-[104px] rounded-[8px] bg-[#f5f6f8] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-[#6b7280]">{label}</p>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[#374151]">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-[#17191f]">
        {value}
      </p>
      {detail ? <p className="mt-1 text-xs text-[#6b7280]">{detail}</p> : null}
    </div>
  )
}

export function MyStoryInsightsViewer({
  stories,
  storyStats,
}: MyStoryInsightsViewerProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const statsByStoryId = useMemo(
    () => new Map(storyStats.map((story) => [story.id, story])),
    [storyStats],
  )
  const boundedIndex = Math.min(activeIndex, Math.max(stories.length - 1, 0))
  const activeStory = stories[boundedIndex]
  const activeStats = activeStory ? statsByStoryId.get(activeStory.id) : null

  if (!activeStory) {
    return null
  }

  const stickers = activeStory.elements.filter(
    (element) => element.kind === "sticker",
  )
  const textElements = activeStory.elements.filter(
    (element) => element.kind === "text",
  )
  const links = activeStory.elements.filter((element) => element.kind === "link")
  const views = activeStats?.views ?? 0
  const uniqueViewers = activeStats?.uniqueViewers ?? 0
  const completedViews = activeStats?.completedViews ?? 0
  const completionRate = activeStats?.completionRate ?? 0
  const averageViewedSeconds = activeStats?.averageViewedSeconds ?? 0
  const comments = activeStats?.comments ?? 0
  const replies = activeStats?.replies ?? 0
  const earningsCents = activeStats?.earningsCents ?? 0

  const goPrevious = () => {
    setActiveIndex((current) =>
      current === 0 ? Math.max(stories.length - 1, 0) : current - 1,
    )
  }

  const goNext = () => {
    setActiveIndex((current) =>
      current >= stories.length - 1 ? 0 : current + 1,
    )
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-[8px] bg-neutral-950 shadow-[0_24px_70px_rgba(15,23,42,0.2)]">
        <div className="relative min-h-[720px]">
          {activeStory.assetKind === "video" ? (
            <video
              key={activeStory.id}
              src={activeStory.mediaUrl}
              poster={activeStory.thumbnailUrl ?? undefined}
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              controls
            />
          ) : (
            <Image
              key={activeStory.id}
              src={activeStory.mediaUrl}
              alt="Your story"
              fill
              sizes="(min-width: 1024px) 620px, 100vw"
              className="object-cover"
              priority={boundedIndex === 0}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/80" />

          <div className="relative flex min-h-[720px] flex-col justify-between p-5 text-white">
            <div className="space-y-4">
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(stories.length, 1)}, minmax(0, 1fr))`,
                }}
              >
                {stories.map((story, index) => (
                  <button
                    key={story.id}
                    type="button"
                    aria-label={`Show story ${index + 1}`}
                    onClick={() => setActiveIndex(index)}
                    className="h-2 overflow-hidden rounded-full bg-white/35"
                  >
                    <span
                      className={`block h-full rounded-full ${
                        index === boundedIndex ? "bg-white" : "bg-white/55"
                      }`}
                    />
                  </button>
                ))}
              </div>

              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">My Story</p>
                  <p className="mt-1 text-sm text-white/70">
                    {formatPostedAt(activeStory.createdAt)} ·{" "}
                    {formatRemaining(activeStory.minutesRemaining)}
                  </p>
                </div>
                <Badge className="border-none bg-white/14 text-white backdrop-blur">
                  {boundedIndex + 1}/{stories.length}
                </Badge>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {stickers.map((element) => (
                  <Badge
                    key={element.id}
                    className="border-none bg-[#fde047] text-[#17191f]"
                  >
                    {element.label}
                  </Badge>
                ))}
                {activeStory.brandTags.map((tag) => (
                  <Badge key={tag} className="border-none bg-white/14 text-white">
                    #{tag}
                  </Badge>
                ))}
              </div>

              <div className="max-w-md space-y-3">
                {textElements.map((element) => (
                  <p
                    key={element.id}
                    className="w-fit rounded-[8px] bg-white/14 px-3 py-2 text-xl font-semibold backdrop-blur"
                  >
                    {element.label}
                  </p>
                ))}

                {activeStory.caption ? (
                  <p className="text-3xl font-semibold leading-tight">
                    {activeStory.caption}
                  </p>
                ) : null}
              </div>

              {links.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {links.map((element) => (
                    <a
                      key={element.id}
                      href={element.href ?? "#"}
                      className="inline-flex min-h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-[#17191f]"
                    >
                      {element.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>

            {stories.length > 1 ? (
              <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-between px-3">
                <button
                  type="button"
                  aria-label="Previous story"
                  onClick={goPrevious}
                  className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-black/38 text-white backdrop-blur"
                >
                  <ChevronLeft className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next story"
                  onClick={goNext}
                  className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-black/38 text-white backdrop-blur"
                >
                  <ChevronRight className="size-5" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <aside className="rounded-[8px] bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[#6b7280]">
              Live story insights
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              {activeStory.caption || "Untitled story"}
            </h2>
          </div>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f5f6f8] text-[#374151]">
            <BarChart3 className="size-5" />
          </span>
        </div>

        <div className="mt-4 grid gap-3">
          <Metric
            icon={<Eye className="size-4" />}
            label="Views"
            value={formatNumber(views)}
            detail={`${formatNumber(uniqueViewers)} unique`}
          />
          <Metric
            icon={<BarChart3 className="size-4" />}
            label="Completion"
            value={`${completionRate}%`}
            detail={`${formatNumber(completedViews)} completed`}
          />
          <Metric
            icon={<Clock3 className="size-4" />}
            label="Avg. watch"
            value={`${averageViewedSeconds}s`}
            detail={formatRemaining(activeStory.minutesRemaining)}
          />
          <Metric
            icon={<MessageCircle className="size-4" />}
            label="Comments"
            value={formatNumber(comments)}
            detail={`${formatNumber(replies)} replies`}
          />
          <Metric
            icon={<BadgeDollarSign className="size-4" />}
            label="Earnings"
            value={formatMoney(earningsCents)}
            detail={`${activeStats?.status ?? activeStory.assetKind} story`}
          />
        </div>

        {stories.length > 1 ? (
          <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button
              type="button"
              onClick={goPrevious}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] bg-[#f5f6f8] px-3 text-sm font-semibold text-[#374151]"
            >
              <ChevronLeft className="size-4" />
              Previous
            </button>
            <span className="text-sm font-medium text-[#6b7280]">
              {boundedIndex + 1}/{stories.length}
            </span>
            <button
              type="button"
              onClick={goNext}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] bg-[#111827] px-3 text-sm font-semibold text-white"
            >
              Next
              <ChevronRight className="size-4" />
            </button>
          </div>
        ) : null}

        <div className="mt-4 grid gap-2">
          {stories.map((story, index) => (
            <button
              type="button"
              key={story.id}
              onClick={() => setActiveIndex(index)}
              className={`grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] px-3 text-left ${
                index === boundedIndex
                  ? "bg-[#111827] text-white"
                  : "bg-[#f5f6f8] text-[#17191f]"
              }`}
            >
              <span
                className={`flex size-8 items-center justify-center rounded-full ${
                  index === boundedIndex
                    ? "bg-white/16 text-white"
                    : "bg-white text-[#374151]"
                }`}
              >
                <Radio className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {story.caption || "Untitled story"}
                </span>
                <span
                  className={`block text-xs ${
                    index === boundedIndex ? "text-white/70" : "text-[#6b7280]"
                  }`}
                >
                  {formatPostedAt(story.createdAt)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold">
                <Users className="size-3.5" />
                {formatNumber(statsByStoryId.get(story.id)?.views ?? 0)}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  )
}
