import Ionicons from "@expo/vector-icons/Ionicons"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { useFollowState } from "@/lib/follow-state"
import { useAuthFlow } from "@/lib/auth-flow"
import { useMobileFeed } from "@/lib/mobile-stories-api"
import {
  DiscoverGrid,
  ScreenFrame,
  ScreenScroll,
} from "@/components/social/ui"

type DiscoverSearchResult = {
  id: string
  name: string
  handle: string
  category: string
  avatarUrl: string
  coverUrl: string
  isAdded: boolean
  hasActiveStory: boolean
  searchText: string
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

export default function DiscoverScreen() {
  const router = useRouter()
  const { focus } = useLocalSearchParams<{ focus?: string }>()
  const { account } = useAuthFlow()
  const inputRef = useRef<TextInput>(null)
  const [query, setQuery] = useState("")
  const { isFollowing, revision, toggleFollow } = useFollowState()
  const liveFeed = useMobileFeed(account?.mobileToken, revision)
  const discoverTiles = liveFeed.data?.discoverTiles ?? []
  const normalizedQuery = query.trim().toLowerCase()

  useEffect(() => {
    if (focus === "1") {
      const focusTimer = setTimeout(() => inputRef.current?.focus(), 150)

      return () => clearTimeout(focusTimer)
    }
  }, [focus])

  const results = useMemo(() => {
    if (!normalizedQuery) return []

    return (
      liveFeed.data?.suggestedAccounts.map((accountResult) => ({
        id: accountResult.id,
        name: accountResult.name,
        handle: accountResult.handle.replace(/^@/, ""),
        category: accountResult.reason,
        avatarUrl:
          accountResult.imageUrl ??
          "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=500&q=80",
        coverUrl:
          accountResult.imageUrl ??
          "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1200&q=80",
        isAdded: false,
        hasActiveStory: true,
        searchText: `${accountResult.name} ${accountResult.handle} ${accountResult.reason}`.toLowerCase(),
      })) ?? []
    )
      .filter((profile) => profile.searchText.includes(normalizedQuery))
      .slice(0, 12)
  }, [liveFeed.data?.suggestedAccounts, normalizedQuery])

  return (
    <ScreenFrame>
      <ScreenScroll>
        <View style={styles.header}>
          <Text style={styles.title}>Discover</Text>
          <View style={styles.searchShell}>
            <Ionicons name="search-outline" size={20} color={colors.subtext} />
            <TextInput
              ref={inputRef}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder="Search creators"
              placeholderTextColor={colors.faint}
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />
          </View>
        </View>

        {normalizedQuery ? (
          <View style={styles.resultsSection}>
            <Text style={styles.sectionTitle}>Results</Text>
            {results.length > 0 ? (
              <View style={styles.resultList}>
                {results.map((profile) => (
                  <CreatorResultRow
                    key={profile.id}
                    isFollowing={isFollowing(profile.id)}
                    onToggleFollow={() => toggleFollow(profile.id)}
                    profile={profile}
                    onOpenProfile={() => router.push(`/creator/${profile.id}`)}
                    onOpenStory={() => router.push(`/story/${profile.id}`)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={22} color={colors.faint} />
                <Text style={styles.emptyText}>No results</Text>
              </View>
            )}
          </View>
        ) : (
          <DiscoverGrid tiles={discoverTiles} />
        )}
      </ScreenScroll>
    </ScreenFrame>
  )
}

function CreatorResultRow({
  isFollowing,
  onOpenProfile,
  onOpenStory,
  onToggleFollow,
  profile,
}: {
  isFollowing: boolean
  onOpenProfile: () => void
  onOpenStory: () => void
  onToggleFollow: () => void
  profile: DiscoverSearchResult
}) {
  return (
    <View style={styles.resultRow}>
      <Pressable
        accessibilityLabel={`Open ${profile.name} profile`}
        accessibilityRole="button"
        onPress={onOpenProfile}
        style={({ pressed }) => [
          styles.resultMainAction,
          pressed ? styles.resultRowPressed : null,
        ]}
      >
        <View
          style={[
            styles.resultAvatarFrame,
            profile.hasActiveStory
              ? styles.resultAvatarFrameActive
              : styles.resultAvatarFrameInactive,
          ]}
        >
          <Image source={{ uri: profile.avatarUrl }} style={styles.resultImage} />
        </View>

        <View style={styles.resultCopy}>
          <Text style={styles.resultTitle} numberOfLines={1}>
            {profile.name}
          </Text>
          <Text style={styles.resultSubtitle} numberOfLines={1}>
            @{profile.handle} · {profile.category}
          </Text>
        </View>
      </Pressable>

      {profile.hasActiveStory ? (
        <Pressable
          accessibilityLabel={`Open ${profile.name} story`}
          accessibilityRole="button"
          onPress={onOpenStory}
          style={({ pressed }) => [
            styles.iconButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <Ionicons name="play" size={16} color={colors.subtext} />
        </Pressable>
      ) : null}

      <Pressable
        accessibilityLabel={`${isFollowing ? "Remove" : "Add"} ${profile.name}`}
        accessibilityRole="button"
        onPress={onToggleFollow}
        style={({ pressed }) => [
          styles.followButton,
          isFollowing ? styles.followButtonActive : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <Ionicons
          name={isFollowing ? "checkmark" : "add"}
          size={23}
          color={isFollowing ? colors.surface : colors.text}
        />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    gap: 14,
  },
  title: {
    fontSize: 38,
    fontFamily: "Inter_800ExtraBold",
    fontWeight: "800",
    color: colors.text,
  },
  searchShell: {
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: colors.text,
  },
  resultsSection: {
    marginTop: 24,
  },
  sectionTitle: {
    marginBottom: 12,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  resultList: {
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultMainAction: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  resultRowPressed: {
    backgroundColor: colors.mutedSurface,
  },
  resultAvatarFrame: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  resultAvatarFrameActive: {
    borderColor: colors.accent,
  },
  resultAvatarFrameInactive: {
    borderColor: colors.border,
  },
  resultImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.mutedSurface,
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  resultSubtitle: {
    marginTop: 3,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: colors.subtext,
  },
  iconButton: {
    width: 38,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
  },
  followButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 12,
    backgroundColor: colors.mutedSurface,
  },
  followButtonActive: {
    backgroundColor: colors.accent,
  },
  pressed: {
    opacity: 0.72,
  },
  emptyState: {
    minHeight: 150,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.subtext,
  },
})
