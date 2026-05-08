import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { Image, Pressable, StyleSheet, Text, View } from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"
import { getMobileApi } from "@/lib/mobile-api"
import {
  AccountAvatarButton,
  ScreenFrame,
  ScreenHeader,
  ScreenScroll,
} from "@/components/social/ui"

type ReplyView = "received" | "sent"

type StoryInteractionEvent = {
  id: string
  storyId: string
  actor: {
    id: string
    name: string
    handle: string
    imageUrl: string | null
  }
  body: string | null
  mediaUrl: string | null
  mediaThumbnailUrl: string | null
  mediaAssetKind: "image" | "video" | null
  createdAt: string
}

type StoryInteractionsResponse = {
  ok: true
  interactions: StoryInteractionEvent[]
}

const colors = {
  surface: "#ffffff",
  mutedSurface: "#f5f6f8",
  text: "#17191f",
  subtext: "#6b7280",
  faint: "#9ca3af",
  border: "#e5e7eb",
  accent: "#e01616",
}

export default function RepliesScreen() {
  const { account } = useAuthFlow()
  const [activeView, setActiveView] = useState<ReplyView>("received")
  const [interactions, setInteractions] = useState<StoryInteractionEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    if (!account?.mobileToken) {
      setInteractions([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    getMobileApi<StoryInteractionsResponse>(
      "/api/mobile/stories/my-story/interactions",
      { authToken: account.mobileToken },
    )
      .then((payload) => {
        if (!isMounted) return
        setInteractions(payload.interactions)
      })
      .catch(() => {
        if (isMounted) {
          setInteractions([])
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
  }, [account?.mobileToken])

  return (
    <ScreenFrame>
      <ScreenScroll>
        <ScreenHeader title="Replies" right={<AccountAvatarButton />} />

        <ReplyViewSwitch activeView={activeView} onChange={setActiveView} />

        {activeView === "received" ? (
          <ReceivedRepliesList interactions={interactions} isLoading={isLoading} />
        ) : (
          <EmptyReplies
            icon="paper-plane-outline"
            title="No sent replies"
            text="Replies you send to other creators will appear here once a live API endpoint supports sent-reply history."
          />
        )}
      </ScreenScroll>
    </ScreenFrame>
  )
}

function ReplyViewSwitch({
  activeView,
  onChange,
}: {
  activeView: ReplyView
  onChange: (view: ReplyView) => void
}) {
  return (
    <View style={styles.switcher}>
      <ReplySwitchButton
        active={activeView === "received"}
        label="Received"
        onPress={() => onChange("received")}
      />
      <ReplySwitchButton
        active={activeView === "sent"}
        label="Sent"
        onPress={() => onChange("sent")}
      />
    </View>
  )
}

function ReplySwitchButton({
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
      accessibilityLabel={`Show ${label.toLowerCase()} replies`}
      accessibilityRole="button"
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

function ReceivedRepliesList({
  interactions,
  isLoading,
}: {
  interactions: StoryInteractionEvent[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <EmptyReplies
        icon="sync-outline"
        title="Loading replies"
        text="Checking live story replies."
      />
    )
  }

  if (interactions.length === 0) {
    return (
      <EmptyReplies
        icon="chatbubble-ellipses-outline"
        title="No replies yet"
        text="Replies to your live stories will appear here."
      />
    )
  }

  return (
    <View style={styles.threadList}>
      {interactions.map((interaction) => (
        <ReceivedReplyRow key={interaction.id} interaction={interaction} />
      ))}
    </View>
  )
}

function ReceivedReplyRow({
  interaction,
}: {
  interaction: StoryInteractionEvent
}) {
  const router = useRouter()

  return (
    <Pressable
      accessibilityLabel={`Open chat with ${interaction.actor.name}`}
      accessibilityRole="button"
      onPress={() => router.push(`/replies/${interaction.actor.id}`)}
      style={({ pressed }) => [
        styles.threadRow,
        pressed ? styles.threadRowPressed : null,
      ]}
    >
      <View style={styles.avatar}>
        {interaction.actor.imageUrl ? (
          <Image source={{ uri: interaction.actor.imageUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>{initials(interaction.actor.name)}</Text>
        )}
      </View>

      <View style={styles.threadBody}>
        <Text style={styles.threadName} numberOfLines={1}>
          {interaction.actor.name}
        </Text>
        <Text style={styles.statusText} numberOfLines={1}>
          @{interaction.actor.handle} · {formatReplyTime(interaction.createdAt)}
        </Text>
        <Text style={styles.replyText} numberOfLines={2}>
          {getReplyPreview(interaction)}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={17} color={colors.faint} />
    </Pressable>
  )
}

function getReplyPreview(interaction: StoryInteractionEvent) {
  if (interaction.body) {
    return interaction.body
  }

  if (interaction.mediaAssetKind === "video") {
    return "Sent a video reply."
  }

  if (interaction.mediaAssetKind === "image") {
    return "Sent a photo reply."
  }

  return "Sent a reaction."
}

function EmptyReplies({
  icon,
  text,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap
  text: string
  title: string
}) {
  return (
    <View style={styles.emptyPanel}>
      <Ionicons name={icon} size={24} color={colors.faint} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  )
}

function formatReplyTime(value: string) {
  return Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
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
  switcher: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    padding: 3,
  },
  switchButton: {
    flex: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  switchButtonActive: {
    backgroundColor: colors.text,
  },
  switchButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.subtext,
  },
  switchButtonTextActive: {
    color: colors.surface,
  },
  threadList: {
    gap: 10,
  },
  threadRow: {
    minHeight: 82,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  threadRowPressed: {
    transform: [{ scale: 0.995 }],
    opacity: 0.78,
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
    width: "100%",
    height: "100%",
    borderRadius: 23,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  threadBody: {
    flex: 1,
    minWidth: 0,
  },
  threadName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  statusText: {
    marginTop: 2,
    fontSize: 12,
    color: colors.subtext,
  },
  replyText: {
    marginTop: 5,
    fontSize: 13,
    color: colors.text,
  },
  emptyPanel: {
    minHeight: 170,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  emptyTitle: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  emptyText: {
    marginTop: 4,
    textAlign: "center",
    fontSize: 13,
    lineHeight: 18,
    color: colors.subtext,
  },
  pressed: {
    opacity: 0.72,
  },
})
