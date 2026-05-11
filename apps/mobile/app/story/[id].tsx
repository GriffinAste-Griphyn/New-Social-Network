import Ionicons from "@expo/vector-icons/Ionicons"
import * as Clipboard from "expo-clipboard"
import * as ImagePicker from "expo-image-picker"
import * as Linking from "expo-linking"
import { StatusBar } from "expo-status-bar"
import { VideoView, useVideoPlayer } from "expo-video"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  Alert,
  Easing,
  Image,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import type { DimensionValue } from "react-native"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"

import {
  getCreatorNotificationsEnabled,
  setCreatorNotificationsEnabled,
} from "@/lib/creator-notifications"
import { useFollowState } from "@/lib/follow-state"
import {
  deleteMobileApi,
  getMobileApi,
  postMobileApi,
  postMobileFormApi,
} from "@/lib/mobile-api"
import type { MobileStoryApiStack } from "@/lib/mobile-stories-api"

type MobileStoryStackItem = MobileStoryApiStack["items"][number]

type StoryPlaybackItem = MobileStoryStackItem & {
  playbackId: string
  durationMs: number
  segmentStartSeconds: number
  segmentIndex: number
  segmentCount: number
}

type ReplyMediaAsset = {
  uri: string
  assetKind: "image" | "video"
  mimeType: string
  fileName: string
}

type StoryReportReason =
  | "nudity"
  | "profanity"
  | "harassment"
  | "bullying"
  | "hate"
  | "violence"
  | "self_harm"
  | "scam"
  | "spam"
  | "false_information"
  | "illegal_goods"
  | "child_safety"
  | "intellectual_property"
  | "other"

const PHOTO_DURATION_MS = 5_000
const VIDEO_SEGMENT_SECONDS = 10
const MIN_FINAL_VIDEO_SEGMENT_SECONDS = 2
const SWIPE_DOWN_DISMISS_DISTANCE = 86
const SWIPE_DOWN_DISMISS_VELOCITY = 1.05
const replyEmojiOptions = ["😂", "😍", "🔥", "👏", "😭", "😮", "💗", "🙏"]

