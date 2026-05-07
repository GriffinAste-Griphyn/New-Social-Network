import Ionicons from "@expo/vector-icons/Ionicons"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useMemo, useState } from "react"
import { Image, Pressable, StyleSheet, Text, View } from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"
import { useFollowState } from "@/lib/follow-state"
import { getMobileApi } from "@/lib/mobile-api"
import {
  ScreenFrame,
  ScreenScroll,
} from "@/components/social/ui"

type FollowProfile = {
  id: string
  name: string
  handle: string
  imageUrl: string | null
}

type FollowProfilesResponse = {
  ok: true
  followers: FollowProfile[]
  following: FollowProfile[]
}

type FollowView = "followers" | "following"

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

function initials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export default function FollowersScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ view?: string }>()
  const { account } = useAuthFlow()
  const { isFollowing, revision, toggleFollow } = useFollowState()
  const [followers, setFollowers] = useState<FollowProfile[]>([])
  const [following, setFollowing] = useState<FollowProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeView, setActiveView] = useState<FollowView>(
    params.view === "following" ? "following" : "followers",
  )

  useEffect(() => {
    let isMounted = true

    if (!account?.mobileToken) {
      setFollowers([])
      setFollowing([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    getMobileApi<FollowProfilesResponse>("/api/mobile/follows/profiles", {
      authToken: account.mobileToken,
    })
      .then((payload) => {
        if (!isMounted) return
        setFollowers(payload.followers)
        setFollowing(payload.following)
      })
      .catch(() => {
        if (!isMounted) return
        setFollowers([])
        setFollowing([])
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [account?.mobileToken, revision])

  const rows = useMemo(
    () => (activeView === "followers" ? followers : following),
    [activeView, followers, following],
  )

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
            <Text style={styles.eyebrow}>Audience</Text>
            <Text style={styles.title}>Followers</Text>
            <Text style={styles.subtitle}>
              {followers.length} followers · {following.length} following
            </Text>
          </View>
        </View>

        <View style={styles.switcher}>
          <SwitchButton
            active={activeView === "followers"}
            label="Followers"
            onPress={() => setActiveView("followers")}
          />
          <SwitchButton
            active={activeView === "following"}
            label="Following"
            onPress={() => setActiveView("following")}
          />
        </View>

        <View style={styles.panel}>
          {isLoading ? (
            <EmptyState title="Loading accounts" text="Checking your audience." />
          ) : rows.length > 0 ? (
            rows.map((profile) => (
              <ProfileRow
                isFollowing={isFollowing(profile.id)}
                key={profile.id}
                onToggleFollow={() => toggleFollow(profile.id)}
                profile={profile}
                showFollowButton
              />
            ))
          ) : (
            <EmptyState
              title={
                activeView === "followers"
                  ? "No followers yet"
                  : "Not following anyone yet"
              }
              text={
                activeView === "followers"
                  ? "Followers appear here when people add your account."
                  : "Creators you follow from Discover appear here."
              }
            />
          )}
        </View>
      </ScreenScroll>
    </ScreenFrame>
  )
}

function SwitchButton({
  active,
  label,
  onPress,
}: {
  active: boolean
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${label.toLowerCase()}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.switchButton,
        active ? styles.switchButtonActive : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text
        style={[
          styles.switchButtonText,
          active ? styles.switchButtonTextActive : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function ProfileRow({
  isFollowing,
  onToggleFollow,
  profile,
  showFollowButton,
}: {
  isFollowing: boolean
  onToggleFollow: () => void
  profile: FollowProfile
  showFollowButton: boolean
}) {
  return (
    <View style={styles.profileRow}>
      <View style={styles.avatar}>
        {profile.imageUrl ? (
          <Image source={{ uri: profile.imageUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>{initials(profile.name)}</Text>
        )}
      </View>
      <View style={styles.profileCopy}>
        <Text style={styles.profileName} numberOfLines={1}>
          {profile.name}
        </Text>
        <Text style={styles.profileHandle} numberOfLines={1}>
          @{profile.handle}
        </Text>
      </View>
      {showFollowButton ? (
        <Pressable
          accessibilityLabel={`${isFollowing ? "Unfollow" : "Follow"} ${profile.name}`}
          accessibilityRole="button"
          onPress={onToggleFollow}
          style={({ pressed }) => [
            styles.followButton,
            isFollowing ? styles.followButtonActive : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text
            style={[
              styles.followButtonText,
              isFollowing ? styles.followButtonTextActive : null,
            ]}
          >
            {isFollowing ? "Following" : "Follow"}
          </Text>
        </Pressable>
      ) : null}
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
    fontWeight: "500",
    color: colors.subtext,
  },
  switcher: {
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.surface,
    flexDirection: "row",
    padding: 4,
  },
  switchButton: {
    flex: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  switchButtonActive: {
    backgroundColor: colors.dark,
  },
  switchButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.subtext,
  },
  switchButtonTextActive: {
    color: colors.surface,
  },
  panel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
  },
  profileRow: {
    minHeight: 72,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
  },
  avatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  profileHandle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "500",
    color: colors.subtext,
  },
  followButton: {
    minWidth: 78,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dark,
    paddingHorizontal: 12,
  },
  followButtonActive: {
    backgroundColor: colors.mutedSurface,
  },
  followButtonText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.surface,
  },
  followButtonTextActive: {
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
