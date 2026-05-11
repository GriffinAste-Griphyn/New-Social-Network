import Ionicons from "@expo/vector-icons/Ionicons"
import { StatusBar } from "expo-status-bar"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  getCreatorNotificationsEnabled,
  setCreatorNotificationsEnabled,
} from "@/lib/creator-notifications"
import { useFollowState } from "@/lib/follow-state"
import { getMobileApi, postMobileApi } from "@/lib/mobile-api"

type CreatorProfileView = {
  id: string
  name: string
  handle: string
  category: string
  avatarUrl: string | null
  coverUrl: string | null
  hasActiveStory: boolean
}

type MobileCreatorProfileResponse = {
  ok: true
  profile: CreatorProfileView
}

const colors = {
  background: "#000000",
  text: "#ffffff",
  mutedText: "rgba(255,255,255,0.78)",
  glass: "rgba(0,0,0,0.34)",
  button: "rgba(255,255,255,0.30)",
  active: "#00e340",
  verified: "#e01616",
}

export default function CreatorProfileScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { isFollowing, toggleFollow } = useFollowState()
  const [profile, setProfile] = useState<CreatorProfileView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isFollowMenuOpen, setIsFollowMenuOpen] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [areNotificationsEnabled, setAreNotificationsEnabled] = useState(false)
  const [isUpdatingNotifications, setIsUpdatingNotifications] = useState(false)
  const [isBlockingProfile, setIsBlockingProfile] = useState(false)
  const isAdded = profile ? isFollowing(profile.id) : false

  useEffect(() => {
    let isMounted = true

    if (!id) {
      setProfile(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setIsFollowMenuOpen(false)
    setIsProfileMenuOpen(false)

    getMobileApi<MobileCreatorProfileResponse>(
      `/api/mobile/creators/${encodeURIComponent(id)}`,
    )
      .then((payload) => {
        if (!isMounted) return
        setProfile(payload.profile)
      })
      .catch(() => {
        if (isMounted) {
          setProfile(null)
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [id])

  useEffect(() => {
    let isMounted = true

    if (!profile) {
      setAreNotificationsEnabled(false)
      return
    }

    getCreatorNotificationsEnabled(profile.id)
      .then((enabled) => {
        if (isMounted) {
          setAreNotificationsEnabled(enabled)
        }
      })
      .catch(() => {
        if (isMounted) {
          setAreNotificationsEnabled(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [profile?.id])

  const handleFollowPress = () => {
    if (!profile) return

    if (isAdded) {
      setIsFollowMenuOpen(true)
      return
    }

    toggleFollow(profile.id)
  }

  const removeFromFollowing = () => {
    if (profile && isAdded) {
      toggleFollow(profile.id)
    }

    setIsFollowMenuOpen(false)
  }

  const toggleNotifications = async () => {
    if (!profile || isUpdatingNotifications) {
      return
    }

    const nextEnabled = !areNotificationsEnabled

    setIsUpdatingNotifications(true)

    try {
      const enabled = await setCreatorNotificationsEnabled({
        creatorId: profile.id,
        enabled: nextEnabled,
      })

      setAreNotificationsEnabled(enabled)
      Alert.alert(
        enabled ? "Notifications on" : "Notifications off",
        enabled
          ? `You will be notified when ${profile.name} posts a story.`
          : `You will no longer be notified when ${profile.name} posts.`,
      )
    } catch (error) {
      Alert.alert(
        "Could not update notifications",
        error instanceof Error ? error.message : "Try again in a moment.",
      )
    } finally {
      setIsUpdatingNotifications(false)
    }
  }

  const blockProfile = async () => {
    if (!profile || isBlockingProfile) {
      return
    }

    setIsBlockingProfile(true)

    try {
      await postMobileApi<{ ok: true }>("/api/mobile/blocks", {
        blockedUserId: profile.id,
      })
      setIsProfileMenuOpen(false)
      Alert.alert("User blocked", `${profile.name} will no longer appear in your feed.`)
      router.replace("/")
    } catch (error) {
      Alert.alert(
        "Could not block user",
        error instanceof Error ? error.message : "Try again in a moment.",
      )
    } finally {
      setIsBlockingProfile(false)
    }
  }

  const confirmBlockProfile = () => {
    if (!profile || isBlockingProfile) {
      return
    }

    Alert.alert(
      `Block ${profile.name}?`,
      "You will stop seeing each other's stories, follows, replies, and notifications.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => void blockProfile(),
        },
      ],
    )
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" translucent />
      {profile?.coverUrl ? (
        <Image source={{ uri: profile.coverUrl }} style={styles.coverImage} />
      ) : (
        <View style={styles.coverFallback} />
      )}
      <View style={styles.coverShade} />
      <View style={styles.topShade} />
      <View style={styles.bottomShade} />

      <View style={styles.topActions}>
        <ProfileIconButton
          accessibilityLabel="Close profile"
          icon="chevron-down"
          onPress={() => router.back()}
          size={28}
        />

        <View style={styles.topActionCluster}>
          <ProfileIconButton
            accessibilityLabel={
              profile && areNotificationsEnabled
                ? `Turn off notifications for ${profile.name}`
                : "Turn on profile notifications"
            }
            active={areNotificationsEnabled}
            disabled={!profile || isUpdatingNotifications}
            icon={areNotificationsEnabled ? "notifications" : "notifications-outline"}
            onPress={toggleNotifications}
            size={25}
          />
          <ProfileIconButton
            accessibilityLabel="Share profile"
            icon="arrow-redo-outline"
            size={27}
          />
          <ProfileIconButton
            accessibilityLabel="More profile actions"
            icon="ellipsis-horizontal"
            onPress={() => setIsProfileMenuOpen(true)}
            size={27}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : null}

      {!isLoading && !profile ? (
        <View style={styles.centerState}>
          <Text style={styles.unavailableTitle}>Creator unavailable</Text>
        </View>
      ) : null}

      {profile ? (
        <SafeAreaView style={styles.profileBlock} edges={["bottom"]}>
          <View style={styles.identityRow}>
            <View style={styles.avatarRing}>
              {profile.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>{initials(profile.name)}</Text>
                </View>
              )}
              {profile.hasActiveStory ? <View style={styles.activeDot} /> : null}
            </View>

            <View style={styles.identityCopy}>
              <View style={styles.nameRow}>
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  numberOfLines={1}
                  style={styles.name}
                >
                  {profile.name}
                </Text>
                <View style={styles.verifiedBadge}>
                  <Ionicons name="star" size={15} color={colors.text} />
                </View>
              </View>
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                numberOfLines={1}
                style={styles.metaLine}
              >
                @{profile.handle.replace(/^@/, "")} · {profile.category}
              </Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              accessibilityLabel={isAdded ? "Open following options" : "Add creator"}
              accessibilityRole="button"
              onPress={handleFollowPress}
              style={({ pressed }) => [
                styles.addedButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <Ionicons
                name={isAdded ? "person" : "person-add"}
                size={19}
                color={colors.text}
              />
              <Text style={styles.addedText}>{isAdded ? "Added" : "Add"}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}

      {profile && isFollowMenuOpen ? (
        <View style={styles.followMenuLayer}>
          <Pressable
            accessibilityLabel="Close following options"
            accessibilityRole="button"
            onPress={() => setIsFollowMenuOpen(false)}
            style={styles.followMenuBackdrop}
          />
          <SafeAreaView style={styles.followMenu} edges={["bottom"]}>
            <View style={styles.followMenuHandle} />
            <Text style={styles.followMenuTitle}>{profile.name}</Text>
            <Pressable
              accessibilityLabel={`Remove ${profile.name} from following`}
              accessibilityRole="button"
              onPress={removeFromFollowing}
              style={({ pressed }) => [
                styles.removeFollowButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <Ionicons name="person-remove" size={18} color="#ef4444" />
              <Text style={styles.removeFollowText}>Remove from following</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cancel"
              accessibilityRole="button"
              onPress={() => setIsFollowMenuOpen(false)}
              style={({ pressed }) => [
                styles.cancelFollowButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.cancelFollowText}>Cancel</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      ) : null}

      {profile && isProfileMenuOpen ? (
        <View style={styles.followMenuLayer}>
          <Pressable
            accessibilityLabel="Close profile actions"
            accessibilityRole="button"
            onPress={() => setIsProfileMenuOpen(false)}
            style={styles.followMenuBackdrop}
          />
          <SafeAreaView style={styles.followMenu} edges={["bottom"]}>
            <View style={styles.followMenuHandle} />
            <Text style={styles.followMenuTitle}>{profile.name}</Text>
            <Pressable
              accessibilityLabel={`Block ${profile.name}`}
              accessibilityRole="button"
              disabled={isBlockingProfile}
              onPress={confirmBlockProfile}
              style={({ pressed }) => [
                styles.removeFollowButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <Ionicons name="ban-outline" size={18} color="#ef4444" />
              <Text style={styles.removeFollowText}>
                {isBlockingProfile ? "Blocking..." : "Block user"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cancel"
              accessibilityRole="button"
              onPress={() => setIsProfileMenuOpen(false)}
              style={({ pressed }) => [
                styles.cancelFollowButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.cancelFollowText}>Cancel</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      ) : null}
    </View>
  )
}

function ProfileIconButton({
  accessibilityLabel,
  active = false,
  disabled = false,
  icon,
  onPress,
  size,
}: {
  accessibilityLabel: string
  active?: boolean
  disabled?: boolean
  icon: keyof typeof Ionicons.glyphMap
  onPress?: () => void
  size: number
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        active ? styles.iconButtonActive : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Ionicons name={icon} size={size} color={colors.text} />
    </Pressable>
  )
}

function initials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  coverImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  coverFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#111827",
  },
  coverShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  topShade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 130,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  bottomShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "44%",
    backgroundColor: "rgba(0,0,0,0.34)",
  },
  topActions: {
    position: "absolute",
    top: 76,
    left: 28,
    right: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topActionCluster: {
    flexDirection: "row",
    gap: 10,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.glass,
  },
  iconButtonActive: {
    backgroundColor: "rgba(224,22,22,0.78)",
  },
  centerState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  unavailableTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  profileBlock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 20,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatarRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  avatarFallback: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.button,
  },
  avatarFallbackText: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
  },
  activeDot: {
    position: "absolute",
    right: 3,
    bottom: 3,
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: colors.background,
    backgroundColor: colors.active,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    flexShrink: 1,
    fontSize: 34,
    fontWeight: "700",
    color: colors.text,
  },
  verifiedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.verified,
  },
  metaLine: {
    marginTop: 3,
    fontSize: 15,
    fontWeight: "600",
    color: colors.mutedText,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  addedButton: {
    height: 48,
    flex: 1,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.button,
  },
  addedText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  followMenuLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  followMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  followMenu: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#ffffff",
    padding: 18,
    gap: 12,
  },
  followMenuHandle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
  },
  followMenuTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#17191f",
  },
  removeFollowButton: {
    minHeight: 48,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fef2f2",
    paddingHorizontal: 14,
  },
  removeFollowText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ef4444",
  },
  cancelFollowButton: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  cancelFollowText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#17191f",
  },
  pressed: {
    opacity: 0.72,
  },
})
