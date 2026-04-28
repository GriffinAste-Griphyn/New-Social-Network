"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type SocialAnalyticsSummary = {
  followers: number
  following: number
  muted: number
  blocked: number
  totalStoryFrames: number
  liveStoryFrames: number
  storyFramesInRange: number
  storyUploadsInRange: number
  totalStoryViews: number
  uniqueStoryViewers: number
  storyViewsInRange: number
  uniqueStoryViewersInRange: number
}

type SocialAnalyticsDay = {
  day: string
  views: number
  viewers: number
}

type SocialAnalyticsStory = {
  id: string
  label: string
  mediaType: string
  createdAt: string
  views: number
  uniqueViewers: number
}

type SocialAnalyticsRange = {
  startDate: string
  endDate: string
  days: number
}

type SocialAnalyticsResponse = {
  summary?: SocialAnalyticsSummary
  range?: SocialAnalyticsRange
  dailyViews?: SocialAnalyticsDay[]
  recentStories?: SocialAnalyticsStory[]
  error?: string
}

type DateRangePreset = "7d" | "14d" | "30d" | "90d" | "custom"

const ANALYTICS_PATH = "/social-network/profile/analytics"
const PROFILE_PATH = "/social-network/profile"
const FOLLOWING_PATH = "/social-network/following"
const SOCIAL_APP_PATH = "/social-network/app"

const DATE_PRESET_DAYS: Record<Exclude<DateRangePreset, "custom">, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
}

const EMPTY_SOCIAL_ANALYTICS_SUMMARY: SocialAnalyticsSummary = {
  followers: 0,
  following: 0,
  muted: 0,
  blocked: 0,
  totalStoryFrames: 0,
  liveStoryFrames: 0,
  storyFramesInRange: 0,
  storyUploadsInRange: 0,
  totalStoryViews: 0,
  uniqueStoryViewers: 0,
  storyViewsInRange: 0,
  uniqueStoryViewersInRange: 0,
}

function deriveHandle(email: string, claimedUsername: string) {
  if (claimedUsername.trim()) return claimedUsername.trim()
  const local = email.trim().toLowerCase().split("@")[0] || ""
  const normalized = local.replace(/[^a-z0-9._-]/g, "").slice(0, 15)
  return normalized.length >= 3 ? normalized : "guest"
}

function formatDateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseInputDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map((part) => Number(part))
  const parsed = new Date(year, month - 1, day)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null
  return parsed
}

function diffDaysInclusive(startDate: string, endDate: string) {
  const start = parseInputDate(startDate)
  const end = parseInputDate(endDate)
  if (!start || !end) return 0

  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())

  return Math.floor((endUtc - startUtc) / (24 * 60 * 60 * 1000)) + 1
}

function getPresetRange(preset: Exclude<DateRangePreset, "custom">) {
  const end = new Date()
  end.setHours(0, 0, 0, 0)

  const start = new Date(end)
  start.setDate(start.getDate() - DATE_PRESET_DAYS[preset] + 1)

  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  }
}

function formatRangeLabel(startDate: string, endDate: string) {
  const start = parseInputDate(startDate)
  const end = parseInputDate(endDate)
  if (!start || !end) return `${startDate} - ${endDate}`

  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  const endLabel = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  if (startDate === endDate) return startLabel
  return `${startLabel} - ${endLabel}`
}

export default function SocialNetworkAnalyticsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")

  const [socialAnalyticsError, setSocialAnalyticsError] = useState<string | null>(null)
  const [loadingSocialAnalytics, setLoadingSocialAnalytics] = useState(false)
  const [socialAnalyticsSummary, setSocialAnalyticsSummary] = useState<SocialAnalyticsSummary>(EMPTY_SOCIAL_ANALYTICS_SUMMARY)
  const [socialAnalyticsDailyViews, setSocialAnalyticsDailyViews] = useState<SocialAnalyticsDay[]>([])
  const [socialAnalyticsRecentStories, setSocialAnalyticsRecentStories] = useState<SocialAnalyticsStory[]>([])

  const initialDateRange = useMemo(() => getPresetRange("14d"), [])
  const [rangePreset, setRangePreset] = useState<DateRangePreset>("14d")
  const [rangeStartDate, setRangeStartDate] = useState(initialDateRange.startDate)
  const [rangeEndDate, setRangeEndDate] = useState(initialDateRange.endDate)
  const [rangeValidationError, setRangeValidationError] = useState<string | null>(null)
  const [socialAnalyticsRange, setSocialAnalyticsRange] = useState<SocialAnalyticsRange>({
    startDate: initialDateRange.startDate,
    endDate: initialDateRange.endDate,
    days: 14,
  })

  const displayHandle = useMemo(() => deriveHandle(email, username), [email, username])
  const maxDailyStoryViews = useMemo(() => {
    return socialAnalyticsDailyViews.reduce((max, row) => Math.max(max, row.views), 0)
  }, [socialAnalyticsDailyViews])

  const loadSocialAnalytics = async (startDate: string, endDate: string) => {
    setLoadingSocialAnalytics(true)
    setSocialAnalyticsError(null)

    try {
      const query = new URLSearchParams({ startDate, endDate })
      const response = await fetch(`/api/social-network/analytics?${query.toString()}`, { cache: "no-store" }).catch(() => null)
      if (!response || !response.ok) {
        const body = response ? await response.json().catch(() => null) : null
        setSocialAnalyticsSummary(EMPTY_SOCIAL_ANALYTICS_SUMMARY)
        setSocialAnalyticsDailyViews([])
        setSocialAnalyticsRecentStories([])
        setSocialAnalyticsError(body?.error || "Could not load social analytics right now.")
        return false
      }

      const body = (await response.json().catch(() => null)) as SocialAnalyticsResponse | null
      const summary = body?.summary || EMPTY_SOCIAL_ANALYTICS_SUMMARY
      const dailyViews = Array.isArray(body?.dailyViews) ? body.dailyViews : []
      const recentStories = Array.isArray(body?.recentStories) ? body.recentStories : []
      const rangeDays = Number(body?.range?.days)

      setSocialAnalyticsSummary({
        followers: Number.isFinite(Number(summary.followers)) ? Math.max(0, Math.trunc(Number(summary.followers))) : 0,
        following: Number.isFinite(Number(summary.following)) ? Math.max(0, Math.trunc(Number(summary.following))) : 0,
        muted: Number.isFinite(Number(summary.muted)) ? Math.max(0, Math.trunc(Number(summary.muted))) : 0,
        blocked: Number.isFinite(Number(summary.blocked)) ? Math.max(0, Math.trunc(Number(summary.blocked))) : 0,
        totalStoryFrames: Number.isFinite(Number(summary.totalStoryFrames)) ? Math.max(0, Math.trunc(Number(summary.totalStoryFrames))) : 0,
        liveStoryFrames: Number.isFinite(Number(summary.liveStoryFrames)) ? Math.max(0, Math.trunc(Number(summary.liveStoryFrames))) : 0,
        storyFramesInRange: Number.isFinite(Number(summary.storyFramesInRange)) ? Math.max(0, Math.trunc(Number(summary.storyFramesInRange))) : 0,
        storyUploadsInRange: Number.isFinite(Number(summary.storyUploadsInRange)) ? Math.max(0, Math.trunc(Number(summary.storyUploadsInRange))) : 0,
        totalStoryViews: Number.isFinite(Number(summary.totalStoryViews)) ? Math.max(0, Math.trunc(Number(summary.totalStoryViews))) : 0,
        uniqueStoryViewers: Number.isFinite(Number(summary.uniqueStoryViewers)) ? Math.max(0, Math.trunc(Number(summary.uniqueStoryViewers))) : 0,
        storyViewsInRange: Number.isFinite(Number(summary.storyViewsInRange)) ? Math.max(0, Math.trunc(Number(summary.storyViewsInRange))) : 0,
        uniqueStoryViewersInRange: Number.isFinite(Number(summary.uniqueStoryViewersInRange))
          ? Math.max(0, Math.trunc(Number(summary.uniqueStoryViewersInRange)))
          : 0,
      })

      setSocialAnalyticsRange({
        startDate: typeof body?.range?.startDate === "string" ? body.range.startDate : startDate,
        endDate: typeof body?.range?.endDate === "string" ? body.range.endDate : endDate,
        days: Number.isFinite(rangeDays) ? Math.max(1, Math.trunc(rangeDays)) : diffDaysInclusive(startDate, endDate),
      })

      setSocialAnalyticsDailyViews(
        dailyViews
          .filter((row) => typeof row?.day === "string")
          .map((row) => ({
            day: row.day,
            views: Number.isFinite(Number(row.views)) ? Math.max(0, Math.trunc(Number(row.views))) : 0,
            viewers: Number.isFinite(Number(row.viewers)) ? Math.max(0, Math.trunc(Number(row.viewers))) : 0,
          })),
      )
      setSocialAnalyticsRecentStories(
        recentStories
          .filter((row) => typeof row?.id === "string")
          .map((row) => ({
            id: row.id,
            label: typeof row.label === "string" && row.label.trim() ? row.label : "Story",
            mediaType: typeof row.mediaType === "string" && row.mediaType.trim() ? row.mediaType : "image",
            createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date(0).toISOString(),
            views: Number.isFinite(Number(row.views)) ? Math.max(0, Math.trunc(Number(row.views))) : 0,
            uniqueViewers: Number.isFinite(Number(row.uniqueViewers)) ? Math.max(0, Math.trunc(Number(row.uniqueViewers))) : 0,
          })),
      )

      return true
    } finally {
      setLoadingSocialAnalytics(false)
    }
  }

  const applyDateRange = async () => {
    setRangeValidationError(null)

    if (!parseInputDate(rangeStartDate) || !parseInputDate(rangeEndDate)) {
      setRangeValidationError("Use valid start and end dates.")
      return
    }

    if (rangeStartDate > rangeEndDate) {
      setRangeValidationError("Start date must be before end date.")
      return
    }

    const days = diffDaysInclusive(rangeStartDate, rangeEndDate)
    if (!Number.isFinite(days) || days < 1 || days > 366) {
      setRangeValidationError("Date range must be between 1 and 366 days.")
      return
    }

    await loadSocialAnalytics(rangeStartDate, rangeEndDate)
  }

  const onPresetClick = (preset: DateRangePreset) => {
    setRangePreset(preset)
    setRangeValidationError(null)

    if (preset === "custom") return

    const nextRange = getPresetRange(preset)
    setRangeStartDate(nextRange.startDate)
    setRangeEndDate(nextRange.endDate)
    void loadSocialAnalytics(nextRange.startDate, nextRange.endDate)
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const meResponse = await fetch("/api/auth/me").catch(() => null)
      if (!meResponse || !meResponse.ok) {
        router.replace(`/login?callbackUrl=${encodeURIComponent(ANALYTICS_PATH)}`)
        return
      }

      const meData = await meResponse.json().catch(() => null)
      const role = meData?.user?.role
      if (role !== "VIEWER" && role !== "ADMIN") {
        router.replace("/social-network?error=viewer-profile-required")
        return
      }

      const emailVerified = !!meData?.user?.emailVerified
      const profileCompleted = meData?.user?.viewerProfileCompleted === true
      const rawEmail = typeof meData?.user?.email === "string" ? meData.user.email : ""
      setEmail(rawEmail)

      if (!emailVerified) {
        router.replace(`/signup/viewer/verify?callbackUrl=${encodeURIComponent(ANALYTICS_PATH)}`)
        return
      }
      if (!profileCompleted) {
        router.replace(`/viewer/onboarding?callbackUrl=${encodeURIComponent(ANALYTICS_PATH)}`)
        return
      }

      const profileRes = await fetch("/api/viewer/profile", { cache: "no-store" }).catch(() => null)
      if (profileRes && profileRes.ok) {
        const profileData = await profileRes.json().catch(() => null)
        const claimed = typeof profileData?.profile?.username === "string" ? profileData.profile.username : ""
        setUsername(claimed)
      }

      await loadSocialAnalytics(initialDateRange.startDate, initialDateRange.endDate)
      setLoading(false)
    }

    void load()
  }, [initialDateRange.endDate, initialDateRange.startDate, router])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <Link href={SOCIAL_APP_PATH} className="text-xl font-semibold tracking-tight">
            UBEYE
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <Link href={SOCIAL_APP_PATH} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to social network
          </Link>

          <h1 className="text-3xl font-bold tracking-tight mb-2">Social Analytics</h1>
          <p className="text-muted-foreground mb-6">Analytics for @{displayHandle}. Private to your account.</p>

          <div className="mb-6 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={PROFILE_PATH}>Profile</Link>
            </Button>
            <Button size="sm" type="button" className="cursor-default" disabled>
              Analytics
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={FOLLOWING_PATH}>Following</Link>
            </Button>
          </div>

          <Card className="p-6 mb-6 border border-dashed">
            <h2 className="text-lg font-semibold mb-1">Story performance</h2>
            <p className="text-sm text-muted-foreground">Private to your account. Not shown publicly.</p>

            <div className="mt-4 rounded-lg border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Date range</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" type="button" variant={rangePreset === "7d" ? "default" : "outline"} onClick={() => onPresetClick("7d")}>
                  7D
                </Button>
                <Button size="sm" type="button" variant={rangePreset === "14d" ? "default" : "outline"} onClick={() => onPresetClick("14d")}>
                  14D
                </Button>
                <Button size="sm" type="button" variant={rangePreset === "30d" ? "default" : "outline"} onClick={() => onPresetClick("30d")}>
                  30D
                </Button>
                <Button size="sm" type="button" variant={rangePreset === "90d" ? "default" : "outline"} onClick={() => onPresetClick("90d")}>
                  90D
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant={rangePreset === "custom" ? "default" : "outline"}
                  onClick={() => onPresetClick("custom")}
                >
                  Custom
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  type="date"
                  value={rangeStartDate}
                  onChange={(event) => {
                    setRangePreset("custom")
                    setRangeStartDate(event.target.value)
                    setRangeValidationError(null)
                  }}
                  max={rangeEndDate || undefined}
                  aria-label="Analytics start date"
                />
                <Input
                  type="date"
                  value={rangeEndDate}
                  onChange={(event) => {
                    setRangePreset("custom")
                    setRangeEndDate(event.target.value)
                    setRangeValidationError(null)
                  }}
                  min={rangeStartDate || undefined}
                  aria-label="Analytics end date"
                />
                <Button type="button" onClick={() => void applyDateRange()} disabled={loadingSocialAnalytics}>
                  Apply
                </Button>
              </div>

              <p className="mt-2 text-xs text-muted-foreground">
                Showing {formatRangeLabel(socialAnalyticsRange.startDate, socialAnalyticsRange.endDate)} ({socialAnalyticsRange.days} days)
              </p>
              {rangeValidationError ? <p className="mt-2 text-xs text-red-500">{rangeValidationError}</p> : null}
            </div>

            {loadingSocialAnalytics ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading social analytics...</p>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Followers</p>
                    <p className="mt-1 text-2xl font-semibold">{socialAnalyticsSummary.followers.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Following</p>
                    <p className="mt-1 text-2xl font-semibold">{socialAnalyticsSummary.following.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Live stories</p>
                    <p className="mt-1 text-2xl font-semibold">{socialAnalyticsSummary.liveStoryFrames.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Total story views</p>
                    <p className="mt-1 text-2xl font-semibold">{socialAnalyticsSummary.totalStoryViews.toLocaleString()}</p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Uploads ({socialAnalyticsRange.days}d)</p>
                    <p className="mt-1 text-base font-semibold">{socialAnalyticsSummary.storyUploadsInRange.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Frames ({socialAnalyticsRange.days}d)</p>
                    <p className="mt-1 text-base font-semibold">{socialAnalyticsSummary.storyFramesInRange.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Views ({socialAnalyticsRange.days}d)</p>
                    <p className="mt-1 text-base font-semibold">{socialAnalyticsSummary.storyViewsInRange.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Unique viewers ({socialAnalyticsRange.days}d)</p>
                    <p className="mt-1 text-base font-semibold">{socialAnalyticsSummary.uniqueStoryViewersInRange.toLocaleString()}</p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-border p-3 sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Muted / blocked</p>
                    <p className="mt-1 text-base font-semibold">
                      {socialAnalyticsSummary.muted.toLocaleString()} / {socialAnalyticsSummary.blocked.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="mt-5">
                  <h3 className="text-sm font-medium">Story views in selected range</h3>
                  {socialAnalyticsDailyViews.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No story view data for this range.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {socialAnalyticsDailyViews.map((row) => {
                        const date = new Date(row.day)
                        const dateLabel = Number.isNaN(date.getTime())
                          ? row.day
                          : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
                        const widthPercent = maxDailyStoryViews > 0 ? Math.max(4, Math.round((row.views / maxDailyStoryViews) * 100)) : 0

                        return (
                          <div key={row.day} className="space-y-1">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{dateLabel}</span>
                              <span>
                                {row.views.toLocaleString()} views · {row.viewers.toLocaleString()} viewers
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded bg-muted">
                              <div className="h-full rounded bg-foreground/80" style={{ width: `${widthPercent}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <h3 className="text-sm font-medium">Story performance in selected range</h3>
                  {socialAnalyticsRecentStories.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No stories posted in this range.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {socialAnalyticsRecentStories.slice(0, 6).map((story) => {
                        const createdAt = new Date(story.createdAt)
                        const createdLabel = Number.isNaN(createdAt.getTime())
                          ? "Unknown date"
                          : createdAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

                        return (
                          <div key={story.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{story.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {story.mediaType} · {createdLabel}
                              </p>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              <p>{story.views.toLocaleString()} views</p>
                              <p>{story.uniqueViewers.toLocaleString()} unique</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {socialAnalyticsError ? <p className="mt-3 text-sm text-red-500">{socialAnalyticsError}</p> : null}
          </Card>

          {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}
        </div>
      </main>
    </div>
  )
}
