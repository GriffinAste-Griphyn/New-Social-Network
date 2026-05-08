import Ionicons from "@expo/vector-icons/Ionicons"
import type { Href } from "expo-router"
import { useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"
import { getMobileApi } from "@/lib/mobile-api"
import {
  AccountAvatarButton,
  ScreenFrame,
  ScreenHeader,
  ScreenScroll,
} from "@/components/social/ui"

type ProfileStats = {
  followerCount: number
  followingCount: number
  totalViews: number
  replies: number
  earnings: {
    availableCents: number
    paidCents: number
  }
}

type ProfileStatsResponse = {
  ok: true
  stats: ProfileStats
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

function initials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export default function ProfileScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const [stats, setStats] = useState<ProfileStats | null>(null)

  useEffect(() => {
    let isMounted = true

    if (!account?.mobileToken) {
      setStats(null)
      return
    }

    getMobileApi<ProfileStatsResponse>("/api/mobile/creator/stats", {
      authToken: account.mobileToken,
    })
      .then((payload) => {
        if (isMounted) {
          setStats(payload.stats)
        }
      })
      .catch(() => undefined)

    return () => {
      isMounted = false
    }
  }, [account?.mobileToken])

  const displayName = account?.displayName ?? "Account"
  const handle = account?.handle ?? "account"
  const followerCount = stats?.followerCount ?? 0
  const followingCount = stats?.followingCount ?? 0
  const availableCents = stats?.earnings.availableCents ?? 0
  const paidCents = stats?.earnings.paidCents ?? 0

  return (
    <ScreenFrame>
      <ScreenScroll>
        <ScreenHeader
          eyebrow="Profile"
          title={displayName}
          subtitle={`@${handle}`}
          right={
            <AccountAvatarButton
              displayName={displayName}
              email={account?.email}
              handle={handle}
            />
          }
        />

        <View style={styles.identityPanel}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(displayName)}</Text>
          </View>
          <View style={styles.identityCopy}>
            <Text style={styles.identityName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.identityHandle} numberOfLines={1}>
              @{handle}
            </Text>
          </View>
          <View style={styles.creatorPill}>
            <Text style={styles.creatorPillText}>Creator</Text>
          </View>
        </View>

        <View style={styles.summaryGrid}>
          <SummaryMetric
            label="Followers"
            value={formatNumber(followerCount)}
            onPress={() => router.push("/followers" as Href)}
          />
          <SummaryMetric
            label="Following"
            value={formatNumber(followingCount)}
            onPress={() => router.push("/followers?view=following" as Href)}
          />
          <SummaryMetric
            label="Available"
            value={formatMoney(availableCents)}
            onPress={() => router.push("/earnings" as Href)}
          />
          <SummaryMetric
            label="Paid"
            value={formatMoney(paidCents)}
            onPress={() => router.push("/earnings" as Href)}
          />
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Account</Text>
          <ActionRow
            icon="file-tray-full-outline"
            label="Story replies"
            detail={`${formatNumber(stats?.replies ?? 0)} received`}
            onPress={() => router.push("/replies")}
          />
          <ActionRow
            icon="people-outline"
            label="Followers"
            detail="Followers and following"
            onPress={() => router.push("/followers" as Href)}
          />
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Creator business</Text>
          <ActionRow
            icon="images-outline"
            label="My Story Stats"
            detail="Story-by-story views and replies"
            onPress={() => router.push("/my-story-stats" as Href)}
          />
          <ActionRow
            icon="analytics-outline"
            label="Stats"
            detail={`${formatNumber(stats?.totalViews ?? 0)} story views`}
            onPress={() => router.push("/creator-stats" as Href)}
          />
          <ActionRow
            icon="wallet-outline"
            label="Earnings"
            detail="Story ledger and balances"
            onPress={() => router.push("/earnings" as Href)}
          />
          <ActionRow
            icon="card-outline"
            label="Payouts"
            detail="Stripe setup and settlement"
            onPress={() => router.push("/payouts" as Href)}
          />
        </View>
      </ScreenScroll>
    </ScreenFrame>
  )
}

function SummaryMetric({
  label,
  onPress,
  value,
}: {
  label: string
  onPress: () => void
  value: string
}) {
  return (
    <Pressable
      accessibilityLabel={`Open ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.summaryMetric,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </Pressable>
  )
}

function ActionRow({
  detail,
  icon,
  label,
  onPress,
}: {
  detail: string
  icon: ComponentProps<typeof Ionicons>["name"]
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={`Open ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionRow,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={19} color={colors.text} />
      </View>
      <View style={styles.actionCopy}>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={styles.actionDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  identityPanel: {
    minHeight: 96,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.surface,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  identityName: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
  },
  identityHandle: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "600",
    color: colors.subtext,
  },
  creatorPill: {
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    backgroundColor: colors.dark,
    paddingHorizontal: 11,
  },
  creatorPillText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.surface,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  summaryMetric: {
    width: "48.5%",
    minHeight: 78,
    borderRadius: 8,
    justifyContent: "center",
    backgroundColor: colors.surface,
    padding: 13,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
  },
  summaryLabel: {
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
  panelTitle: {
    marginBottom: 2,
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  actionRow: {
    minHeight: 64,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
  },
  actionCopy: {
    flex: 1,
    minWidth: 0,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  actionDetail: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "500",
    color: colors.subtext,
  },
  pressed: {
    opacity: 0.72,
  },
})
