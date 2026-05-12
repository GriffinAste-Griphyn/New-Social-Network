import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import { AccountAvatarButton, ScreenFrame, ScreenScroll } from "@/components/social/ui"
import { useAuthFlow } from "@/lib/auth-flow"
import { getMobileApi } from "@/lib/mobile-api"

type CreatorStoryStats = {
  id: string
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  caption: string | null
  status: "processing" | "live" | "expired" | "removed"
  createdAt: string
  views: number
  uniqueViewers: number
  completedViews: number
  completionRate: number
  averageViewedSeconds: number
  comments: number
  replies: number
  earningsCents: number
}

type CreatorStatsResponse = {
  ok: true
  stats: {
    stories: CreatorStoryStats[]
  }
}

type StoryInteractionEvent = {
  id: string
  storyId: string
  actor: {
    id: string
    name: string
    handle: string
    imageUrl: string | null
  }
  kind: "reply" | "comment" | "reaction"
  body: string | null
  reaction: string | null
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
  dark: "#111827",
}

function formatNumber(value: number) {
  return Intl.NumberFormat("en", { notation: "compact" }).format(value)
}

function formatMoney(cents: number) {
  return Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function formatDate(value: string) {
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

  return interaction.reaction ? `Reacted ${interaction.reaction}` : "Sent a reaction."
}

function orderStoriesChronologically(stories: CreatorStoryStats[]) {
  return [...stories].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  )
}

