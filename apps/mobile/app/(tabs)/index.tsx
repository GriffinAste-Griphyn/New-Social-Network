import { useCallback, useRef, useState, type ReactNode } from "react"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useFocusEffect, useRouter } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useAuthFlow } from "@/lib/auth-flow"
import { useFollowState } from "@/lib/follow-state"
import { useMobileFeed } from "@/lib/mobile-stories-api"
import {
  DiscoverMosaic,
  FollowingPreviewRail,
  MobileHomeHeader,
  ScreenFrame,
  SectionTitle,
} from "@/components/social/ui"

export default function HomeScreen() {
  const router = useRouter()
  const { account, expireSession } = useAuthFlow()
  const { revision } = useFollowState()
  const [focusRefreshRevision, setFocusRefreshRevision] = useState(0)
  const hasHandledInitialFocusRef = useRef(false)
  const liveFeed = useMobileFeed(account?.mobileToken, revision + focusRefreshRevision, {
    onUnauthorized: expireSession,
  })
  const followedStories = liveFeed.data?.followingStories ?? []
  const discoverTiles = liveFeed.data?.discoverTiles ?? []
  const myStory = liveFeed.data?.myStory ?? null
  const session = liveFeed.data?.session ?? account
  const hasFeedData = Boolean(liveFeed.data)
  const activeStoryCount = myStory?.liveCount ?? followedStories.length
  const shouldShowFollowing = Boolean(myStory?.hasActiveStory || followedStories.length > 0)

  useFocusEffect(
    useCallback(() => {
      if (!hasHandledInitialFocusRef.current) {
        hasHandledInitialFocusRef.current = true
        return
      }

      setFocusRefreshRevision((current) => current + 1)
    }, []),
  )

  return (
    <ScreenFrame>
      <DiscoverMosaic
        tiles={hasFeedData ? discoverTiles : []}
        ListHeaderComponent={
          <View style={styles.homeListHeader}>
            <MobileHomeHeader
              activeStoryCount={activeStoryCount}
              displayName={session?.displayName ?? "Account"}
              email={account?.email}
              handle={session?.handle ?? "account"}
              unreadReplyCount={0}
            />

            {liveFeed.error && !hasFeedData ? (
              <HomeStatus
                title="Could not load stories"
                text={liveFeed.error}
                actionLabel="Sign in again"
                onAction={expireSession}
              />
            ) : null}

            {liveFeed.isLoading && !hasFeedData ? (
              <HomeStatus
                title="Loading stories"
                text="Pulling your feed from the local server."
              />
            ) : null}

            {hasFeedData ? (
              <>
                {shouldShowFollowing ? (
                  <Section
                    title="Following"
                    compact
                    onPress={() => router.push("/following")}
                  >
                    <FollowingPreviewRail
                      myStory={myStory}
                      stories={followedStories}
                    />
                  </Section>
                ) : null}

                <SectionTitle
                  title="Discover"
                  withChevron={false}
                  compact
                />
                {liveFeed.isRefreshing ? (
                  <Text style={styles.refreshText}>
                    Refreshing latest stories...
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        }
      />
    </ScreenFrame>
  )
}

function Section({
  title,
  onPress,
  withChevron = true,
  compact = false,
  children,
}: {
  title: string
  onPress?: () => void
  withChevron?: boolean
  compact?: boolean
  children: ReactNode
}) {
  return (
    <>
      <SectionTitle
        title={title}
        onPress={onPress}
        withChevron={withChevron}
        compact={compact}
      />
      {children}
    </>
  )
}

function HomeStatus({
  actionLabel,
  onAction,
  text,
  title,
}: {
  actionLabel?: string
  onAction?: () => void
  text: string
  title: string
}) {
  return (
    <View style={styles.statusPanel}>
      <View style={styles.statusIcon}>
        <Ionicons name="cloud-offline-outline" size={22} color="#111827" />
      </View>
      <Text style={styles.statusTitle}>{title}</Text>
      <Text style={styles.statusText}>{text}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [
            styles.statusButton,
            pressed ? styles.statusButtonPressed : null,
          ]}
        >
          <Text style={styles.statusButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  homeListHeader: {
    gap: 24,
  },
  statusPanel: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    padding: 18,
    borderRadius: 8,
    gap: 8,
  },
  statusIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  statusTitle: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "700",
  },
  statusText: {
    color: "#6b7280",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  statusButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statusButtonPressed: {
    opacity: 0.82,
  },
  statusButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  refreshText: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "600",
    marginTop: -18,
  },
})
