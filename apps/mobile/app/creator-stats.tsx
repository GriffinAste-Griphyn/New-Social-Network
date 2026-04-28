import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
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
  stories: CreatorStoryStats[]
}

type CreatorStatsResponse = {
  ok: true
  stats: CreatorStats
}

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

export default function CreatorStatsScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const [stats, setStats] = useState<CreatorStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    if (!account?.mobileToken) {
      setStats(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    getMobileApi<CreatorStatsResponse>(
      "/api/mobile/creator/stats",
      { authToken: account.mobileToken },
    )
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
  }, [account?.mobileToken])

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
        <Text style={styles.storyViews}>{formatNumber(story.views)}</Text>
        <Text style={styles.storyMeta}>{story.completionRate}%</Text>
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
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.faint,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  title: {
    fontSize: 30,
    fontFamily: "Inter_800ExtraBold",
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 0,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    color: colors.subtext,
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
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    textAlign: "center",
    color: colors.subtext,
  },
  statGrid: {
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
    fontFamily: "Inter_600SemiBold",
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
    fontFamily: "Inter_800ExtraBold",
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 0,
  },
  metricDetail: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
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
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  panelSubtext: {
    marginTop: 3,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.subtext,
  },
  storyMeta: {
    marginTop: 3,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    color: colors.subtext,
  },
  storyNumbers: {
    minWidth: 56,
    alignItems: "flex-end",
  },
  storyViews: {
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
    fontWeight: "800",
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
