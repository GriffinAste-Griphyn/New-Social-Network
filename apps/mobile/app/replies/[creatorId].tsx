import type { ComponentProps } from "react"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useRef, useState } from "react"
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { ScreenFrame } from "@/components/social/ui"

type MobileChatStatus = "delivered" | "opened" | "received"

type ChatEvent = {
  id: string
  dateLabel: string
  direction?: "received" | "sent"
  message: string
  storyMediaUrl: string | null
  time: string
}

type MobileChatThread = {
  id: string
  name: string
  handle: string
  avatarUrl: string | null
  avatarTint?: string
  hasStoryRing: boolean
  isVerified: boolean
  status: MobileChatStatus
  statusAge: string
  unreadCount: number
  events: ChatEvent[]
}

const colors = {
  background: "#f3f4f6",
  surface: "#ffffff",
  mutedSurface: "#f5f6f8",
  text: "#111319",
  subtext: "#6b7280",
  faint: "#9ca3af",
  border: "#e5e7eb",
  accent: "#e01616",
  accentSoft: "rgba(224,22,22,0.12)",
  accentBubble: "#fde2e2",
  accentBubbleBorder: "#f6b7b7",
  dark: "#111827",
}

export default function ReplyThreadScreen() {
  const router = useRouter()
  const { creatorId } = useLocalSearchParams<{ creatorId: string }>()
  const creator = buildEmptyThread(creatorId)
  const [draft, setDraft] = useState("")
  const [events, setEvents] = useState<ChatEvent[]>(() => creator?.events ?? [])
  const scrollViewRef = useRef<ScrollView>(null)

  useEffect(() => {
    const keyboardListener = Keyboard.addListener("keyboardDidShow", () => {
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true })
      })
    })

    return () => {
      keyboardListener.remove()
    }
  }, [])

  const sendDraft = () => {
    const trimmedDraft = draft.trim()

    if (!trimmedDraft) return

    setEvents((currentEvents) => [
      ...currentEvents,
      {
        id: `draft-${Date.now()}`,
        dateLabel: "TODAY",
        message: trimmedDraft,
        storyMediaUrl: null,
        time: "Now",
      },
    ])
    setDraft("")
  }

  return (
    <ScreenFrame>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        <ChatHeader creator={creator} onBack={router.back} />

        <View style={styles.notificationBanner}>
          <Ionicons name="notifications-off-outline" size={18} color={colors.subtext} />
          <Text style={styles.notificationText} numberOfLines={1}>
            Don't miss Chats from {creator.name}!{" "}
            <Text style={styles.notificationLink}>Enable notifications</Text>
          </Text>
        </View>

        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.messageContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            scrollViewRef.current?.scrollToEnd({ animated: true })
          }}
          showsVerticalScrollIndicator={false}
        >
          {events.length > 0 ? (
            events.map((event, index) => {
              const shouldShowDate =
                index === 0 || event.dateLabel !== events[index - 1]?.dateLabel

              return (
                <View key={event.id}>
                  {shouldShowDate ? <DateSeparator label={event.dateLabel} /> : null}
                  <StoryReplyEvent creatorName={creator.name} event={event} />
                </View>
              )
            })
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="mail-open-outline" size={24} color={colors.faint} />
              <Text style={styles.emptyText}>No story replies in this chat yet.</Text>
            </View>
          )}
        </ScrollView>

        <ChatComposer
          autoFocus
          draft={draft}
          onChangeDraft={setDraft}
          onSend={sendDraft}
        />
      </KeyboardAvoidingView>
    </ScreenFrame>
  )
}

function buildEmptyThread(creatorId: string | undefined): MobileChatThread {
  const handle = creatorId || "creator"

  return {
    id: handle,
    name: handle.replace(/[._-]+/g, " "),
    handle,
    avatarUrl: null,
    hasStoryRing: false,
    isVerified: false,
    status: "opened",
    statusAge: "",
    unreadCount: 0,
    events: [],
  }
}

function ChatHeader({
  creator,
  onBack,
}: {
  creator: MobileChatThread
  onBack: () => void
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [
          styles.headerBackButton,
          pressed ? styles.pressed : null,
        ]}
      >
        <Ionicons name="chevron-back" size={30} color={colors.dark} />
      </Pressable>

      <View style={styles.headerAvatar}>
        {creator.avatarUrl ? (
          <Image source={{ uri: creator.avatarUrl }} style={styles.headerAvatarImage} />
        ) : (
          <Ionicons name="person" size={24} color="#541c79" />
        )}
      </View>

      <Text style={styles.headerName} numberOfLines={1}>
        {creator.name}
      </Text>
      {creator.isVerified ? <VerifiedBadge /> : null}
      <Pressable
        accessibilityLabel={`Send camera chat to ${creator.name}`}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.headerCameraButton,
          pressed ? styles.pressed : null,
        ]}
      >
        <Ionicons name="camera-outline" size={22} color={colors.subtext} />
      </Pressable>
    </View>
  )
}

function DateSeparator({
  label,
}: {
  label: ChatEvent["dateLabel"]
}) {
  return (
    <Text style={styles.dateSeparator} numberOfLines={1}>
      {label}
    </Text>
  )
}

