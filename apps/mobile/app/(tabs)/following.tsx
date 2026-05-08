import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"
import { useMemo } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"
import { useFollowState } from "@/lib/follow-state"
import { useMobileFeed } from "@/lib/mobile-stories-api"
import {
  AccountAvatarButton,
  ScreenFrame,
  ScreenHeader,
  ScreenScroll,
  StoryList,
} from "@/components/social/ui"

export default function FollowingScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const { followedCreatorIds, revision } = useFollowState()
  const liveFeed = useMobileFeed(account?.mobileToken, revision)
  const followingStories = liveFeed.data?.followingStories ?? []
  const chronologicalStories = useMemo(
    () => [...followingStories].sort(
      (left, right) =>
        Date.parse(right.lastUploadedAt) - Date.parse(left.lastUploadedAt),
    ),
    [followingStories],
  )
  const hasFollowedCreators = followedCreatorIds.size > 0
  const isEmpty = chronologicalStories.length === 0 && !liveFeed.isLoading

  return (
    <ScreenFrame>
      {isEmpty ? (
        <ScreenScroll>
          <ScreenHeader
            title="Following"
            subtitle="Live stories from accounts you already follow."
            right={<AccountAvatarButton />}
          />
          <FollowingEmptyState
            hasFollowedCreators={hasFollowedCreators}
            onBrowseDiscover={() => router.push("/discover")}
          />
        </ScreenScroll>
      ) : (
        <StoryList
          stories={chronologicalStories}
          contentContainerStyle={styles.feedContent}
          showStoryTitle={false}
          ListHeaderComponent={
            <ScreenHeader
              title="Following"
              subtitle="Live stories from accounts you already follow."
              right={<AccountAvatarButton />}
            />
          }
        />
      )}
    </ScreenFrame>
  )
}

function FollowingEmptyState({
  hasFollowedCreators,
  onBrowseDiscover,
}: {
  hasFollowedCreators: boolean
  onBrowseDiscover: () => void
}) {
  return (
    <View style={styles.emptyPanel}>
      <View style={styles.emptyIcon}>
        <Ionicons
          name={hasFollowedCreators ? "time-outline" : "person-add-outline"}
          size={24}
          color="#111827"
        />
      </View>
      <Text style={styles.emptyTitle}>
        {hasFollowedCreators ? "No live stories yet" : "Build your following feed"}
      </Text>
      <Text style={styles.emptyText}>
        {hasFollowedCreators
          ? "Creators you follow will appear here when they post a live story."
          : "Follow creators from Discover and their live stories will show up here."}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Browse creators in Discover"
        onPress={onBrowseDiscover}
        style={({ pressed }) => [
          styles.emptyButton,
          pressed ? styles.emptyButtonPressed : null,
        ]}
      >
        <Ionicons name="compass-outline" size={18} color="#ffffff" />
        <Text style={styles.emptyButtonText}>Browse Discover</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  feedContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  emptyPanel: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    padding: 18,
  },
  emptyIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6b7280",
    marginBottom: 16,
  },
  emptyButton: {
    alignSelf: "flex-start",
    minHeight: 42,
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#111827",
  },
  emptyButtonPressed: {
    opacity: 0.82,
  },
  emptyButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
})
