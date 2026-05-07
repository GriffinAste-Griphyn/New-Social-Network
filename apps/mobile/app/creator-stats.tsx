import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"
import { getMobileApi } from "@/lib/mobile-api"
import { ScreenFrame, ScreenScroll } from "@/components/social/ui"

type CreatorStoryStats = {
  id: string
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  caption: string | null
  status: "processing" | "live" | "expired" | "removed"
  createdAt: string
  views: number
  uniqueViewers: number
  completedViews: number
  completionRate: number
  averageViewedSeconds: number
  comments: number
  replies: number
  earningsCents: number
  pendingEarningsCents: number
  paidEarningsCents: number
}

type CreatorEarningsStats = {
  totalCents: number
  pendingCents: number
  approvedCents: number
  paidCents: number
  reversedCents: number
  availableCents: number
  nextAvailableAt: string | null
}

type CreatorStats = {
  followerCount: number
  followingCount: number
  totalStories: number
  liveStories: number
  totalViews: number
  uniqueViewers: number
  completedViews: number
  completionRate: number
  averageViewedSeconds: number
  comments: number
  replies: number
  earnings: CreatorEarningsStats
  stories: CreatorStoryStats[]
}

type CreatorStatsResponse = {
  ok: true
  stats: CreatorStats
}

type StatsRangePreset = "day" | "week" | "month" | "all" | "custom"

const rangeOptions: Array<{ label: string; value: StatsRangePreset }> = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "All", value: "all" },
  { label: "Custom", value: "custom" },
]

const colors = {
  background: "#f3f4f6",
  surface: "#ffffff",
  mutedSurface: "#f5f6f8",
  text: "#17191f",
  subtext: "#6b7280",
  faint: "#9ca3af",
  border: "#e5e7eb",
  accent: "#e01616",
}

function formatNumber(value: number) {
  return Intl.NumberFormat("en", { notation: "compact" }).format(value)
}

function formatDate(value: string) {
  return Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatMoney(cents: number) {
  return Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function formatAvailability(value: string | null) {
  if (!value) {
    return "No scheduled payout"
  }

  return `Available ${Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value))}`
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10)
}

function parseDateInput(value: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null
  }

  const date = new Date(`${value.trim()}T00:00:00`)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  if (endOfDay) {
    date.setHours(23, 59, 59, 999)
  }

  return date
}

function buildCreatorStatsPath(
  preset: StatsRangePreset,
  customStart: string,
  customEnd: string,
) {
  const now = new Date()
  let from: Date | null = null
  let to: Date | null = now

  if (preset === "day") {
    from = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  } else if (preset === "week") {
    from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  } else if (preset === "month") {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  } else if (preset === "custom") {
    from = parseDateInput(customStart)
    to = parseDateInput(customEnd, true)
  } else {
    to = null
  }

  const params = new URLSearchParams()

  if (from) {
    params.set("from", from.toISOString())
  }

  if (to) {
    params.set("to", to.toISOString())
  }

  const query = params.toString()

  return `/api/mobile/creator/stats${query ? `?${query}` : ""}`
}