const reportReasonOptions: Array<{
  id: StoryReportReason
  icon: keyof typeof Ionicons.glyphMap
  label: string
  detail: string
}> = [
  {
    id: "nudity",
    icon: "body-outline",
    label: "Nudity or sexual activity",
    detail: "Nudity, sexual acts, or sexually explicit content.",
  },
  {
    id: "profanity",
    icon: "chatbubble-ellipses-outline",
    label: "Profanity or abusive language",
    detail: "Slurs, graphic insults, or hostile language.",
  },
  {
    id: "harassment",
    icon: "person-remove-outline",
    label: "Harassment",
    detail: "Targeted abuse, threats, or unwanted contact.",
  },
  {
    id: "bullying",
    icon: "sad-outline",
    label: "Bullying",
    detail: "Mocking, humiliation, or repeated intimidation.",
  },
  {
    id: "hate",
    icon: "alert-circle-outline",
    label: "Hate speech",
    detail: "Attacks based on identity or protected traits.",
  },
  {
    id: "violence",
    icon: "warning-outline",
    label: "Violence or threats",
    detail: "Threats, graphic violence, or calls to harm.",
  },
  {
    id: "self_harm",
    icon: "heart-dislike-outline",
    label: "Self-harm or suicide",
    detail: "Content encouraging or showing self-harm.",
  },
  {
    id: "scam",
    icon: "card-outline",
    label: "Scam or fraud",
    detail: "Fake giveaways, phishing, or deceptive money requests.",
  },
  {
    id: "spam",
    icon: "mail-unread-outline",
    label: "Spam",
    detail: "Repetitive, irrelevant, or engagement-bait content.",
  },
  {
    id: "false_information",
    icon: "newspaper-outline",
    label: "False information",
    detail: "Misleading claims that could cause harm.",
  },
  {
    id: "illegal_goods",
    icon: "ban-outline",
    label: "Illegal or regulated goods",
    detail: "Drugs, weapons, counterfeit goods, or restricted sales.",
  },
  {
    id: "child_safety",
    icon: "shield-checkmark-outline",
    label: "Child safety",
    detail: "Content that may exploit or endanger minors.",
  },
  {
    id: "intellectual_property",
    icon: "document-text-outline",
    label: "Intellectual property",
    detail: "Copyright, trademark, or impersonation concerns.",
  },
  {
    id: "other",
    icon: "ellipsis-horizontal-circle-outline",
    label: "Something else",
    detail: "Another issue not listed here.",
  },
]

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
  const safeAreaInsets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [reply, setReply] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [remoteStory, setRemoteStory] = useState<MobileStoryApiStack | null>(null)
  const [storyRequestState, setStoryRequestState] = useState<
    "idle" | "loading" | "settled"
  >("idle")
  const [isItemMenuOpen, setIsItemMenuOpen] = useState(false)
  const [isViewerActionsOpen, setIsViewerActionsOpen] = useState(false)
  const [isReportReasonMenuOpen, setIsReportReasonMenuOpen] = useState(false)
  const [isDeletingStoryItem, setIsDeletingStoryItem] = useState(false)
  const [isReportingStory, setIsReportingStory] = useState(false)
  const [reportingReason, setReportingReason] = useState<StoryReportReason | null>(null)
  const [isBlockingCreator, setIsBlockingCreator] = useState(false)
  const [isSendingReply, setIsSendingReply] = useState(false)
  const [isReplyMode, setIsReplyMode] = useState(false)
  const [replySentMessage, setReplySentMessage] = useState<string | null>(null)
  const [areCreatorNotificationsEnabled, setAreCreatorNotificationsEnabled] =
    useState(false)
  const [isUpdatingNotifications, setIsUpdatingNotifications] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [isEmojiTrayOpen, setIsEmojiTrayOpen] = useState(false)
  const [loadedImageUrls, setLoadedImageUrls] = useState<Set<string>>(
    () => new Set(),
  )
  const replyInputRef = useRef<TextInput>(null)
  const activeImpressionRef = useRef<{
    storyItemId: string
    segmentStartedAt: number
    segmentStartMs: number
    maxViewedMs: number
  } | null>(null)
  const reportedImpressionIdsRef = useRef(new Set<string>())
  const activeProgress = useRef(new Animated.Value(0)).current
  const activeProgressValueRef = useRef(0)
  const activeProgressPlaybackIdRef = useRef<string | null>(null)
  const { isFollowing, toggleFollow } = useFollowState()
  const isOwnStoryRoute = id === "my-story"
  const story = id ? remoteStory ?? undefined : undefined
  const isViewingOwnStory = story?.id === "my-story" || isOwnStoryRoute
  const isFollowingCreator = story ? isFollowing(story.creatorId) : false
  const shouldShowAddButton = story
    ? !isViewingOwnStory && !isFollowingCreator
    : false
  const canRespondToStory = Boolean(
    story && !isViewingOwnStory && isFollowingCreator,
  )
  const playbackItems = useMemo(
    () => (story ? expandStoryItems(story.items) : []),
    [story],
  )
  const isWaitingForStory = Boolean(
    id && !story && storyRequestState !== "settled",
  )
  const activeItem = playbackItems[activeIndex]
  const isActiveImageLoading = Boolean(
    !isReplyMode &&
      activeItem?.assetKind === "image" &&
      activeItem.mediaUrl &&
      !loadedImageUrls.has(activeItem.mediaUrl),
  )
  const captionTop = getCaptionTopPercent(activeItem)
  const avatarUrl = getStoryAvatarUrl(story)
  const creatorFirstName = getFirstName(story?.creator)
  const replyComposerBottom = Math.max(0, keyboardHeight - safeAreaInsets.bottom)
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
  const markImageLoaded = useCallback((mediaUrl: string) => {
    setLoadedImageUrls((current) => {
      if (current.has(mediaUrl)) {
        return current
      }

      const next = new Set(current)
      next.add(mediaUrl)
      return next
    })
  }, [])

  useEffect(() => {
    setActiveIndex(0)
    setReply("")
    setRemoteStory(null)
    setStoryRequestState(id ? "loading" : "settled")
    setIsItemMenuOpen(false)
    setIsViewerActionsOpen(false)
    setIsReportReasonMenuOpen(false)
    setReportingReason(null)
    setIsReplyMode(false)
    setReplySentMessage(null)
    setKeyboardHeight(0)
    setIsEmojiTrayOpen(false)
    setLoadedImageUrls(new Set())
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
    setIsViewerActionsOpen(false)
    setIsReportReasonMenuOpen(false)
    setReportingReason(null)
  }, [activeIndex])

  useEffect(() => {
    let isMounted = true
    const imageUrls = Array.from(
      new Set(
        playbackItems
          .filter((item) => item.assetKind === "image" && item.mediaUrl)
          .map((item) => item.mediaUrl),
      ),
    )

    imageUrls.forEach((mediaUrl) => {
      Image.prefetch(mediaUrl)
        .catch(() => undefined)
        .finally(() => {
          if (isMounted) {
            markImageLoaded(mediaUrl)
          }
        })
    })

    return () => {
      isMounted = false
    }
  }, [markImageLoaded, playbackItems])

  useEffect(() => {
    if (!isReplyMode) {
      return
    }

    const focusTimer = setTimeout(() => {
      replyInputRef.current?.focus()
    }, 90)

    return () => {
      clearTimeout(focusTimer)
    }
  }, [isReplyMode])

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide"

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height)
    })
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0)
    })

    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [])

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
    media,
    reaction,
  }: {
    body?: string
    kind: "reply" | "reaction"
    media?: ReplyMediaAsset
    reaction?: string
  }) => {
    if (!activeItem || !canRespondToStory || isSendingReply) {
      return
    }

    const trimmedBody = body?.trim()

    if (kind === "reply" && !trimmedBody && !media) {
      return
    }

    setIsSendingReply(true)

    try {
      if (media) {
        const formData = new FormData()

        formData.append("kind", kind)
        formData.append("body", trimmedBody ?? "")
        if (reaction) {
          formData.append("reaction", reaction)
        }
        formData.append("media", {
          uri: media.uri,
          name: media.fileName,
          type: media.mimeType,
        } as unknown as Blob)

        await postMobileFormApi<{ ok: true }>(
          `/api/mobile/stories/${encodeURIComponent(activeItem.id)}/interactions`,
          formData,
        )
      } else {
        await postMobileApi<{ ok: true }>(
          `/api/mobile/stories/${encodeURIComponent(activeItem.id)}/interactions`,
          {
            kind,
            body: trimmedBody,
            reaction,
          },
        )
      }
      setReply("")
      setIsReplyMode(false)
      setReplySentMessage(kind === "reaction" ? "Reaction sent" : "Reply sent")
      setKeyboardHeight(0)
      setIsEmojiTrayOpen(false)
      Keyboard.dismiss()
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

  const sendMediaReply = (media: ReplyMediaAsset) => {
    void sendStoryInteraction({
      kind: "reply",
      body: reply,
      media,
    })
  }

  const copyStoryLink = async () => {
    if (!story) {
      return
    }

    const storyLink = Linking.createURL(`/story/${story.id}`)

    try {
      await Clipboard.setStringAsync(storyLink)
      Alert.alert("Link copied", "The story link was copied to your clipboard.")
    } catch (error) {
      Alert.alert(
        "Could not copy link",
        error instanceof Error ? error.message : "Try again in a moment.",
      )
    }
  }

  const reportActiveStory = async (reason: StoryReportReason) => {
    if (!activeItem || isReportingStory) {
      return
    }

    setIsReportingStory(true)
    setReportingReason(reason)

    try {
      await postMobileApi<{ ok: true }>(
        `/api/mobile/stories/${encodeURIComponent(activeItem.id)}/report`,
        { reason },
      )
      setIsViewerActionsOpen(false)
      setIsReportReasonMenuOpen(false)
      Alert.alert("Report sent", "This story was sent to moderation.")
    } catch (error) {
      Alert.alert(
        "Could not report story",
        error instanceof Error ? error.message : "Try again in a moment.",
      )
    } finally {
      setIsReportingStory(false)
      setReportingReason(null)
    }
  }

  const chooseReportReason = () => {
    if (!activeItem || isReportingStory) {
      return
    }

    setIsViewerActionsOpen(false)
    setIsReportReasonMenuOpen(true)
  }

  const blockStoryCreator = async () => {
    if (!story || isBlockingCreator) {
      return
    }

    setIsBlockingCreator(true)

    try {
      await postMobileApi<{ ok: true }>("/api/mobile/blocks", {
        blockedUserId: story.creatorId,
      })
      setIsViewerActionsOpen(false)
      setIsReportReasonMenuOpen(false)
      Alert.alert("User blocked", `${story.creator} will no longer appear in your feed.`)
      router.replace("/")
    } catch (error) {
      Alert.alert(
        "Could not block user",
        error instanceof Error ? error.message : "Try again in a moment.",
      )
    } finally {
      setIsBlockingCreator(false)
    }
  }

  const confirmBlockStoryCreator = () => {
    if (!story || isBlockingCreator) {
      return
    }

    Alert.alert(
      `Block ${story.creator}?`,
      "You will stop seeing each other's stories, follows, replies, and notifications.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => void blockStoryCreator(),
        },
      ],
    )
  }

  const openReplyMode = () => {
    if (!canRespondToStory || isSendingReply) {
      return
    }

    setReplySentMessage(null)
    setIsReplyMode(true)
  }

  const closeReplyMode = () => {
    Keyboard.dismiss()
    setIsReplyMode(false)
    setKeyboardHeight(0)
    setIsEmojiTrayOpen(false)
  }

  useEffect(() => {
    if (!isReplyMode || canRespondToStory) {
      return
    }

    setReply("")
    setIsReplyMode(false)
    setKeyboardHeight(0)
    setIsEmojiTrayOpen(false)
    Keyboard.dismiss()
  }, [canRespondToStory, isReplyMode])

  const appendEmoji = (emoji: string) => {
    setReply((current) => `${current}${emoji}`)
    requestAnimationFrame(() => {
      replyInputRef.current?.focus()
    })
  }

  const openPhotoLibraryReply = async () => {
    if (!canRespondToStory || isSendingReply) {
      return
    }

    setIsEmojiTrayOpen(false)

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      Alert.alert(
        "Photo library access needed",
        "Allow photo library access to send a photo or video reply.",
      )
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      mediaTypes: ["images", "videos"],
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 0.82,
    })

    if (!result.canceled) {
      sendMediaReply(toReplyMediaAsset(result.assets[0]))
    }
  }

  useEffect(() => {
    let isMounted = true

    if (!story || isViewingOwnStory || shouldShowAddButton) {
      setAreCreatorNotificationsEnabled(false)
      return
    }

    getCreatorNotificationsEnabled(story.creatorId)
      .then((enabled) => {
        if (isMounted) {
          setAreCreatorNotificationsEnabled(enabled)
        }
      })
      .catch(() => {
        if (isMounted) {
          setAreCreatorNotificationsEnabled(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [isViewingOwnStory, shouldShowAddButton, story?.creatorId])

  const toggleCreatorNotifications = async () => {
    if (!story || isUpdatingNotifications) {
      return
    }

    const nextEnabled = !areCreatorNotificationsEnabled

    setIsUpdatingNotifications(true)

    try {
      const enabled = await setCreatorNotificationsEnabled({
        creatorId: story.creatorId,
        enabled: nextEnabled,
      })

      setAreCreatorNotificationsEnabled(enabled)
      Alert.alert(
        enabled ? "Notifications on" : "Notifications off",
        enabled
          ? `You will be notified when ${story.creator} posts a story.`
          : `You will no longer be notified when ${story.creator} posts.`,
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

  const flushActiveImpression = (completed: boolean) => {
    const impression = activeImpressionRef.current

    if (!impression || reportedImpressionIdsRef.current.has(impression.storyItemId)) {
      return
    }

    const viewedMs = Math.max(
      impression.maxViewedMs,
      impression.segmentStartMs + Date.now() - impression.segmentStartedAt,
    )

    activeImpressionRef.current = null
    reportedImpressionIdsRef.current.add(impression.storyItemId)

    void postMobileApi<{ ok: true }>(
      `/api/mobile/stories/${encodeURIComponent(impression.storyItemId)}/impressions`,
      {
        viewedMs,
        completed,
      },
    ).catch(() => undefined)
  }

  useEffect(() => {
    if (!activeItem || isViewingOwnStory) {
      flushActiveImpression(false)
      return
    }

    const current = activeImpressionRef.current
    const now = Date.now()

    if (current && current.storyItemId !== activeItem.id) {
      flushActiveImpression(false)
    } else if (current) {
      current.maxViewedMs = Math.max(
        current.maxViewedMs,
        current.segmentStartMs + now - current.segmentStartedAt,
      )
      current.segmentStartedAt = now
      current.segmentStartMs = activeItem.segmentStartSeconds * 1_000
    }

    if (
      !activeImpressionRef.current &&
      !reportedImpressionIdsRef.current.has(activeItem.id)
    ) {
      activeImpressionRef.current = {
        storyItemId: activeItem.id,
        segmentStartedAt: now,
        segmentStartMs: activeItem.segmentStartSeconds * 1_000,
        maxViewedMs: activeItem.segmentStartSeconds * 1_000,
      }
    }

    if (activeItem.segmentIndex !== activeItem.segmentCount - 1) {
      return
    }

    const completionTimer = setTimeout(() => {
      flushActiveImpression(true)
    }, Math.max(750, activeItem.durationMs - 250))

    return () => {
      clearTimeout(completionTimer)
    }
  }, [
    activeItem?.id,
    activeItem?.playbackId,
    activeItem?.durationMs,
    activeItem?.segmentIndex,
    activeItem?.segmentCount,
    activeItem?.segmentStartSeconds,
    isViewingOwnStory,
  ])

  useEffect(() => {
    return () => {
      flushActiveImpression(false)
    }
  }, [])

  useEffect(() => {
    const listenerId = activeProgress.addListener(({ value }) => {
      activeProgressValueRef.current = value
    })

    return () => {
      activeProgress.removeListener(listenerId)
    }
  }, [activeProgress])

  useEffect(() => {
    if (!replySentMessage) {
      return
    }

    const confirmationTimer = setTimeout(() => {
      setReplySentMessage(null)
    }, 1800)

    return () => {
      clearTimeout(confirmationTimer)
    }
  }, [replySentMessage])

  useEffect(() => {
    if (!activeItem) return
    if (activeProgressPlaybackIdRef.current !== activeItem.playbackId) {
      activeProgressPlaybackIdRef.current = activeItem.playbackId
      activeProgressValueRef.current = 0
      activeProgress.stopAnimation()
      activeProgress.setValue(0)
    }

    if (isReplyMode || isActiveImageLoading) {
      activeProgress.stopAnimation()
      return
    }

    activeProgress.stopAnimation()
    const startProgress = Math.min(Math.max(activeProgressValueRef.current, 0), 1)
    activeProgress.setValue(startProgress)
    const animation = Animated.timing(activeProgress, {
      toValue: 1,
      duration: Math.max(1, activeItem.durationMs * (1 - startProgress)),
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
    isActiveImageLoading,
    isReplyMode,
    playbackItems.length,
  ])

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar style="light" backgroundColor={colors.background} />
      <View style={styles.screen} {...swipeDownResponder.panHandlers}>
        <View
          style={[
            styles.mediaFrame,
            isReplyMode ? styles.mediaFrameReplyMode : null,
          ]}
        >
          {activeItem?.assetKind === "video" ? (
            <VideoView
              player={videoPlayer}
              nativeControls={false}
              contentFit="cover"
              style={styles.media}
            />
          ) : activeItem?.mediaUrl ? (
            <Image
              key={activeItem.playbackId}
              onLoadEnd={() => {
                markImageLoaded(activeItem.mediaUrl)
              }}
              source={{ uri: activeItem.mediaUrl }}
              style={styles.media}
            />
          ) : null}

          {isActiveImageLoading ? (
            <View style={styles.mediaLoadingState}>
              <ActivityIndicator size="small" color={colors.text} />
            </View>
          ) : null}

          {replySentMessage ? (
            <View pointerEvents="none" style={styles.replySentToast}>
              <Ionicons name="checkmark-circle" size={18} color={colors.text} />
              <Text style={styles.replySentToastText}>{replySentMessage}</Text>
            </View>
          ) : null}

          {story && !isReplyMode ? (
            <View pointerEvents="none" style={styles.mediaOverlay} />
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

          {story && !isReplyMode ? (
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

          {story && !isReplyMode ? (
            <View
              pointerEvents="auto"
              style={styles.storyHeader}
            >
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
              ) : (
                <View style={styles.viewerActionCluster}>
                  {shouldShowAddButton ? (
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
                      <Ionicons name="add" size={20} color={colors.addText} />
                      <Text style={styles.addButtonText}>Add</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityLabel={
                        areCreatorNotificationsEnabled
                          ? `Turn off notifications for ${story.creator}`
                          : `Turn on notifications for ${story.creator}`
                      }
                      accessibilityRole="button"
                      disabled={isUpdatingNotifications}
                      onPress={toggleCreatorNotifications}
                      style={({ pressed }) => [
                        styles.bellButton,
                        areCreatorNotificationsEnabled
                          ? styles.bellButtonActive
                          : null,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <Ionicons
                        name={
                          areCreatorNotificationsEnabled
                            ? "notifications"
                            : "notifications-outline"
                        }
                        size={23}
                        color={colors.text}
                      />
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityLabel="More story actions"
                    accessibilityRole="button"
                    onPress={() => setIsViewerActionsOpen((current) => !current)}
                    style={({ pressed }) => [
                      styles.viewerMenuButton,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={28}
                      color={colors.text}
                    />
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}

          {story && !isReplyMode ? (
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

          {!isReplyMode && activeItem?.title ? (
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

          {story && !isReplyMode ? (
            <View style={styles.sideActions}>
              <Pressable
                accessibilityLabel="Share story"
                accessibilityRole="button"
                onPress={() => {
                  void copyStoryLink()
                }}
                style={({ pressed }) => [
                  styles.sideAction,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons
                  name="arrow-redo"
                  size={30}
                  color="rgba(255,255,255,0.66)"
                />
              </Pressable>
            </View>
          ) : null}

          {story && !isReplyMode && isViewingOwnStory && activeItem?.stats ? (
            <OwnerStoryStatsPanel stats={activeItem.stats} />
          ) : null}

          {story && isReplyMode && canRespondToStory ? (
            <View pointerEvents="box-none" style={styles.replyModeMediaLayer}>
              <View style={styles.replyModeHeader}>
                <Pressable
                  accessibilityLabel="Close reply"
                  accessibilityRole="button"
                  onPress={closeReplyMode}
                  style={({ pressed }) => [
                    styles.replyModeClose,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Ionicons name="close" size={34} color={colors.text} />
                </Pressable>
                <View style={styles.replyModeTitleWrap} pointerEvents="none">
                  <Text style={styles.replyModeTitle}>Reply to</Text>
                  <Text style={styles.replyModeName}>{story.creator}</Text>
                </View>
              </View>

              <View style={styles.replyModeBody} pointerEvents="none">
                <Ionicons
                  name="paper-plane"
                  size={44}
                  color="rgba(255,255,255,0.34)"
                  style={styles.replyModePlane}
                />
                <View style={styles.replyModeNoticeWrap}>
                  <Text style={styles.replyModeNotice}>
                    {creatorFirstName} can share your reply to their Public Story.
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>

        {story && isReplyMode && canRespondToStory ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.replyKeyboardLayer,
              { bottom: replyComposerBottom },
            ]}
          >
            {isEmojiTrayOpen ? (
              <View style={styles.replyEmojiTray}>
                {replyEmojiOptions.map((emoji) => (
                  <Pressable
                    key={emoji}
                    accessibilityLabel={`Add ${emoji} emoji`}
                    accessibilityRole="button"
                    onPress={() => appendEmoji(emoji)}
                    style={({ pressed }) => [
                      styles.replyEmojiButton,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.replyEmojiText}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.replyModeComposerBar}>
              <Pressable
                accessibilityLabel={`Reply to ${story.creator}`}
                accessibilityRole="button"
                onPress={() => replyInputRef.current?.focus()}
                style={styles.replyModeInputShell}
              >
                <TextInput
                  ref={replyInputRef}
                  value={reply}
                  onChangeText={setReply}
                  placeholder={`Reply to ${story.creator}...`}
                  placeholderTextColor="rgba(255,255,255,0.92)"
                  editable={!isViewingOwnStory && !isSendingReply}
                  keyboardAppearance="dark"
                  returnKeyType="send"
                  onSubmitEditing={sendReply}
                  numberOfLines={1}
                  style={styles.replyModeInput}
                />
              </Pressable>
              {reply.trim().length > 0 ? (
                <Pressable
                  accessibilityLabel="Send story reply"
                  accessibilityRole="button"
                  disabled={isSendingReply}
                  onPress={sendReply}
                  style={({ pressed }) => [
                    styles.replyModeSendButton,
                    isSendingReply ? styles.replyModeSendButtonDisabled : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  {isSendingReply ? (
                    <ActivityIndicator size="small" color={colors.background} />
                  ) : (
                    <Ionicons
                      name="arrow-up"
                      size={19}
                      color={colors.background}
                    />
                  )}
                </Pressable>
              ) : null}
              <Pressable
                accessibilityLabel="Emoji"
                accessibilityRole="button"
                onPress={() => setIsEmojiTrayOpen((current) => !current)}
                style={({ pressed }) => [
                  styles.replyModeIconButton,
                  isEmojiTrayOpen ? styles.replyModeIconButtonActive : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="happy-outline" size={25} color={colors.text} />
              </Pressable>
              <Pressable
                accessibilityLabel="Photo reply"
                accessibilityRole="button"
                disabled={isSendingReply}
                onPress={openPhotoLibraryReply}
                style={({ pressed }) => [
                  styles.replyModeIconButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="images-outline" size={25} color={colors.text} />
              </Pressable>
            </View>
          </View>
        ) : null}

        {story && !isReplyMode && canRespondToStory ? (
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
                onFocus={openReplyMode}
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
                  <Ionicons name="arrow-up" size={20} color={colors.background} />
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
                <Ionicons name="happy-outline" size={28} color={colors.text} />
                <View style={styles.plusDot}>
                  <Ionicons name="add" size={8} color={colors.background} />
                </View>
              </Pressable>
            </View>

            {!isViewingOwnStory ? (
              <Pressable
                accessibilityLabel="More story actions"
                accessibilityRole="button"
                onPress={() => setIsViewerActionsOpen((current) => !current)}
                style={({ pressed }) => [
                  styles.moreButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="ellipsis-horizontal" size={28} color={colors.text} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {story && isViewerActionsOpen && !isViewingOwnStory ? (
          <View pointerEvents="box-none" style={styles.viewerMenuLayer}>
            <Pressable
              accessibilityLabel="Close story actions"
              accessibilityRole="button"
              onPress={() => setIsViewerActionsOpen(false)}
              style={styles.viewerMenuBackdrop}
            />
            <View style={styles.viewerMenu}>
              <Text style={styles.viewerMenuTitle}>Story actions</Text>
              <Pressable
                accessibilityLabel="Report this story"
                accessibilityRole="button"
                disabled={isReportingStory}
                onPress={chooseReportReason}
                style={({ pressed }) => [
                  styles.viewerMenuItem,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="flag-outline" size={18} color="#17191f" />
                <Text style={styles.viewerMenuItemText}>
                  {isReportingStory ? "Reporting..." : "Report story"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Block ${story.creator}`}
                accessibilityRole="button"
                disabled={isBlockingCreator}
                onPress={confirmBlockStoryCreator}
                style={({ pressed }) => [
                  styles.viewerMenuItemDanger,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="ban-outline" size={19} color={colors.brand} />
                <Text style={styles.viewerMenuItemDangerText}>
                  {isBlockingCreator ? "Blocking..." : `Block ${creatorFirstName}`}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {story && isReportReasonMenuOpen && !isViewingOwnStory ? (
          <View style={styles.reportReasonLayer}>
            <Pressable
              accessibilityLabel="Close report reasons"
              accessibilityRole="button"
              onPress={() => setIsReportReasonMenuOpen(false)}
              style={styles.reportReasonBackdrop}
            />
            <View style={styles.reportReasonPanel}>
              <View style={styles.reportReasonHeader}>
                <View style={styles.reportReasonHeaderCopy}>
                  <Text style={styles.reportReasonEyebrow}>Report story</Text>
                  <Text style={styles.reportReasonTitle}>
                    What is the issue?
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Close report reasons"
                  accessibilityRole="button"
                  onPress={() => setIsReportReasonMenuOpen(false)}
                  style={({ pressed }) => [
                    styles.reportReasonClose,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Ionicons name="close" size={20} color="#17191f" />
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={styles.reportReasonList}
                showsVerticalScrollIndicator={false}
              >
                {reportReasonOptions.map((option) => (
                  <Pressable
                    accessibilityLabel={`Report for ${option.label}`}
                    accessibilityRole="button"
                    disabled={isReportingStory}
                    key={option.id}
                    onPress={() => void reportActiveStory(option.id)}
                    style={({ pressed }) => [
                      styles.reportReasonOption,
                      pressed ? styles.reportReasonOptionPressed : null,
                    ]}
                  >
                    <View style={styles.reportReasonIcon}>
                      <Ionicons
                        name={option.icon}
                        size={19}
                        color="#17191f"
                      />
                    </View>
                    <View style={styles.reportReasonOptionCopy}>
                      <Text style={styles.reportReasonOptionLabel}>
                        {option.label}
                      </Text>
                      <Text style={styles.reportReasonOptionDetail}>
                        {option.detail}
                      </Text>
                    </View>
                    {reportingReason === option.id ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color="#9ca3af"
                      />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
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

function getFirstName(value: string | undefined) {
  return value?.trim().split(/\s+/)[0] || "They"
}

function formatCompactNumber(value: number) {
  return Intl.NumberFormat("en", { notation: "compact" }).format(value)
}

function formatMoney(cents: number) {
  return Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function toReplyMediaAsset(
  asset: ImagePicker.ImagePickerAsset,
  forcedKind?: "image" | "video",
): ReplyMediaAsset {
  const assetKind = forcedKind ?? (asset.type === "video" ? "video" : "image")
  const extension = assetKind === "video" ? "mp4" : "jpg"

  return {
    uri: asset.uri,
    assetKind,
    mimeType:
      asset.mimeType ?? (assetKind === "video" ? "video/mp4" : "image/jpeg"),
    fileName: asset.fileName ?? `reply-${Date.now()}.${extension}`,
  }
}

function initials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function OwnerStoryStatsPanel({
  stats,
}: {
  stats: NonNullable<MobileStoryStackItem["stats"]>
}) {
  return (
    <View pointerEvents="none" style={styles.ownerStatsPanel}>
      <View style={styles.ownerStatsHeader}>
        <Text style={styles.ownerStatsTitle}>Story stats</Text>
        <Text style={styles.ownerStatsEarnings}>
          {formatMoney(stats.earningsCents)}
        </Text>
      </View>
      <View style={styles.ownerStatsGrid}>
        <OwnerStoryStat
          label="Views"
          value={formatCompactNumber(stats.views)}
          detail={`${formatCompactNumber(stats.uniqueViewers)} unique`}
        />
        <OwnerStoryStat
          label="Completion"
          value={`${stats.completionRate}%`}
          detail={`${formatCompactNumber(stats.completedViews)} complete`}
        />
        <OwnerStoryStat
          label="Replies"
          value={formatCompactNumber(stats.replies)}
          detail={`${formatCompactNumber(stats.comments)} comments`}
        />
        <OwnerStoryStat
          label="Avg."
          value={`${stats.averageViewedSeconds}s`}
          detail="watch time"
        />
      </View>
    </View>
  )
}

function OwnerStoryStat({
  detail,
  label,
  value,
}: {
  detail: string
  label: string
  value: string
}) {
  return (
    <View style={styles.ownerStatsMetric}>
      <Text style={styles.ownerStatsLabel}>{label}</Text>
      <Text style={styles.ownerStatsValue}>{value}</Text>
      <Text style={styles.ownerStatsDetail}>{detail}</Text>
    </View>
  )
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
  mediaFrameReplyMode: {
    marginTop: 0,
    marginBottom: 0,
    borderRadius: 0,
    backgroundColor: "#050912",
  },
  media: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  mediaLoadingState: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  replySentToast: {
    position: "absolute",
    top: 84,
    alignSelf: "center",
    zIndex: 34,
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(17,24,39,0.86)",
  },
  replySentToastText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
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
    fontWeight: "600",
    color: colors.text,
  },
  postedAt: {
    marginTop: 3,
    fontSize: 15,
    fontWeight: "500",
    color: "rgba(255,255,255,0.64)",
  },
  bellButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(11,13,17,0.26)",
    alignItems: "center",
    justifyContent: "center",
  },
  bellButtonActive: {
    borderColor: "rgba(224,22,22,0.78)",
    backgroundColor: "rgba(224,22,22,0.74)",
  },
  viewerActionCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  viewerMenuButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(11,13,17,0.26)",
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
    fontWeight: "700",
    color: colors.text,
  },
  addButton: {
    minWidth: 74,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(224,22,22,0.92)",
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: "600",
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
    lineHeight: 23,
    color: colors.text,
    textAlign: "center",
  },
  sideActions: {
    position: "absolute",
    right: 24,
    bottom: 34,
    zIndex: 6,
    alignItems: "center",
    gap: 16,
  },
  sideAction: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  ownerStatsPanel: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 28,
    zIndex: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 12,
    backgroundColor: "rgba(8,12,20,0.82)",
  },
  ownerStatsHeader: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  ownerStatsTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "rgba(255,255,255,0.72)",
    textTransform: "uppercase",
  },
  ownerStatsEarnings: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },
  ownerStatsGrid: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  ownerStatsMetric: {
    flex: 1,
    minWidth: 0,
    minHeight: 68,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  ownerStatsLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "rgba(255,255,255,0.62)",
  },
  ownerStatsValue: {
    marginTop: 4,
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  ownerStatsDetail: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.58)",
  },
  replyDock: {
    minHeight: 84,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.background,
  },
  replyComposer: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.4,
    borderColor: colors.outline,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingLeft: 18,
    paddingRight: 10,
  },
  replyInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700",
    color: colors.text,
  },
  reactionButton: {
    width: 30,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  sendReplyButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.text,
  },
  reactionText: {
    fontSize: 24,
  },
  plusDot: {
    position: "absolute",
    top: 2,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.text,
  },
  moreButton: {
    width: 52,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.4,
    borderColor: colors.outline,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerMenuLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 42,
  },
  viewerMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  viewerMenu: {
    position: "absolute",
    top: 86,
    right: 14,
    width: 198,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.10)",
    backgroundColor: "#ffffff",
    padding: 8,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 12,
  },
  viewerMenuTitle: {
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
    color: "#6b7280",
    textTransform: "uppercase",
  },
  viewerMenuItem: {
    minHeight: 42,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
  },
  viewerMenuItemText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#17191f",
  },
  viewerMenuItemDanger: {
    minHeight: 42,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#fff1f2",
    paddingHorizontal: 10,
  },
  viewerMenuItemDangerText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.brand,
  },
  reportReasonLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  reportReasonBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  reportReasonPanel: {
    maxHeight: "78%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.10)",
    backgroundColor: "#ffffff",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.26,
    shadowRadius: 28,
    elevation: 16,
  },
  reportReasonHeader: {
    minHeight: 74,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  reportReasonHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  reportReasonEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
    color: "#6b7280",
    textTransform: "uppercase",
  },
  reportReasonTitle: {
    marginTop: 3,
    fontSize: 20,
    fontWeight: "800",
    color: "#17191f",
  },
  reportReasonClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  reportReasonList: {
    padding: 8,
  },
  reportReasonOption: {
    minHeight: 68,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  reportReasonOptionPressed: {
    backgroundColor: "#f3f4f6",
  },
  reportReasonIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  reportReasonOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  reportReasonOptionLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: "#17191f",
  },
  reportReasonOptionDetail: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    color: "#6b7280",
  },
  replyKeyboardLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    justifyContent: "flex-end",
  },
  replyModeMediaLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: "rgba(5,9,18,0.54)",
  },
  replyModeHeader: {
    paddingTop: 26,
    minHeight: 118,
    justifyContent: "flex-start",
  },
  replyModeClose: {
    position: "absolute",
    top: 26,
    left: 20,
    zIndex: 2,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  replyModeTitleWrap: {
    alignItems: "center",
    paddingHorizontal: 92,
  },
  replyModeTitle: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  replyModeName: {
    marginTop: 6,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  replyModeBody: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingBottom: 26,
  },
  replyModePlane: {
    marginBottom: 32,
    opacity: 0.72,
    transform: [{ rotate: "-12deg" }],
  },
  replyModeNoticeWrap: {
    width: "100%",
  },
  replyModeNotice: {
    paddingHorizontal: 24,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  replyModeComposerBar: {
    height: 60,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.background,
  },
  replyModeInputShell: {
    flex: 1,
    minWidth: 0,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.25,
    borderColor: "rgba(255,255,255,0.82)",
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.background,
  },
  replyModeInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "600",
    color: colors.text,
  },
  replyModeSendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.text,
  },
  replyModeSendButtonDisabled: {
    opacity: 0.62,
  },
  replyModeIconButton: {
    width: 32,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  replyModeIconButtonActive: {
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  replyEmojiTray: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(8,12,20,0.96)",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 5,
  },
  replyEmojiButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  replyEmojiText: {
    fontSize: 20,
    lineHeight: 24,
  },
  pressed: {
    opacity: 0.7,
  },
})