export default function MyStoryStatsScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const { width } = useWindowDimensions()
  const listRef = useRef<FlatList<CreatorStoryStats>>(null)
  const [stories, setStories] = useState<CreatorStoryStats[]>([])
  const [interactions, setInteractions] = useState<StoryInteractionEvent[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cardWidth = Math.max(280, width - 48)
  const activeStory = stories[activeIndex] ?? null
  const activeReplies = activeStory
    ? interactions.filter((interaction) => interaction.storyId === activeStory.id)
    : []

  useEffect(() => {
    let isMounted = true

    if (!account?.mobileToken) {
      setStories([])
      setInteractions([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    Promise.all([
      getMobileApi<CreatorStatsResponse>("/api/mobile/creator/stats", {
        authToken: account.mobileToken,
      }),
      getMobileApi<StoryInteractionsResponse>(
        "/api/mobile/stories/my-story/interactions",
        { authToken: account.mobileToken },
      ),
    ])
      .then(([statsPayload, repliesPayload]) => {
        if (!isMounted) return
        const chronologicalStories = orderStoriesChronologically(
          statsPayload.stats.stories,
        )

        setStories(chronologicalStories)
        setInteractions(repliesPayload.interactions)
        setActiveIndex(Math.max(chronologicalStories.length - 1, 0))
        setError(null)
      })
      .catch((errorValue) => {
        if (!isMounted) return
        setError(
          errorValue instanceof Error
            ? errorValue.message
            : "Could not load story stats.",
        )
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

  const scrollToStory = (index: number) => {
    if (index < 0 || index >= stories.length) {
      return
    }

    setActiveIndex(index)
    listRef.current?.scrollToIndex({ animated: true, index })
  }

  return (
    <ScreenFrame>
      <ScreenScroll>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={router.back}
            style={({ pressed }) => [
              styles.backButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons name="chevron-back" size={23} color={colors.text} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Creator</Text>
            <Text style={styles.title}>My Story Stats</Text>
            <Text style={styles.subtitle}>@{account?.handle ?? "account"}</Text>
          </View>
          <AccountAvatarButton
            displayName={account?.displayName}
            email={account?.email}
            handle={account?.handle}
          />
        </View>

        {isLoading ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.stateText}>Loading story stats.</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.statePanel}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.faint} />
            <Text style={styles.stateTitle}>Stats unavailable</Text>
            <Text style={styles.stateText}>{error}</Text>
          </View>
        ) : null}

        {!isLoading && !error && stories.length === 0 ? (
          <View style={styles.statePanel}>
            <Ionicons name="images-outline" size={24} color={colors.faint} />
            <Text style={styles.stateTitle}>No stories yet</Text>
            <Text style={styles.stateText}>
              Post a story and its individual stats will appear here.
            </Text>
          </View>
        ) : null}

        {stories.length > 0 ? (
          <>
            <FlatList
              ref={listRef}
              data={stories}
              horizontal
              keyExtractor={(story) => story.id}
              pagingEnabled
              decelerationRate="fast"
              snapToInterval={cardWidth + 12}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carouselContent}
              initialScrollIndex={Math.max(stories.length - 1, 0)}
              getItemLayout={(_, index) => ({
                length: cardWidth + 12,
                offset: (cardWidth + 12) * index,
                index,
              })}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.round(
                  event.nativeEvent.contentOffset.x / (cardWidth + 12),
                )
                setActiveIndex(Math.min(Math.max(nextIndex, 0), stories.length - 1))
              }}
              renderItem={({ item, index }) => (
                <StoryCarouselCard
                  isActive={index === activeIndex}
                  story={item}
                  width={cardWidth}
                />
              )}
            />

            <View style={styles.carouselControls}>
              <Pressable
                accessibilityLabel="Previous story"
                accessibilityRole="button"
                disabled={activeIndex === 0}
                onPress={() => scrollToStory(activeIndex - 1)}
                style={({ pressed }) => [
                  styles.controlButton,
                  activeIndex === 0 ? styles.controlButtonDisabled : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="chevron-back" size={18} color={colors.text} />
                <Text style={styles.controlButtonText}>Previous</Text>
              </Pressable>
              <Text style={styles.positionText}>
                {activeIndex + 1}/{stories.length}
              </Text>
              <Pressable
                accessibilityLabel="Next story"
                accessibilityRole="button"
                disabled={activeIndex === stories.length - 1}
                onPress={() => scrollToStory(activeIndex + 1)}
                style={({ pressed }) => [
                  styles.controlButton,
                  activeIndex === stories.length - 1
                    ? styles.controlButtonDisabled
                    : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.controlButtonText}>Next</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.text} />
              </Pressable>
            </View>

            {activeStory ? (
              <>
                <View style={styles.statsPanel}>
                  <View style={styles.panelHeader}>
                    <View>
                      <Text style={styles.panelTitle}>Individual stats</Text>
                      <Text style={styles.panelSubtext}>
                        {activeStory.status} · {formatDate(activeStory.createdAt)}
                      </Text>
                    </View>
                    <View style={styles.statusPill}>
                      <Text style={styles.statusPillText}>{activeStory.assetKind}</Text>
                    </View>
                  </View>

                  <View style={styles.metricGrid}>
                    <MetricCard
                      icon="eye-outline"
                      label="Views"
                      value={formatNumber(activeStory.views)}
                      detail={`${formatNumber(activeStory.uniqueViewers)} unique`}
                    />
                    <MetricCard
                      icon="analytics-outline"
                      label="Completion"
                      value={`${activeStory.completionRate}%`}
                      detail={`${formatNumber(activeStory.completedViews)} complete`}
                    />
                    <MetricCard
                      icon="time-outline"
                      label="Avg. watch"
                      value={`${activeStory.averageViewedSeconds}s`}
                      detail="Per view"
                    />
                    <MetricCard
                      icon="chatbubble-ellipses-outline"
                      label="Replies"
                      value={formatNumber(activeStory.replies)}
                      detail={`${formatNumber(activeStory.comments)} comments`}
                    />
                    <MetricCard
                      icon="wallet-outline"
                      label="Earnings"
                      value={formatMoney(activeStory.earningsCents)}
                      detail="Story total"
                    />
                  </View>
                </View>

                <View style={styles.repliesPanel}>
                  <View style={styles.panelHeader}>
                    <View>
                      <Text style={styles.panelTitle}>Replies and comments</Text>
                      <Text style={styles.panelSubtext}>
                        {activeReplies.length} on this story
                      </Text>
                    </View>
                  </View>

                  {activeReplies.length > 0 ? (
                    <View style={styles.replyList}>
                      {activeReplies.map((interaction) => (
                        <ReplyRow key={interaction.id} interaction={interaction} />
                      ))}
                    </View>
                  ) : (
                    <View style={styles.emptyReplies}>
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={23}
                        color={colors.faint}
                      />
                      <Text style={styles.emptyRepliesTitle}>No replies yet</Text>
                      <Text style={styles.emptyRepliesText}>
                        Replies, comments, and media responses for this story will
                        appear here.
                      </Text>
                    </View>
                  )}
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </ScreenScroll>
    </ScreenFrame>
  )
}

function StoryCarouselCard({
  isActive,
  story,
  width,
}: {
  isActive: boolean
  story: CreatorStoryStats
  width: number
}) {
  const imageUrl = story.thumbnailUrl ?? story.mediaUrl

  return (
    <View style={[styles.storyCard, { width }, isActive ? styles.storyCardActive : null]}>
      <View style={styles.storyMedia}>
        {story.assetKind === "video" && story.thumbnailUrl === null ? (
          <View style={styles.videoFallback}>
            <Ionicons name="play" size={34} color="#ffffff" />
          </View>
        ) : (
          <Image source={{ uri: imageUrl }} style={styles.storyImage} />
        )}
        <View style={styles.storyMediaOverlay} />
        <View style={styles.storyCardHeader}>
          <View style={styles.storyStatusBadge}>
            <Text style={styles.storyStatusBadgeText}>{story.status}</Text>
          </View>
          {story.assetKind === "video" ? (
            <View style={styles.videoBadge}>
              <Ionicons name="play" size={13} color="#ffffff" />
            </View>
          ) : null}
        </View>
        <View style={styles.storyCardFooter}>
          <Text style={styles.storyTitle} numberOfLines={2}>
            {story.caption || "Untitled story"}
          </Text>
          <Text style={styles.storyDate}>{formatDate(story.createdAt)}</Text>
        </View>
      </View>
    </View>
  )
}

function MetricCard({
  detail,
  icon,
  label,
  value,
}: {
  detail: string
  icon: ComponentProps<typeof Ionicons>["name"]
  label: string
  value: string
}) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Ionicons name={icon} size={16} color={colors.subtext} />
      </View>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  )
}

function ReplyRow({
  interaction,
}: {
  interaction: StoryInteractionEvent
}) {
  return (
    <View style={styles.replyRow}>
      <View style={styles.replyAvatar}>
        {interaction.actor.imageUrl ? (
          <Image source={{ uri: interaction.actor.imageUrl }} style={styles.replyAvatarImage} />
        ) : (
          <Text style={styles.replyAvatarText}>{initials(interaction.actor.name)}</Text>
        )}
      </View>
      <View style={styles.replyBody}>
        <View style={styles.replyMeta}>
          <Text style={styles.replyName} numberOfLines={1}>
            {interaction.actor.name}
          </Text>
          <Text style={styles.replyDate}>{formatDate(interaction.createdAt)}</Text>
        </View>
        <Text style={styles.replyHandle} numberOfLines={1}>
          @{interaction.actor.handle}
        </Text>
        <Text style={styles.replyText} numberOfLines={3}>
          {getReplyPreview(interaction)}
        </Text>
        {interaction.mediaThumbnailUrl ?? interaction.mediaUrl ? (
          <Image
            source={{ uri: interaction.mediaThumbnailUrl ?? interaction.mediaUrl ?? "" }}
            style={styles.replyMedia}
          />
        ) : null}
      </View>
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
    fontSize: 29,
    fontWeight: "800",
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "600",
    color: colors.subtext,
  },
  statePanel: {
    minHeight: 160,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 18,
    backgroundColor: colors.surface,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
  },
  stateText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center",
    color: colors.subtext,
  },
  carouselContent: {
    gap: 12,
    paddingRight: 24,
  },
  storyCard: {
    opacity: 0.74,
  },
  storyCardActive: {
    opacity: 1,
  },
  storyMedia: {
    height: 430,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.dark,
  },
  storyImage: {
    width: "100%",
    height: "100%",
  },
  videoFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dark,
  },
  storyMediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  storyCardHeader: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  storyStatusBadge: {
    minHeight: 30,
    borderRadius: 15,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 10,
  },
  storyStatusBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#ffffff",
    textTransform: "uppercase",
  },
  videoBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  storyCardFooter: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
  },
  storyTitle: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "800",
    color: "#ffffff",
  },
  storyDate: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(255,255,255,0.72)",
  },
  carouselControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  controlButton: {
    minHeight: 40,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
  },
  controlButtonDisabled: {
    opacity: 0.4,
  },
  controlButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
  },
  positionText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.subtext,
  },
  statsPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
  },
  repliesPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
  },
  panelHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  panelTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  panelSubtext: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: colors.subtext,
  },
  statusPill: {
    minHeight: 28,
    borderRadius: 14,
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
    paddingHorizontal: 10,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.subtext,
    textTransform: "uppercase",
  },
  metricGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metricCard: {
    width: "48.5%",
    minHeight: 106,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    padding: 11,
  },
  metricHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.subtext,
    textTransform: "uppercase",
  },
  metricValue: {
    marginTop: 13,
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
  },
  metricDetail: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: colors.subtext,
  },
  replyList: {
    marginTop: 10,
    gap: 10,
  },
  replyRow: {
    minHeight: 82,
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.mutedSurface,
    padding: 10,
  },
  replyAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dark,
  },
  replyAvatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  replyAvatarText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.surface,
  },
  replyBody: {
    flex: 1,
    minWidth: 0,
  },
  replyMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  replyName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  replyDate: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.faint,
  },
  replyHandle: {
    marginTop: 1,
    fontSize: 12,
    fontWeight: "600",
    color: colors.subtext,
  },
  replyText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: colors.text,
  },
  replyMedia: {
    marginTop: 8,
    width: 82,
    height: 82,
    borderRadius: 8,
    backgroundColor: colors.dark,
  },
  emptyReplies: {
    minHeight: 150,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.mutedSurface,
    padding: 18,
    marginTop: 10,
  },
  emptyRepliesTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  emptyRepliesText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    textAlign: "center",
    color: colors.subtext,
  },
  pressed: {
    opacity: 0.72,
  },
})