export default function CreatorStatsScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const [stats, setStats] = useState<CreatorStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [rangePreset, setRangePreset] = useState<StatsRangePreset>("week")
  const [customStart, setCustomStart] = useState(() => {
    const start = new Date()
    start.setDate(start.getDate() - 7)
    return formatDateInput(start)
  })
  const [customEnd, setCustomEnd] = useState(() => formatDateInput(new Date()))
  const statsPath = useMemo(
    () => buildCreatorStatsPath(rangePreset, customStart, customEnd),
    [customEnd, customStart, rangePreset],
  )

  useEffect(() => {
    let isMounted = true

    if (!account?.mobileToken) {
      setStats(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    getMobileApi<CreatorStatsResponse>(statsPath, {
      authToken: account.mobileToken,
    })
      .then((payload) => {
        if (!isMounted) return
        setStats(payload.stats)
        setError(null)
      })
      .catch((errorValue) => {
        if (!isMounted) return
        setStats(null)
        setError(
          errorValue instanceof Error
            ? errorValue.message
            : "Could not load creator stats.",
        )
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [account?.mobileToken, statsPath])

  return (
    <ScreenFrame>
      <ScreenScroll>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back to profile"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Creator</Text>
            <Text style={styles.title}>Stats</Text>
            <Text style={styles.subtitle}>@{account?.handle ?? "account"}</Text>
          </View>
        </View>

        <TimeRangeControl
          customEnd={customEnd}
          customStart={customStart}
          onChangeCustomEnd={setCustomEnd}
          onChangeCustomStart={setCustomStart}
          onChangePreset={setRangePreset}
          selected={rangePreset}
        />

        {isLoading ? (
          <View style={styles.loadingPanel}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}

        {error ? (
          <View style={styles.emptyPanel}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.faint} />
            <Text style={styles.emptyTitle}>Stats unavailable</Text>
            <Text style={styles.emptyText}>{error}</Text>
          </View>
        ) : null}

        {stats ? (
          <>
            <View style={styles.statGrid}>
              <MetricCard
                icon="people-outline"
                label="Followers"
                value={formatNumber(stats.followerCount)}
                detail={`${formatNumber(stats.followingCount)} following`}
              />
              <MetricCard
                icon="eye-outline"
                label="Views"
                value={formatNumber(stats.totalViews)}
                detail={`${formatNumber(stats.uniqueViewers)} unique`}
              />
              <MetricCard
                icon="analytics-outline"
                label="Completion"
                value={`${stats.completionRate}%`}
                detail={`${formatNumber(stats.completedViews)} complete`}
              />
              <MetricCard
                icon="chatbubble-ellipses-outline"
                label="Comments"
                value={formatNumber(stats.comments)}
                detail={`${formatNumber(stats.replies)} replies`}
              />
            </View>

            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelTitle}>Earnings and payouts</Text>
                  <Text style={styles.panelSubtext}>
                    Story earnings by ledger status.
                  </Text>
                </View>
                <View style={styles.averagePill}>
                  <Text style={styles.averagePillText}>
                    {formatAvailability(stats.earnings.nextAvailableAt)}
                  </Text>
                </View>
              </View>

              <View style={styles.earningsGrid}>
                <MetricCard
                  icon="wallet-outline"
                  label="Total earned"
                  value={formatMoney(stats.earnings.totalCents)}
                  detail="All approved ledger entries"
                />
                <MetricCard
                  icon="hourglass-outline"
                  label="Pending"
                  value={formatMoney(stats.earnings.pendingCents)}
                  detail="Under review or clearing"
                />
                <MetricCard
                  icon="checkmark-done-outline"
                  label="Available"
                  value={formatMoney(stats.earnings.availableCents)}
                  detail="Ready for payout"
                />
                <MetricCard
                  icon="card-outline"
                  label="Paid out"
                  value={formatMoney(stats.earnings.paidCents)}
                  detail="Sent through payouts"
                />
              </View>
            </View>

            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelTitle}>Story activity</Text>
                  <Text style={styles.panelSubtext}>
                    {stats.totalStories} stories · {stats.liveStories} live
                  </Text>
                </View>
                <View style={styles.averagePill}>
                  <Text style={styles.averagePillText}>
                    {stats.averageViewedSeconds}s avg.
                  </Text>
                </View>
              </View>

              <View style={styles.storyList}>
                {stats.stories.length > 0 ? (
                  stats.stories.slice(0, 12).map((story) => (
                    <StoryStatsRow key={story.id} story={story} />
                  ))
                ) : (
                  <View style={styles.emptyStoryState}>
                    <Text style={styles.emptyTitle}>No stories yet</Text>
                    <Text style={styles.emptyText}>
                      Post a story to start building your stats.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </>
        ) : null}
      </ScreenScroll>
    </ScreenFrame>
  )
}

function TimeRangeControl({
  customEnd,
  customStart,
  onChangeCustomEnd,
  onChangeCustomStart,
  onChangePreset,
  selected,
}: {
  customEnd: string
  customStart: string
  onChangeCustomEnd: (value: string) => void
  onChangeCustomStart: (value: string) => void
  onChangePreset: (value: StatsRangePreset) => void
  selected: StatsRangePreset
}) {
  return (
    <View style={styles.rangePanel}>
      <View style={styles.rangeOptions}>
        {rangeOptions.map((option) => {
          const isSelected = selected === option.value

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show ${option.label} stats`}
              key={option.value}
              onPress={() => onChangePreset(option.value)}
              style={({ pressed }) => [
                styles.rangeOption,
                isSelected ? styles.rangeOptionSelected : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text
                style={[
                  styles.rangeOptionText,
                  isSelected ? styles.rangeOptionTextSelected : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {selected === "custom" ? (
        <View style={styles.customRangeRow}>
          <View style={styles.customRangeField}>
            <Text style={styles.customRangeLabel}>From</Text>
            <TextInput
              accessibilityLabel="Custom stats start date"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              onChangeText={onChangeCustomStart}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.faint}
              style={styles.customRangeInput}
              value={customStart}
            />
          </View>
          <View style={styles.customRangeField}>
            <Text style={styles.customRangeLabel}>To</Text>
            <TextInput
              accessibilityLabel="Custom stats end date"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              onChangeText={onChangeCustomEnd}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.faint}
              style={styles.customRangeInput}
              value={customEnd}
            />
          </View>
        </View>
      ) : null}
    </View>
  )
}

function MetricCard({
  detail,
  icon,
  label,
  value,
}: {
  detail: string
  icon: ComponentProps<typeof Ionicons>["name"]
  label: string
  value: string
}) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{label}</Text>
        <View style={styles.metricIcon}>
          <Ionicons name={icon} size={16} color={colors.subtext} />
        </View>
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  )
}

function StoryStatsRow({ story }: { story: CreatorStoryStats }) {
  const imageUrl = story.thumbnailUrl ?? story.mediaUrl

  return (
    <View style={styles.storyRow}>
      {story.assetKind === "video" && story.thumbnailUrl === null ? (
        <View style={styles.videoThumb}>
          <Ionicons name="play" size={18} color="#ffffff" />
        </View>
      ) : (
        <Image source={{ uri: imageUrl }} style={styles.storyThumb} />
      )}
      <View style={styles.storyCopy}>
        <View style={styles.storyTitleLine}>
          <Text numberOfLines={1} style={styles.storyTitle}>
            {story.caption || "Untitled story"}
          </Text>
          <Text style={styles.storyStatus}>{story.status}</Text>
        </View>
        <Text style={styles.storyMeta}>{formatDate(story.createdAt)}</Text>
      </View>
      <View style={styles.storyNumbers}>
        <Text style={styles.storyViews}>{formatMoney(story.earningsCents)}</Text>
        <Text style={styles.storyMeta}>{formatNumber(story.views)} views</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.faint,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: 0,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "500",
    color: colors.subtext,
  },
  rangePanel: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 10,
  },
  rangeOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  rangeOption: {
    minHeight: 34,
    borderRadius: 8,
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
    paddingHorizontal: 11,
  },
  rangeOptionSelected: {
    backgroundColor: colors.text,
  },
  rangeOptionText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.subtext,
  },
  rangeOptionTextSelected: {
    color: colors.surface,
  },
  customRangeRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
  },
  customRangeField: {
    flex: 1,
    minWidth: 0,
  },
  customRangeLabel: {
    marginBottom: 5,
    fontSize: 11,
    fontWeight: "700",
    color: colors.subtext,
  },
  customRangeInput: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  loadingPanel: {
    minHeight: 160,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  emptyPanel: {
    borderRadius: 8,
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.surface,
    padding: 20,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    color: colors.subtext,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  earningsGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricCard: {
    width: "48.5%",
    minHeight: 126,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 14,
  },
  metricHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.subtext,
  },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
  },
  metricValue: {
    marginTop: 18,
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: 0,
  },
  metricDetail: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "500",
    color: colors.subtext,
  },
  panel: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 14,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  panelSubtext: {
    marginTop: 3,
    fontSize: 13,
    color: colors.subtext,
  },
  averagePill: {
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
    paddingHorizontal: 10,
  },
  averagePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },
  storyList: {
    marginTop: 12,
  },
  storyRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
  },
  storyThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
  },
  videoThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
  },
  storyCopy: {
    flex: 1,
    minWidth: 0,
  },
  storyTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  storyTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  storyStatus: {
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 10,
    fontWeight: "700",
    color: colors.subtext,
  },
  storyMeta: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "500",
    color: colors.subtext,
  },
  storyNumbers: {
    minWidth: 56,
    alignItems: "flex-end",
  },
  storyViews: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  emptyStoryState: {
    marginTop: 12,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    padding: 18,
    alignItems: "center",
  },
  pressed: {
    opacity: 0.72,
  },
})