function StoryReplyEvent({
  creatorName,
  event,
}: {
  creatorName: string
  event: ChatEvent
}) {
  const storyMediaUrl = event.storyMediaUrl
  const isReceived = event.direction === "received"

  if (storyMediaUrl === null) {
    return (
      <View style={styles.plainMessageRow}>
        <Text style={styles.plainMessage}>{event.message}</Text>
      </View>
    )
  }

  return (
    <View style={styles.replyEvent}>
      <View style={styles.replyAccent} />
      <View style={styles.replyMetaLine}>
        <Text style={[styles.replyMe, isReceived ? styles.replyThem : null]}>
          {isReceived ? creatorName : "Me"}
        </Text>
        <Ionicons
          name="return-up-back"
          size={18}
          color={colors.faint}
          style={styles.replyArrow}
        />
        <Text style={styles.replyMetaText} numberOfLines={1}>
          {isReceived ? "Replied to your Story" : `Replied to ${creatorName}'s Story`}
        </Text>
        <Text style={styles.replyTime}>{event.time}</Text>
      </View>

      <View style={styles.storyReplyBody}>
        <Image source={{ uri: storyMediaUrl }} style={styles.storyPreview} />
        <View
          style={[
            styles.messageBubble,
            isReceived ? styles.receivedMessageBubble : null,
          ]}
        >
          <Text style={styles.messageBubbleText}>{event.message}</Text>
        </View>
      </View>
    </View>
  )
}

function ChatComposer({
  autoFocus = false,
  draft,
  onChangeDraft,
  onSend,
}: {
  autoFocus?: boolean
  draft: string
  onChangeDraft: (value: string) => void
  onSend: () => void
}) {
  return (
    <View style={styles.composerWrap}>
      <Pressable
        accessibilityLabel="Open camera"
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.cameraComposerButton,
          pressed ? styles.pressed : null,
        ]}
      >
        <Ionicons name="camera" size={24} color={colors.surface} />
      </Pressable>

      <View style={styles.inputWrap}>
        <TextInput
          autoFocus={autoFocus}
          placeholder="Send a chat"
          placeholderTextColor="#a8aeba"
          returnKeyType="send"
          style={styles.composerInput}
          value={draft}
          onChangeText={onChangeDraft}
          onSubmitEditing={onSend}
        />
        {draft.trim() ? (
          <Pressable
            accessibilityLabel="Send chat"
            accessibilityRole="button"
            onPress={onSend}
            style={({ pressed }) => [
              styles.inlineSendButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons name="send" size={21} color={colors.surface} />
          </Pressable>
        ) : null}
      </View>

      <ComposerIcon accessibilityLabel="Open stickers" icon="happy-outline" />
      <ComposerIcon accessibilityLabel="Open memories" icon="images-outline" />
    </View>
  )
}

function ComposerIcon({
  accessibilityLabel,
  icon,
}: {
  accessibilityLabel: string
  icon: ComponentProps<typeof Ionicons>["name"]
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.composerIcon,
        pressed ? styles.pressed : null,
      ]}
    >
      <Ionicons name={icon} size={23} color={colors.subtext} />
    </Pressable>
  )
}

function VerifiedBadge() {
  return (
    <View style={styles.verifiedBadge}>
      <Ionicons name="checkmark" size={12} color={colors.surface} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
  },
  headerBackButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
    marginRight: 10,
  },
  headerAvatarImage: {
    width: "100%",
    height: "100%",
  },
  headerName: {
    flexShrink: 1,
    maxWidth: "58%",
    fontSize: 21,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.text,
  },
  verifiedBadge: {
    width: 19,
    height: 19,
    borderRadius: 9.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    marginLeft: 6,
  },
  headerCameraButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
    marginLeft: "auto",
  },
  notificationBanner: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
  },
  notificationText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.subtext,
  },
  notificationLink: {
    color: colors.accent,
  },
  messageContent: {
    paddingHorizontal: 14,
    paddingBottom: 18,
    paddingTop: 8,
  },
  dateSeparator: {
    marginTop: 10,
    marginBottom: 10,
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Inter_800ExtraBold",
    fontWeight: "800",
    letterSpacing: 1.4,
    color: colors.faint,
  },
  replyEvent: {
    position: "relative",
    marginBottom: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingBottom: 12,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 10,
  },
  replyAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderBottomLeftRadius: 8,
    borderTopLeftRadius: 8,
    backgroundColor: colors.accent,
  },
  replyMetaLine: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
  },
  replyMe: {
    marginRight: 4,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.accent,
  },
  replyThem: {
    color: "#242936",
  },
  replyArrow: {
    marginRight: 4,
  },
  replyMetaText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: colors.subtext,
  },
  replyTime: {
    marginLeft: 8,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: colors.faint,
  },
  storyReplyBody: {
    paddingLeft: 12,
    paddingTop: 8,
  },
  storyPreview: {
    width: 118,
    height: 184,
    borderRadius: 8,
    backgroundColor: "#e8ebef",
    position: "relative",
    zIndex: 1,
  },
  messageBubble: {
    alignSelf: "flex-start",
    maxWidth: "90%",
    marginTop: -28,
    marginLeft: 18,
    position: "relative",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    zIndex: 2,
  },
  receivedMessageBubble: {
    borderColor: colors.accentBubbleBorder,
    backgroundColor: colors.accentBubble,
  },
  messageBubbleText: {
    fontSize: 18,
    fontFamily: "Inter_400Regular",
    lineHeight: 24,
    fontWeight: "400",
    color: "#303846",
  },
  plainMessageRow: {
    alignItems: "flex-end",
    paddingVertical: 8,
  },
  plainMessage: {
    maxWidth: "78%",
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.surface,
  },
  composerWrap: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingLeft: 20,
    paddingRight: 14,
    paddingVertical: 8,
  },
  cameraComposerButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dark,
  },
  inputWrap: {
    flex: 1,
    minWidth: 0,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 23,
    backgroundColor: colors.mutedSurface,
    paddingLeft: 14,
    paddingRight: 4,
  },
  composerInput: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 0,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: colors.text,
  },
  inlineSendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  composerIcon: {
    width: 30,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyText: {
    textAlign: "center",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.subtext,
  },
  pressed: {
    opacity: 0.68,
  },
})
