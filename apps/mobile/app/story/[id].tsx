import Ionicons from "@expo/vector-icons/Ionicons"
import { StatusBar } from "expo-status-bar"
import { VideoView, useVideoPlayer } from "expo-video"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  Alert,
  Easing,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import type { DimensionValue } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useFollowState } from "@/lib/follow-state"
import { deleteMobileApi, getMobileApi, postMobileApi } from "@/lib/mobile-api"
import type { MobileStoryApiStack } from "@/lib/mobile-stories-api"

type MobileStoryStackItem = MobileStoryApiStack["items"][number]

type StoryPlaybackItem = MobileStoryStackItem & {
  playbackId: string
  durationMs: number
  segmentStartSeconds: number
  segmentIndex: number
  segmentCount: number
}

const PHOTO_DURATION_MS = 5_000
const VIDEO_SEGMENT_SECONDS = 10
const MIN_FINAL_VIDEO_SEGMENT_SECONDS = 2
const SWIPE_DOWN_DISMISS_DISTANCE = 86
const SWIPE_DOWN_DISMISS_VELOCITY = 1.05

const colors = {
  background: "#000000",
  text: "#ffffff",
  mutedText: "rgba(255,255,255,0.72)",
  outline: "rgba(255,255,255,0.34)",
  caption: "rgba(0,0,0,0.48)",
  brand: "#e01616",
  addText: "#ffffff",
}

