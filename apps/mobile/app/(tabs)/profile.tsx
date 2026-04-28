import Ionicons from "@expo/vector-icons/Ionicons"
import * as WebBrowser from "expo-web-browser"
import type { Href } from "expo-router"
import { useRouter } from "expo-router"
import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"
import { useFollowState } from "@/lib/follow-state"
import { postMobileApi } from "@/lib/mobile-api"
import { useMobileFeed } from "@/lib/mobile-stories-api"
import {
  ScreenFrame,
  ScreenHeader,
  ScreenScroll,
  SuggestedAccountsList,
} from "@/components/social/ui"

export default function ProfileScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const { revision } = useFollowState()
  const [stripeError, setStripeError] = useState<string | null>(null)
  const [isOpeningStripe, setIsOpeningStripe] = useState(false)
  const liveFeed = useMobileFeed(account?.mobileToken, revision)
  const suggestions =
    liveFeed.data?.suggestedAccounts.map((person) => ({
      id: person.id,
      name: person.name,
      handle: person.handle.replace(/^@/, ""),
      imageUrl: person.imageUrl ?? "",
    })) ?? []

  return (
    <ScreenFrame>
      <ScreenScroll>
        <ScreenHeader
          eyebrow="Account"
          title={account?.displayName ?? "Account"}
          subtitle={`@${account?.handle ?? "account"}`}
        />
        <AccountToolsPanel
          isOpeningStripe={isOpeningStripe}
          onOpenReplies={() => router.push("/replies")}
          onOpenStats={() => router.push("/creator-stats" as Href)}
          onOpenStripe={async () => {
            setStripeError(null)
            setIsOpeningStripe(true)

            try {
              const payload = await postMobileApi<{ ok: true; url: string }>(
                "/api/mobile/stripe/connect/onboarding",
                {},
              )

              await WebBrowser.openBrowserAsync(payload.url)
            } catch (error) {
              setStripeError(
                error instanceof Error
                  ? error.message
                  : "Could not open Stripe onboarding.",
              )
            } finally {
              setIsOpeningStripe(false)
            }
          }}
          stripeError={stripeError}
        />
        {suggestions.length > 0 ? (
          <SuggestedAccountsList people={suggestions} />
        ) : null}
      </ScreenScroll>
    </ScreenFrame>
  )
}

function AccountToolsPanel({
  isOpeningStripe,
  onOpenReplies,
  onOpenStats,
  onOpenStripe,
  stripeError,
}: {
  isOpeningStripe: boolean
  onOpenReplies: () => void
  onOpenStats: () => void
  onOpenStripe: () => void
  stripeError: string | null
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.panelTitle}>Account tools</Text>
          <Text style={styles.panelSubtext}>
            Post, reply, receive replies, and earn from one account.
          </Text>
        </View>
        <View style={styles.creatorBadge}>
          <Ionicons name="checkmark" size={13} color="#ffffff" />
        </View>
      </View>

      <Pressable
        accessibilityLabel="Open story replies"
        accessibilityRole="button"
        onPress={onOpenReplies}
        style={({ pressed }) => [
          styles.creatorAction,
          pressed ? styles.creatorActionPressed : null,
        ]}
      >
        <View style={styles.creatorActionIcon}>
          <Ionicons name="file-tray-full-outline" size={18} color="#17191f" />
        </View>
        <View style={styles.creatorActionCopy}>
          <Text style={styles.creatorActionTitle}>Story replies</Text>
          <Text style={styles.creatorActionText}>
            See replies to your stories and replies you have made.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </Pressable>

      <Pressable
        accessibilityLabel="Open creator stats"
        accessibilityRole="button"
        onPress={onOpenStats}
        style={({ pressed }) => [
          styles.creatorAction,
          pressed ? styles.creatorActionPressed : null,
        ]}
      >
        <View style={styles.creatorActionIcon}>
          <Ionicons name="analytics-outline" size={18} color="#17191f" />
        </View>
        <View style={styles.creatorActionCopy}>
          <Text style={styles.creatorActionTitle}>Creator stats</Text>
          <Text style={styles.creatorActionText}>
            Review followers, views, comments, and story performance.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </Pressable>

      <Pressable
        accessibilityLabel="Open Stripe creator payouts"
        accessibilityRole="button"
        onPress={onOpenStripe}
        style={({ pressed }) => [
          styles.creatorAction,
          pressed ? styles.creatorActionPressed : null,
        ]}
      >
        <View style={styles.creatorActionIcon}>
          <Ionicons name="card-outline" size={18} color="#17191f" />
        </View>
        <View style={styles.creatorActionCopy}>
          <Text style={styles.creatorActionTitle}>Creator payouts</Text>
          <Text style={styles.creatorActionText}>
            Connect Stripe to receive approved story earnings.
          </Text>
        </View>
        <View style={styles.stripeStatusPill}>
          <Text style={styles.stripeStatusText}>
            {isOpeningStripe ? "Opening" : "Stripe"}
          </Text>
        </View>
      </Pressable>

      {stripeError ? <Text style={styles.stripeError}>{stripeError}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    padding: 14,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  panelTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: "#17191f",
  },
  panelSubtext: {
    marginTop: 3,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    color: "#6b7280",
  },
  creatorBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e01616",
  },
  creatorAction: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 8,
    backgroundColor: "#f5f6f8",
    marginTop: 14,
    paddingHorizontal: 12,
  },
  creatorActionPressed: {
    opacity: 0.72,
  },
  creatorActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  creatorActionCopy: {
    flex: 1,
    minWidth: 0,
  },
  creatorActionTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: "#17191f",
  },
  creatorActionText: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6b7280",
  },
  stripeStatusPill: {
    minWidth: 52,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#635bff",
    paddingHorizontal: 10,
  },
  stripeStatusText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: "#ffffff",
  },
  stripeError: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#b91c1c",
  },
})
