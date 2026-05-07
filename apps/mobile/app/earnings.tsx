import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { Image, Pressable, StyleSheet, Text, View } from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"
import { getMobileApi } from "@/lib/mobile-api"
import {
  ScreenFrame,
  ScreenScroll,
} from "@/components/social/ui"

type CreatorStoryStats = {
  id: string
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  caption: string | null
  createdAt: string
  views: number
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

type EarningsResponse = {
  ok: true
  stats: {
    earnings: CreatorEarningsStats
    stories: CreatorStoryStats[]
  }
}

const colors = {
  surface: "#ffffff",
  mutedSurface: "#f5f6f8",
  text: "#17191f",
  subtext: "#6b7280",
  faint: "#9ca3af",
  border: "#e5e7eb",
  accent: "#e01616",
  dark: "#111827",
}

function formatMoney(cents: number) {
  return Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function formatNumber(value: number) {
  return Intl.NumberFormat("en", { notation: "compact" }).format(value)
}

function formatDate(value: string) {
  return Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value))
}

export default function EarningsScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const [earnings, setEarnings] = useState<CreatorEarningsStats | null>(null)
  const [stories, setStories] = useState<CreatorStoryStats[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    if (!account?.mobileToken) {
      setEarnings(null)
      setStories([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    getMobileApi<EarningsResponse>("/api/mobile/creator/stats", {
      authToken: account.mobileToken,
    })
      .then((payload) => {
        if (!isMounted) return
        setEarnings(payload.stats.earnings)
        setStories(payload.stats.stories)
      })
      .catch(() => {
        if (!isMounted) return
        setEarnings(null)
        setStories([])
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
            <Text style={styles.title}>Earnings</Text>
            <Text style={styles.subtitle}>Story ledger and balances</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <Metric label="Available" value={formatMoney(earnings?.availableCents ?? 0)} />
          <Metric label="Pending" value={formatMoney(earnings?.pendingCents ?? 0)} />
          <Metric label="Paid" value={formatMoney(earnings?.paidCents ?? 0)} />
          <Metric label="Reversed" value={formatMoney(earnings?.reversedCents ?? 0)} />
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Story ledger</Text>
            <Text style={styles.panelMeta}>
              {formatMoney(earnings?.totalCents ?? 0)} lifetime
            </Text>
          </View>

          {isLoading ? (
            <EmptyState title="Loading earnings" text="Checking your story ledger." />
          ) : stories.length > 0 ? (
            stories.map((story) => <StoryEarningRow key={story.id} story={story} />)
          ) : (
            <EmptyState
              title="No earnings yet"
              text="Qualified story matches will appear here once brands fund them."
            />
          )}
        </View>
      </ScreenScroll>
    </ScreenFrame>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  )
}

function StoryEarningRow({ story }: { story: CreatorStoryStats }) {
  const imageUrl = story.thumbnailUrl ?? story.mediaUrl

  return (
    <View style={styles.storyRow}>
      {story.assetKind === "video" && story.thumbnailUrl === null ? (
        <View style={styles.videoThumb}>
          <Ionicons name="play" size={18} color={colors.surface} />
        </View>
      ) : (
        <Image source={{ uri: imageUrl }} style={styles.storyThumb} />
      )}
      <View style={styles.storyCopy}>
        <Text style={styles.storyTitle} numberOfLines={1}>
          {story.caption || "Untitled story"}
        </Text>
        <Text style={styles.storyMeta}>
          {formatDate(story.createdAt)} · {formatNumber(story.views)} views
        </Text>
      </View>
      <View style={styles.storyMoney}>
        <Text style={styles.storyTotal}>{formatMoney(story.earningsCents)}</Text>
        <Text style={styles.storyMeta}>
          {story.paidEarningsCents > 0
            ? `${formatMoney(story.paidEarningsCents)} paid`
            : `${formatMoney(story.pendingEarningsCents)} pending`}
        </Text>
      </View>
    </View>
  )
}

function EmptyState({ text, title }: { text: string; title: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
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
    fontWeight: "800",
    color: colors.faint,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    color: colors.subtext,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metric: {
    width: "48.5%",
    minHeight: 82,
    borderRadius: 8,
    justifyContent: "center",
    backgroundColor: colors.surface,
    padding: 13,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
  },
  metricLabel: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "700",
    color: colors.subtext,
  },
  panel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 2,
  },
  panelTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  panelMeta: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.subtext,
  },
  storyRow: {
    minHeight: 72,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
    backgroundColor: colors.dark,
  },
  storyCopy: {
    flex: 1,
    minWidth: 0,
  },
  storyTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  storyMeta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.subtext,
  },
  storyMoney: {
    maxWidth: 104,
    alignItems: "flex-end",
  },
  storyTotal: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  emptyState: {
    minHeight: 156,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  emptyText: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    color: colors.subtext,
  },
  pressed: {
    opacity: 0.72,
  },
})
