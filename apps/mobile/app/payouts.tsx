import Ionicons from "@expo/vector-icons/Ionicons"
import * as WebBrowser from "expo-web-browser"
import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"
import { getMobileApi, postMobileApi } from "@/lib/mobile-api"
import {
  ScreenFrame,
  ScreenScroll,
} from "@/components/social/ui"

type CreatorStripeStatus = {
  stripeConnectedAccountId: string | null
  stripePayoutsEnabled: boolean
  stripeOnboardingComplete: boolean
  stripeRequirementsStatus: string | null
  stripeRequirementsDue: string | null
  stripeConnectedAt: string | null
  stripeUpdatedAt: string | null
}

type CreatorEarningsStats = {
  pendingCents: number
  paidCents: number
  reversedCents: number
  availableCents: number
}

type PayoutStatusResponse = {
  ok: true
  status: CreatorStripeStatus
  earnings: CreatorEarningsStats
}

const colors = {
  surface: "#ffffff",
  mutedSurface: "#f5f6f8",
  text: "#17191f",
  subtext: "#6b7280",
  faint: "#9ca3af",
  border: "#e5e7eb",
  accent: "#e01616",
  stripe: "#635bff",
  dark: "#111827",
  success: "#16a34a",
  warning: "#f59e0b",
}

function formatMoney(cents: number) {
  return Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not synced yet"
  }

  return Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export default function PayoutsScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const [status, setStatus] = useState<CreatorStripeStatus | null>(null)
  const [earnings, setEarnings] = useState<CreatorEarningsStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isOpeningStripe, setIsOpeningStripe] = useState(false)

  const loadStatus = async (sync = false) => {
    if (!account?.mobileToken) {
      setStatus(null)
      setEarnings(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    try {
      const payload = await getMobileApi<PayoutStatusResponse>(
        `/api/mobile/stripe/connect/status${sync ? "?sync=1" : ""}`,
        { authToken: account.mobileToken },
      )

      setStatus(payload.status)
      setEarnings(payload.earnings)
      setError(null)
    } catch (errorValue) {
      setError(
        errorValue instanceof Error
          ? errorValue.message
          : "Could not load payout status.",
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus(false)
  }, [account?.mobileToken])

  const isReady =
    Boolean(status?.stripeConnectedAccountId) &&
    Boolean(status?.stripePayoutsEnabled) &&
    Boolean(status?.stripeOnboardingComplete)
  const statusLabel = isReady
    ? "Ready"
    : status?.stripeConnectedAccountId
      ? "Action needed"
      : "Not connected"

  const openStripe = async () => {
    setError(null)
    setIsOpeningStripe(true)

    try {
      const payload = await postMobileApi<{ ok: true; url: string }>(
        "/api/mobile/stripe/connect/onboarding",
        {},
        { authToken: account?.mobileToken },
      )

      await WebBrowser.openBrowserAsync(payload.url)
      await loadStatus(true)
    } catch (errorValue) {
      setError(
        errorValue instanceof Error
          ? errorValue.message
          : "Could not open Stripe onboarding.",
      )
    } finally {
      setIsOpeningStripe(false)
    }
  }

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
            <Text style={styles.title}>Payouts</Text>
            <Text style={styles.subtitle}>Stripe setup and settlement</Text>
          </View>
        </View>

        <View style={styles.statusPanel}>
          <View>
            <Text style={styles.statusLabel}>Payout account</Text>
            <Text style={styles.statusTitle}>{statusLabel}</Text>
            <Text style={styles.statusText}>
              Last sync: {formatDate(status?.stripeUpdatedAt ?? null)}
            </Text>
          </View>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isReady ? colors.success : colors.warning },
            ]}
          />
        </View>

        <View style={styles.metricGrid}>
          <Metric label="Available" value={formatMoney(earnings?.availableCents ?? 0)} />
          <Metric label="Pending" value={formatMoney(earnings?.pendingCents ?? 0)} />
          <Metric label="Paid" value={formatMoney(earnings?.paidCents ?? 0)} />
          <Metric label="Reversed" value={formatMoney(earnings?.reversedCents ?? 0)} />
        </View>

        {status?.stripeRequirementsDue ? (
          <View style={styles.warningPanel}>
            <Ionicons name="alert-circle-outline" size={20} color="#92400e" />
            <Text style={styles.warningText}>
              Stripe still needs account details before payouts are enabled.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.actionPanel}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Stripe onboarding"
            disabled={isOpeningStripe}
            onPress={openStripe}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons name="card-outline" size={18} color={colors.surface} />
            <Text style={styles.primaryButtonText}>
              {isOpeningStripe
                ? "Opening Stripe"
                : status?.stripeConnectedAccountId
                  ? "Continue Stripe setup"
                  : "Connect Stripe"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sync payout status"
            disabled={isLoading}
            onPress={() => {
              void loadStatus(true)
            }}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons name="sync-outline" size={18} color={colors.text} />
            <Text style={styles.secondaryButtonText}>
              {isLoading ? "Syncing" : "Sync and settle"}
            </Text>
          </Pressable>
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
  statusPanel: {
    minHeight: 112,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.subtext,
  },
  statusTitle: {
    marginTop: 4,
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
  },
  statusText: {
    marginTop: 4,
    fontSize: 13,
    color: colors.subtext,
  },
  statusDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
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
  warningPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    flexDirection: "row",
    gap: 10,
    padding: 13,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: "#92400e",
  },
  errorPanel: {
    borderRadius: 8,
    backgroundColor: "#fee2e2",
    padding: 13,
  },
  errorText: {
    fontSize: 13,
    color: "#991b1b",
  },
  actionPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 10,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.stripe,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.surface,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  pressed: {
    opacity: 0.72,
  },
})
