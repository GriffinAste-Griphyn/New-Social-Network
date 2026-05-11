import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"
import {
  deleteMobileApi,
  getMobileApi,
  MobileApiError,
} from "@/lib/mobile-api"
import { ScreenFrame, ScreenScroll } from "@/components/social/ui"

type BlockedUser = {
  id: string
  name: string
  handle: string
  imageUrl: string | null
  blockedAt: string
}

type BlockedUsersResponse = {
  ok: true
  blockedUsers: BlockedUser[]
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

function initials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export default function BlockedUsersScreen() {
  const router = useRouter()
  const { account, expireSession } = useAuthFlow()
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null)

  const loadBlockedUsers = useCallback(() => {
    let isMounted = true

    if (!account?.mobileToken) {
      setBlockedUsers([])
      setIsLoading(false)
      return () => {
        isMounted = false
      }
    }

    setIsLoading(true)

    getMobileApi<BlockedUsersResponse>("/api/mobile/blocks", {
      authToken: account.mobileToken,
    })
      .then((payload) => {
        if (isMounted) {
          setBlockedUsers(payload.blockedUsers)
        }
      })
      .catch((error) => {
        if (!isMounted) return
        setBlockedUsers([])

        if (error instanceof MobileApiError && error.status === 401) {
          expireSession()
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
  }, [account?.mobileToken, expireSession])

  useEffect(() => loadBlockedUsers(), [loadBlockedUsers])

  const unblockUser = async (user: BlockedUser) => {
    if (!account?.mobileToken || unblockingUserId) {
      return
    }

    setUnblockingUserId(user.id)

    try {
      await deleteMobileApi<{ ok: true }>(
        "/api/mobile/blocks",
        { blockedUserId: user.id },
        { authToken: account.mobileToken },
      )
      setBlockedUsers((current) =>
        current.filter((blockedUser) => blockedUser.id !== user.id),
      )
    } catch (error) {
      Alert.alert(
        "Could not unblock user",
        error instanceof Error ? error.message : "Try again in a moment.",
      )
    } finally {
      setUnblockingUserId(null)
    }
  }

  const confirmUnblockUser = (user: BlockedUser) => {
    Alert.alert(
      `Unblock ${user.name}?`,
      "They may be able to see and interact with your public stories again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          onPress: () => void unblockUser(user),
        },
      ],
    )
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
            <Text style={styles.eyebrow}>Safety</Text>
            <Text style={styles.title}>Blocked users</Text>
            <Text style={styles.subtitle}>
              {blockedUsers.length} blocked account
              {blockedUsers.length === 1 ? "" : "s"}
            </Text>
          </View>
        </View>

        <View style={styles.panel}>
          {isLoading ? (
            <EmptyState title="Loading accounts" text="Checking blocked users." />
          ) : blockedUsers.length > 0 ? (
            blockedUsers.map((user) => (
              <BlockedUserRow
                isUnblocking={unblockingUserId === user.id}
                key={user.id}
                onUnblock={() => confirmUnblockUser(user)}
                user={user}
              />
            ))
          ) : (
            <EmptyState
              title="No blocked users"
              text="Accounts you block from stories or profiles will appear here."
            />
          )}
        </View>
      </ScreenScroll>
    </ScreenFrame>
  )
}

function BlockedUserRow({
  isUnblocking,
  onUnblock,
  user,
}: {
  isUnblocking: boolean
  onUnblock: () => void
  user: BlockedUser
}) {
  return (
    <View style={styles.userRow}>
      <View style={styles.avatar}>
        {user.imageUrl ? (
          <Image source={{ uri: user.imageUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>{initials(user.name)}</Text>
        )}
      </View>
      <View style={styles.userCopy}>
        <Text style={styles.userName} numberOfLines={1}>
          {user.name}
        </Text>
        <Text style={styles.userHandle} numberOfLines={1}>
          @{user.handle.replace(/^@/, "")}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={`Unblock ${user.name}`}
        accessibilityRole="button"
        disabled={isUnblocking}
        onPress={onUnblock}
        style={({ pressed }) => [
          styles.unblockButton,
          pressed ? styles.pressed : null,
        ]}
      >
        {isUnblocking ? (
          <ActivityIndicator size="small" color={colors.surface} />
        ) : (
          <Text style={styles.unblockButtonText}>Unblock</Text>
        )}
      </Pressable>
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
  panel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
  },
  userRow: {
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
  userCopy: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  userHandle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "500",
    color: colors.subtext,
  },
  unblockButton: {
    minWidth: 86,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dark,
    paddingHorizontal: 12,
  },
  unblockButtonText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.surface,
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