export default function StoryScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [reply, setReply] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [remoteStory, setRemoteStory] = useState<MobileStoryApiStack | null>(null)
  const [storyRequestState, setStoryRequestState] = useState<
    "idle" | "loading" | "settled"
  >("idle")
  const [isItemMenuOpen, setIsItemMenuOpen] = useState(false)
  const [isDeletingStoryItem, setIsDeletingStoryItem] = useState(false)
  const [isSendingReply, setIsSendingReply] = useState(false)
  const activeProgress = useRef(new Animated.Value(0)).current
  const { isFollowing, toggleFollow } = useFollowState()
  const isOwnStoryRoute = id === "my-story"
  const story = id ? remoteStory ?? undefined : undefined
  const shouldShowAddButton = story
    ? story.id !== "my-story" && !isFollowing(story.creatorId)
    : false
  const isViewingOwnStory = story?.id === "my-story" || isOwnStoryRoute
  const playbackItems = useMemo(
    () => (story ? expandStoryItems(story.items) : []),
    [story],
  )
  const isWaitingForStory = Boolean(
    id && !story && storyRequestState !== "settled",
  )
  const activeItem = playbackItems[activeIndex]
  const captionTop = getCaptionTopPercent(activeItem)
  const avatarUrl = getStoryAvatarUrl(story)
  const swipeDownResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        const verticalDistance = Math.abs(gestureState.dy)
        const horizontalDistance = Math.abs(gestureState.dx)

        return (
          gestureState.dy > 18 &&
          verticalDistance > horizontalDistance * 1.25
        )
      },
      onPanResponderRelease: (_, gestureState) => {
        if (
          gestureState.dy > SWIPE_DOWN_DISMISS_DISTANCE ||
          gestureState.vy > SWIPE_DOWN_DISMISS_VELOCITY
        ) {
          router.replace("/")
        }
      },
    }),
  ).current
  const videoSource =
    activeItem?.assetKind === "video" ? activeItem.mediaUrl : null
  const videoPlayer = useVideoPlayer(videoSource, (player) => {
    player.loop = false
    player.muted = true
    player.audioMixingMode = "mixWithOthers"

    if (videoSource) {
      player.play()
    }
  })

  useEffect(() => {
    setActiveIndex(0)
    setReply("")
    setRemoteStory(null)
    setStoryRequestState(id ? "loading" : "settled")
    setIsItemMenuOpen(false)
  }, [id])

  useEffect(() => {
    let isMounted = true

    if (!id) {
      setStoryRequestState("settled")
      return
    }

    setStoryRequestState("loading")

    getMobileApi<{ ok: true; story: MobileStoryApiStack }>(
      `/api/mobile/stories/${encodeURIComponent(id)}`,
    )
      .then((payload) => {
        if (isMounted) {
          setRemoteStory(payload.story)
          setStoryRequestState("settled")
        }
      })
      .catch(() => {
        if (isMounted) {
          setRemoteStory(null)
          setStoryRequestState("settled")
        }
      })

    return () => {
      isMounted = false
    }
  }, [id])

  useEffect(() => {
    if (activeIndex >= playbackItems.length) {
      setActiveIndex(0)
    }
  }, [activeIndex, playbackItems.length])

  useEffect(() => {
    setIsItemMenuOpen(false)
  }, [activeIndex])

  useEffect(() => {
    if (activeItem?.assetKind === "video") {
      videoPlayer.currentTime = activeItem.segmentStartSeconds
      videoPlayer.play()
      return
    }

    videoPlayer.pause()
  }, [activeItem?.assetKind, activeItem?.id, videoPlayer])

  const goPrevious = () => {
    if (activeIndex > 0) {
      setActiveIndex((current) => current - 1)
      return
    }

    router.back()
  }

  const goNext = () => {
    if (activeIndex < playbackItems.length - 1) {
      setActiveIndex((current) => current + 1)
      return
    }

    router.back()
  }

  const deleteActiveStoryItem = async () => {
    if (!activeItem || !story || isDeletingStoryItem) {
      return
    }

    setIsItemMenuOpen(false)
    setIsDeletingStoryItem(true)

    try {
      await deleteMobileApi<{ ok: true }>(
        `/api/mobile/stories/${encodeURIComponent(activeItem.id)}`,
        {},
      )

      const remainingItems = story.items.filter((item) => item.id !== activeItem.id)

      if (remainingItems.length === 0) {
        router.replace("/")
        return
      }

      setRemoteStory({
                  id: story.id,
                  creatorId: story.creatorId,
                  creator: story.creator,
                  handle: story.handle,
        avatarUrl: getStoryAvatarUrl(story) ?? null,
        items: remainingItems,
      })
      setActiveIndex((current) => Math.min(current, remainingItems.length - 1))
    } catch (error) {
      Alert.alert(
        "Could not delete story",
        error instanceof Error ? error.message : "Try again in a moment.",
      )
    } finally {
      setIsDeletingStoryItem(false)
    }
  }

  const confirmDeleteActiveStoryItem = () => {
    if (!activeItem || isDeletingStoryItem) {
      return
    }

    Alert.alert(
      "Delete this story item?",
      "This removes the image or video from your active story immediately.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteActiveStoryItem()
          },
        },
      ],
    )
  }

  const sendStoryInteraction = async ({
    body,
    kind,
    reaction,
  }: {
    body?: string
    kind: "reply" | "reaction"
    reaction?: string
  }) => {
    if (!activeItem || isViewingOwnStory || isSendingReply) {
      return
    }

    const trimmedBody = body?.trim()

    if (kind === "reply" && !trimmedBody) {
      return
    }

    setIsSendingReply(true)

    try {
      await postMobileApi<{ ok: true }>(
        `/api/mobile/stories/${encodeURIComponent(activeItem.id)}/interactions`,
        {
          kind,
          body: trimmedBody,
          reaction,
        },
      )
      setReply("")
    } catch (error) {
      Alert.alert(
        "Could not send reply",
        error instanceof Error ? error.message : "Try again in a moment.",
      )
    } finally {
      setIsSendingReply(false)
    }
  }

  const sendReply = () => {
    void sendStoryInteraction({
      kind: "reply",
      body: reply,
    })
  }

  const sendReaction = (reaction: string) => {
    void sendStoryInteraction({
      kind: "reaction",
      reaction,
    })
  }

  useEffect(() => {
    if (!activeItem) return

    activeProgress.stopAnimation()
    activeProgress.setValue(0)
    const animation = Animated.timing(activeProgress, {
      toValue: 1,
      duration: activeItem.durationMs,
      easing: Easing.linear,
      useNativeDriver: false,
    })

    animation.start(({ finished }) => {
      if (finished) {
        goNext()
      }
    })

    return () => {
      animation.stop()
    }
  }, [
    activeItem?.playbackId,
    activeItem?.durationMs,
    activeIndex,
    playbackItems.length,
  ])

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar style="light" backgroundColor={colors.background} />
      <View style={styles.screen} {...swipeDownResponder.panHandlers}>
        <View style={styles.mediaFrame}>
          {activeItem?.assetKind === "video" ? (
            <VideoView
              player={videoPlayer}
              nativeControls={false}
              contentFit="cover"
              style={styles.media}
            />
          ) : activeItem?.mediaUrl ? (
            <Image source={{ uri: activeItem.mediaUrl }} style={styles.media} />
          ) : null}

          {isWaitingForStory ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color={colors.text} />
            </View>
          ) : null}

          {!isWaitingForStory && !story ? (
            <View style={styles.unavailableState}>
              <Text style={styles.unavailableTitle}>Story unavailable</Text>
            </View>
          ) : null}

          {story ? (
            <View style={styles.progressRow}>
              {playbackItems.map((item, index) => (
                <View key={item.playbackId} style={styles.progressTrack}>
                  <Animated.View
                    style={[
                      styles.progressFill,
                      {
                        width: getProgressWidth({
                          activeIndex,
                          activeProgress,
                          index,
                        }),
                      },
                    ]}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {story ? (
            <View style={styles.storyHeader}>
              <Pressable
                accessibilityLabel={`Open ${story.creator} profile`}
                accessibilityRole="button"
                onPress={() => {
                  router.push(`/creator/${story.creatorId}`)
                }}
                style={({ pressed }) => [
                  styles.identity,
                  pressed ? styles.pressed : null,
                ]}
              >
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarFallbackText}>
                      {initials(story.creator)}
                    </Text>
                  </View>
                )}
                <View style={styles.identityCopy}>
                  <View style={styles.nameRow}>
                    <Text style={styles.creatorName} numberOfLines={1}>
                      {story.creator}
                    </Text>
                    <View style={styles.verifiedBadge}>
                      <Ionicons name="star" size={11} color="#ffffff" />
                    </View>
                  </View>
                  <Text style={styles.postedAt} numberOfLines={1}>
                    {activeItem?.postedAt ?? "Today"}
                  </Text>
                </View>
              </Pressable>

              {isViewingOwnStory ? (
                <View style={styles.ownerActions}>
                  <Pressable
                    accessibilityLabel="More options for this story item"
                    accessibilityRole="button"
                    onPress={() => setIsItemMenuOpen((current) => !current)}
                    style={({ pressed }) => [
                      styles.ownerMenuButton,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Ionicons name="ellipsis-horizontal" size={30} color={colors.text} />
                  </Pressable>

                  {isItemMenuOpen ? (
                    <View style={styles.ownerMenu}>
                      <Pressable
                        accessibilityLabel="Delete this story item"
                        accessibilityRole="button"
                        disabled={isDeletingStoryItem}
                        onPress={confirmDeleteActiveStoryItem}
                        style={({ pressed }) => [
                          styles.ownerMenuItem,
                          pressed ? styles.pressed : null,
                        ]}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.brand} />
                        <Text style={styles.ownerMenuItemText}>
                          {isDeletingStoryItem ? "Deleting..." : "Delete"}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : shouldShowAddButton ? (
                <Pressable
                  accessibilityLabel={`Add ${story.creator}`}
                  accessibilityRole="button"
                  onPress={() => {
                    toggleFollow(story.creatorId)
                  }}
                  style={({ pressed }) => [
                    styles.addButton,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Ionicons name="add" size={24} color={colors.addText} />
                  <Text style={styles.addButtonText}>Add</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityLabel="Story notifications"
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.bellButton,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Ionicons name="notifications-outline" size={28} color={colors.text} />
                </Pressable>
              )}
            </View>
          ) : null}

          {story ? (
            <View style={styles.tapZones} pointerEvents="box-none">
              <Pressable
                accessibilityLabel="Previous story item"
                accessibilityRole="button"
                onPress={goPrevious}
                style={styles.tapZone}
              />
              <Pressable
                accessibilityLabel="Next story item"
                accessibilityRole="button"
                onPress={goNext}
                style={styles.tapZone}
              />
            </View>
          ) : null}

          {activeItem?.title ? (
            <View
              style={[
                styles.captionBar,
                { top: `${captionTop}%` as DimensionValue },
              ]}
            >
              <Text style={styles.captionText} numberOfLines={2}>
                {activeItem.title}
              </Text>
            </View>
          ) : null}

          {story ? (
            <View style={styles.sideActions}>
              <Pressable
                accessibilityLabel="Share story"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.sideAction,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="arrow-redo" size={52} color={colors.text} />
              </Pressable>
            </View>
          ) : null}
        </View>

        {story ? (
          <View style={styles.replyDock}>
            <View style={styles.replyComposer}>
              <TextInput
                value={reply}
                onChangeText={setReply}
                placeholder="Reply..."
                placeholderTextColor={colors.text}
                editable={!isViewingOwnStory && !isSendingReply}
                style={styles.replyInput}
                returnKeyType="send"
                onSubmitEditing={sendReply}
              />
              {reply.trim().length > 0 ? (
                <Pressable
                  accessibilityLabel="Send story reply"
                  accessibilityRole="button"
                  disabled={isSendingReply}
                  onPress={sendReply}
                  style={({ pressed }) => [
                    styles.sendReplyButton,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Ionicons name="arrow-up" size={24} color={colors.background} />
                </Pressable>
              ) : (
                <>
                  <Pressable
                    accessibilityLabel="Send heart reaction"
                    accessibilityRole="button"
                    disabled={isViewingOwnStory || isSendingReply}
                    onPress={() => sendReaction("💗")}
                    style={({ pressed }) => [
                      styles.reactionButton,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.reactionText}>💗</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Send laugh reaction"
                    accessibilityRole="button"
                    disabled={isViewingOwnStory || isSendingReply}
                    onPress={() => sendReaction("😂")}
                    style={({ pressed }) => [
                      styles.reactionButton,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.reactionText}>😂</Text>
                  </Pressable>
                </>
              )}
              <Pressable accessibilityRole="button" style={styles.reactionButton}>
                <Ionicons name="happy-outline" size={34} color={colors.text} />
                <View style={styles.plusDot}>
                  <Ionicons name="add" size={10} color={colors.background} />
                </View>
              </Pressable>
            </View>

            {!isViewingOwnStory ? (
              <Pressable
                accessibilityLabel="More story actions"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.moreButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="ellipsis-horizontal" size={34} color={colors.text} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

function getProgressWidth({
  activeIndex,
  activeProgress,
  index,
}: {
  activeIndex: number
  activeProgress: Animated.Value
  index: number
}) {
  if (index < activeIndex) return "100%"
  if (index > activeIndex) return "0%"

  return activeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  })
}

function getCaptionTopPercent(item: StoryPlaybackItem | undefined) {
  const requestedTop = item?.captionVerticalPercent ?? 74

  return Math.min(Math.max(requestedTop, 18), 82)
}

function expandStoryItems(items: MobileStoryStackItem[]): StoryPlaybackItem[] {
  return items.flatMap((item) => {
    if (item.assetKind === "image") {
      return [
        {
          ...item,
          playbackId: item.id,
          durationMs: PHOTO_DURATION_MS,
          segmentStartSeconds: 0,
          segmentIndex: 0,
          segmentCount: 1,
        },
      ]
    }

    const durationSeconds = Math.max(
      item.durationSeconds ?? VIDEO_SEGMENT_SECONDS,
      1,
    )
    const segmentStarts: number[] = []

    for (let start = 0; start < durationSeconds; start += VIDEO_SEGMENT_SECONDS) {
      const remainingSeconds = durationSeconds - start

      if (
        remainingSeconds < MIN_FINAL_VIDEO_SEGMENT_SECONDS &&
        segmentStarts.length > 0
      ) {
        break
      }

      segmentStarts.push(start)
    }

    return segmentStarts.map((segmentStartSeconds, index) => {
      const nextSegmentStart = segmentStarts[index + 1] ?? durationSeconds

      return {
        ...item,
        playbackId: `${item.id}-segment-${index + 1}`,
        durationMs: (nextSegmentStart - segmentStartSeconds) * 1_000,
        segmentStartSeconds,
        segmentIndex: index,
        segmentCount: segmentStarts.length,
      }
    })
  })
}

function getStoryAvatarUrl(
  story: MobileStoryApiStack | undefined,
) {
  if (!story) return undefined

  if (story.avatarUrl) {
    return story.avatarUrl
  }

  return story.items[0]?.thumbnailUrl ?? story.items[0]?.mediaUrl
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
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mediaFrame: {
    flex: 1,
    marginTop: 4,
    marginBottom: 18,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#111827",
  },
  media: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  loadingState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  unavailableState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  unavailableTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  progressRow: {
    position: "absolute",
    top: 14,
    left: 16,
    right: 16,
    zIndex: 5,
    flexDirection: "row",
    gap: 5,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.36)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.text,
  },
  storyHeader: {
    position: "absolute",
    top: 34,
    left: 16,
    right: 14,
    zIndex: 6,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  avatarFallbackText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  creatorName: {
    flexShrink: 1,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  verifiedBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
  },
  postedAt: {
    marginTop: 3,
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.mutedText,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bellButton: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  ownerActions: {
    position: "relative",
    zIndex: 10,
    alignItems: "flex-end",
  },
  ownerMenuButton: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  ownerMenu: {
    position: "absolute",
    right: 0,
    top: 48,
    minWidth: 148,
    overflow: "hidden",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(17,24,39,0.92)",
  },
  ownerMenuItem: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 13,
  },
  ownerMenuItemText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  addButton: {
    minWidth: 98,
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: colors.brand,
  },
  addButtonText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.addText,
  },
  tapZones: {
    position: "absolute",
    top: 94,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    flexDirection: "row",
  },
  tapZone: {
    flex: 1,
  },
  captionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 8,
    minHeight: 42,
    paddingHorizontal: 24,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.caption,
  },
  captionText: {
    maxWidth: "100%",
    fontSize: 18,
    fontFamily: "Inter_400Regular",
    lineHeight: 23,
    color: colors.text,
    textAlign: "center",
  },
  sideActions: {
    position: "absolute",
    right: 18,
    bottom: 28,
    zIndex: 6,
    alignItems: "center",
    gap: 16,
  },
  sideAction: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  replyDock: {
    minHeight: 86,
    paddingHorizontal: 12,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.background,
  },
  replyComposer: {
    flex: 1,
    minHeight: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: colors.outline,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 22,
    paddingRight: 14,
  },
  replyInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  reactionButton: {
    width: 36,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  sendReplyButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.text,
  },
  reactionText: {
    fontSize: 29,
  },
  plusDot: {
    position: "absolute",
    top: 2,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.text,
  },
  moreButton: {
    width: 64,
    height: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: colors.outline,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
})
