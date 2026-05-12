import Ionicons from "@expo/vector-icons/Ionicons"
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from "expo-camera"
import * as ImagePicker from "expo-image-picker"
import { VideoView, useVideoPlayer } from "expo-video"
import { useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Image,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import type { DimensionValue } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useAuthFlow } from "@/lib/auth-flow"
import { postMobileFormApi } from "@/lib/mobile-api"
import type { MobileStoryUploadResponse } from "@/lib/mobile-stories-api"
import { AccountAvatarButton } from "@/components/social/ui"

type StoryMedia = {
  id: string
  uri: string
  assetKind: "image" | "video"
  mimeType: string
  fileName: string
}

type FlowStep = "camera" | "edit"

const colors = {
  background: "#050608",
  text: "#ffffff",
  mutedText: "rgba(255,255,255,0.7)",
  darkGlass: "rgba(0,0,0,0.38)",
  lightGlass: "rgba(255,255,255,0.16)",
  white: "#ffffff",
  accent: "#e01616",
}

const galleryItems: StoryMedia[] = [
  {
    id: "gallery-1",
    uri: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80",
    assetKind: "image",
    mimeType: "image/jpeg",
    fileName: "gallery-1.jpg",
  },
  {
    id: "gallery-2",
    uri: "https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=900&q=80",
    assetKind: "image",
    mimeType: "image/jpeg",
    fileName: "gallery-2.jpg",
  },
  {
    id: "gallery-3",
    uri: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    assetKind: "image",
    mimeType: "image/jpeg",
    fileName: "gallery-3.jpg",
  },
  {
    id: "gallery-4",
    uri: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=900&q=80",
    assetKind: "image",
    mimeType: "image/jpeg",
    fileName: "gallery-4.jpg",
  },
  {
    id: "gallery-5",
    uri: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=80",
    assetKind: "image",
    mimeType: "image/jpeg",
    fileName: "gallery-5.jpg",
  },
  {
    id: "gallery-6",
    uri: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=900&q=80",
    assetKind: "image",
    mimeType: "image/jpeg",
    fileName: "gallery-6.jpg",
  },
]

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)
const DEFAULT_TEXT_VERTICAL_PERCENT = 47
const MIN_TEXT_VERTICAL_PERCENT = 18
const MAX_TEXT_VERTICAL_PERCENT = 82
const HOLD_TO_RECORD_DELAY_MS = 240
const CAMERA_MODE_SETTLE_MS = 180
const STORY_FRAME_SECONDS = 10
const STORY_FRAME_MS = STORY_FRAME_SECONDS * 1_000
const MAX_RECORDED_STORY_FRAMES = 6
const MAX_RECORDED_VIDEO_SECONDS =
  STORY_FRAME_SECONDS * MAX_RECORDED_STORY_FRAMES
const RECORDING_RING_TICK_COUNT = 48

export default function PostScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const cameraRef = useRef<CameraView>(null)
  const cameraRequestStarted = useRef(false)
  const shutterHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPressRecording = useRef(false)
  const isRecordingVideoRef = useRef(false)
  const isStartingVideoRef = useRef(false)
  const hasShutterPressMovedToRecording = useRef(false)
  const cameraModeRef = useRef<"picture" | "video">("video")
  const recordingStartedAt = useRef(0)
  const recordingProgressTimer = useRef<ReturnType<typeof setInterval> | null>(
    null,
  )
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [microphonePermission, requestMicrophonePermission] =
    useMicrophonePermissions()
  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("back")
  const [cameraMode, setCameraMode] = useState<"picture" | "video">("video")
  const [step, setStep] = useState<FlowStep>("camera")
  const [selectedMedia, setSelectedMedia] = useState<StoryMedia | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isRecordingVideo, setIsRecordingVideo] = useState(false)
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0)
  const [overlayText, setOverlayText] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const [isTextEditing, setIsTextEditing] = useState(false)
  const [isLinkEditing, setIsLinkEditing] = useState(false)
  const [textVerticalPercent, setTextVerticalPercent] = useState(
    DEFAULT_TEXT_VERTICAL_PERCENT,
  )
  const [storyCanvasHeight, setStoryCanvasHeight] = useState(1)
  const textInputRef = useRef<TextInput>(null)
  const textDragStartPercent = useRef(DEFAULT_TEXT_VERTICAL_PERCENT)
  const textGestureState = useRef({
    hasOverlayText: false,
    isTextEditing: false,
    storyCanvasHeight: 1,
    textVerticalPercent: DEFAULT_TEXT_VERTICAL_PERCENT,
  })
  const hasCameraPermission = Boolean(cameraPermission?.granted)

  const activeMedia = useMemo(
    () => selectedMedia ?? galleryItems[0],
    [selectedMedia],
  )
  const hasOverlayText = overlayText.trim().length > 0
  const hasLink = linkUrl.trim().length > 0

  textGestureState.current = {
    hasOverlayText,
    isTextEditing,
    storyCanvasHeight,
    textVerticalPercent,
  }

  const textPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        const gesture = textGestureState.current

        return gesture.hasOverlayText && !gesture.isTextEditing
      },
      onStartShouldSetPanResponderCapture: () => {
        const gesture = textGestureState.current

        return gesture.hasOverlayText && !gesture.isTextEditing
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        const gesture = textGestureState.current

        return (
          gesture.hasOverlayText &&
          !gesture.isTextEditing &&
          Math.abs(gestureState.dy) > 3
        )
      },
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const gesture = textGestureState.current

        return (
          gesture.hasOverlayText &&
          !gesture.isTextEditing &&
          Math.abs(gestureState.dy) > 3
        )
      },
      onPanResponderGrant: () => {
        textDragStartPercent.current =
          textGestureState.current.textVerticalPercent
      },
      onPanResponderMove: (_, gestureState) => {
        setTextVerticalPercent(
          clamp(
            textDragStartPercent.current +
              (gestureState.dy /
                Math.max(textGestureState.current.storyCanvasHeight, 1)) *
                100,
            MIN_TEXT_VERTICAL_PERCENT,
            MAX_TEXT_VERTICAL_PERCENT,
          ),
        )
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current

  const usePickedAsset = (asset: ImagePicker.ImagePickerAsset) => {
    const assetKind = asset.type === "video" ? "video" : "image"
    const extension = assetKind === "video" ? "mp4" : "jpg"
    const media: StoryMedia = {
      id: `${assetKind}-${Date.now()}`,
      uri: asset.uri,
      assetKind,
      mimeType:
        asset.mimeType ?? (assetKind === "video" ? "video/mp4" : "image/jpeg"),
      fileName: asset.fileName ?? `story-${Date.now()}.${extension}`,
    }

    setUploadError(null)
    setSelectedMedia(media)
    setStep("edit")
  }

  const wait = (durationMs: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, durationMs)
    })

  const setCameraModeIntent = (mode: "picture" | "video") => {
    cameraModeRef.current = mode
    setCameraMode(mode)
  }

  const switchCameraMode = async (mode: "picture" | "video") => {
    if (cameraModeRef.current !== mode) {
      setCameraModeIntent(mode)
      await wait(CAMERA_MODE_SETTLE_MS)
    }
  }

  const stopRecordingProgressTimer = () => {
    if (recordingProgressTimer.current) {
      clearInterval(recordingProgressTimer.current)
      recordingProgressTimer.current = null
    }
  }

  const startRecordingProgressTimer = () => {
    stopRecordingProgressTimer()
    recordingStartedAt.current = Date.now()
    setRecordingElapsedMs(0)
    recordingProgressTimer.current = setInterval(() => {
      setRecordingElapsedMs(Date.now() - recordingStartedAt.current)
    }, 80)
  }

  const resetRecordingProgressTimer = () => {
    stopRecordingProgressTimer()
    recordingStartedAt.current = 0
    setRecordingElapsedMs(0)
  }

  useEffect(() => {
    if (
      step === "camera" &&
      cameraPermission &&
      !cameraPermission.granted &&
      cameraPermission.canAskAgain &&
      !cameraRequestStarted.current
    ) {
      cameraRequestStarted.current = true
      void requestCameraPermission()
    }
  }, [cameraPermission, requestCameraPermission, step])

  const captureStory = async () => {
    if (isRecordingVideoRef.current || isStartingVideoRef.current) {
      return
    }

    if (!hasCameraPermission) {
      const permission = await requestCameraPermission()

      if (!permission.granted) {
        setUploadError("Camera permission is required to capture a story.")
        return
      }
    }

    try {
      await switchCameraMode("picture")

      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.9,
        shutterSound: true,
      })

      if (!photo?.uri) {
        setUploadError("Camera is not ready yet.")
        return
      }

      setUploadError(null)
      setSelectedMedia({
        id: `image-${Date.now()}`,
        uri: photo.uri,
        assetKind: "image",
        mimeType: "image/jpeg",
        fileName: `story-${Date.now()}.jpg`,
      })
      setStep("edit")
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Could not capture photo.",
      )
    } finally {
      setCameraModeIntent("video")
    }
  }

  const startVideoRecording = async () => {
    if (isRecordingVideoRef.current || isStartingVideoRef.current) {
      return
    }

    isStartingVideoRef.current = true

    try {
      if (!hasCameraPermission) {
        const cameraStatus = await requestCameraPermission()

        if (!cameraStatus.granted) {
          setUploadError("Camera permission is required to record a story.")
          return
        }
      }

      const microphoneStatus = microphonePermission?.granted
        ? microphonePermission
        : await requestMicrophonePermission()

      if (!microphoneStatus.granted) {
        setUploadError("Microphone permission is required to record video.")
        return
      }

      await switchCameraMode("video")

      if (!isPressRecording.current) {
        return
      }

      const recording = cameraRef.current?.recordAsync({
        maxDuration: MAX_RECORDED_VIDEO_SECONDS,
      })

      if (!recording) {
        setUploadError("Camera is not ready yet.")
        return
      }

      isRecordingVideoRef.current = true
      setIsRecordingVideo(true)
      startRecordingProgressTimer()
      setUploadError(null)

      const video = await recording

      if (!video?.uri) {
        return
      }

      const videoExtension =
        video.uri.split("?")[0]?.split(".").pop()?.toLowerCase() || "mp4"
      const videoMimeType =
        videoExtension === "mov" ? "video/quicktime" : "video/mp4"

      setSelectedMedia({
        id: `video-${Date.now()}`,
        uri: video.uri,
        assetKind: "video",
        mimeType: videoMimeType,
        fileName: `story-${Date.now()}.${videoExtension}`,
      })
      setStep("edit")
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Could not record video.",
      )
    } finally {
      isStartingVideoRef.current = false
      isRecordingVideoRef.current = false
      isPressRecording.current = false
      setIsRecordingVideo(false)
      resetRecordingProgressTimer()
      setCameraModeIntent("video")
    }
  }

  const handleShutterPressIn = () => {
    isPressRecording.current = true
    hasShutterPressMovedToRecording.current = false
    setCameraModeIntent("video")

    if (shutterHoldTimer.current) {
      clearTimeout(shutterHoldTimer.current)
    }

    shutterHoldTimer.current = setTimeout(() => {
      shutterHoldTimer.current = null
      hasShutterPressMovedToRecording.current = true
      void startVideoRecording()
    }, HOLD_TO_RECORD_DELAY_MS)
  }

  const handleShutterPressOut = () => {
    if (shutterHoldTimer.current) {
      clearTimeout(shutterHoldTimer.current)
      shutterHoldTimer.current = null
      isPressRecording.current = false
      void captureStory()
      return
    }

    isPressRecording.current = false

    if (
      hasShutterPressMovedToRecording.current &&
      (isRecordingVideoRef.current || isStartingVideoRef.current)
    ) {
      cameraRef.current?.stopRecording()
    }
  }

  const openGalleryPicker = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      setUploadError("Photo library permission is required to choose a story.")
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.9,
    })

    if (!result.canceled) {
      usePickedAsset(result.assets[0])
    }
  }

  const publishStory = async () => {
    if (!account) {
      setUploadError("Sign in before uploading a story.")
      return
    }

    if (!activeMedia) {
      setUploadError("Choose a photo or video before posting.")
      return
    }

    setIsPublishing(true)
    setUploadError(null)

    try {
      const formData = new FormData()

      formData.append("caption", overlayText.trim())
      formData.append("brandTags", "")
      formData.append("stickers", "")
      formData.append("textOverlays", overlayText.trim())
      formData.append("textOverlayPositionY", textVerticalPercent.toFixed(2))
      formData.append("linkLabel", hasLink ? "Open link" : "")
      formData.append("linkUrl", linkUrl.trim())
      formData.append("media", {
        uri: activeMedia.uri,
        name: activeMedia.fileName,
        type: activeMedia.mimeType,
      } as unknown as Blob)

      await postMobileFormApi<MobileStoryUploadResponse>(
        "/api/mobile/stories",
        formData,
      )
      router.replace("/")
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Story upload failed.",
      )
    } finally {
      setIsPublishing(false)
    }
  }

  const openTextEditor = () => {
    setIsLinkEditing(false)
    setIsTextEditing(true)
  }

  const openLinkEditor = () => {
    setIsTextEditing(false)
    setIsLinkEditing(true)
  }

  const finishTextEditing = () => {
    setIsTextEditing(false)
    textInputRef.current?.blur()
  }

  const handleStoryCanvasLayout = (event: LayoutChangeEvent) => {
    setStoryCanvasHeight(Math.max(event.nativeEvent.layout.height, 1))
  }

  const finishLinkEditing = () => {
    setIsLinkEditing(false)
  }

  const flipCamera = () => {
    if (isRecordingVideo) {
      return
    }

    setCameraFacing((current) => (current === "back" ? "front" : "back"))
  }

  useEffect(
    () => () => {
      if (shutterHoldTimer.current) {
        clearTimeout(shutterHoldTimer.current)
      }
      stopRecordingProgressTimer()
      cameraRef.current?.stopRecording()
    },
    [],
  )

  const recordingFrameProgress = isRecordingVideo
    ? (recordingElapsedMs % STORY_FRAME_MS) / STORY_FRAME_MS
    : 0
  const recordingFrameNumber = Math.min(
    MAX_RECORDED_STORY_FRAMES,
    Math.floor(recordingElapsedMs / STORY_FRAME_MS) + 1,
  )

  if (step === "edit") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.previewScreen}>
          <View
            onLayout={handleStoryCanvasLayout}
            style={styles.storyCanvas}
          >
            {activeMedia.assetKind === "video" ? (
              <StoryVideoPreview uri={activeMedia.uri} />
            ) : (
              <Image source={{ uri: activeMedia.uri }} style={styles.previewImage} />
            )}
            <View style={styles.previewShade} />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add text to story"
              onPress={openTextEditor}
              style={styles.storyCanvasPressLayer}
            />

            {isTextEditing || hasOverlayText ? (
              <View
                style={[
                  styles.snapTextDragTarget,
                  { top: `${textVerticalPercent}%` as DimensionValue },
                ]}
                {...textPanResponder.panHandlers}
              >
                <View style={styles.snapTextOverlay}>
                  {isTextEditing ? (
                    <TextInput
                      ref={textInputRef}
                      autoFocus
                      value={overlayText}
                      onChangeText={setOverlayText}
                      placeholder="Add text"
                      placeholderTextColor="rgba(255,255,255,0.68)"
                      style={styles.snapTextInput}
                      blurOnSubmit
                      returnKeyType="done"
                      onBlur={() => setIsTextEditing(false)}
                      onSubmitEditing={finishTextEditing}
                    />
                  ) : (
                    <Text style={styles.snapText}>{overlayText.trim()}</Text>
                  )}
                </View>
              </View>
            ) : null}
          </View>

          <View style={styles.snapTopBar}>
            <Pressable
              accessibilityLabel="Back to camera"
              accessibilityRole="button"
              onPress={() => setStep("camera")}
              style={({ pressed }) => [
                styles.snapCloseButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <Ionicons name="close" size={38} color={colors.text} />
            </Pressable>
            <StoryHeaderPill />
          </View>

          <View style={styles.snapAccountButton}>
            <AccountAvatarButton />
          </View>

          <View style={styles.rightToolRail}>
            <ToolRailButton icon="text" active={isTextEditing} onPress={openTextEditor} />
            <ToolRailButton
              icon="link-outline"
              active={isLinkEditing}
              onPress={openLinkEditor}
            />
          </View>

          {hasLink ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit story link"
              onPress={openLinkEditor}
              style={({ pressed }) => [
                styles.linkPreview,
                pressed ? styles.pressed : null,
              ]}
            >
              <Ionicons name="link-outline" size={18} color={colors.text} />
              <Text numberOfLines={1} style={styles.linkPreviewText}>
                {linkUrl.trim()}
              </Text>
            </Pressable>
          ) : null}

          {isLinkEditing ? (
            <View style={styles.linkEditorPanel}>
              <View style={styles.linkInputWrap}>
                <Ionicons name="link-outline" size={20} color={colors.mutedText} />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  keyboardType="url"
                  value={linkUrl}
                  onChangeText={setLinkUrl}
                  placeholder="Paste a link"
                  placeholderTextColor={colors.mutedText}
                  style={styles.linkInput}
                  returnKeyType="done"
                  onSubmitEditing={finishLinkEditing}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Done adding link"
                onPress={finishLinkEditing}
                style={({ pressed }) => [
                  styles.linkDoneButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.linkDoneText}>Done</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.storyFooter}>
            {uploadError ? (
              <Text style={styles.uploadErrorText}>{uploadError}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Post to stories"
              onPress={publishStory}
              disabled={isPublishing}
              style={({ pressed }) => [
                styles.storyPostButton,
                isPublishing ? styles.storyPostButtonDisabled : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Ionicons name="add" size={28} color={colors.text} />
              <Text style={styles.storyPostLabel}>
                {isPublishing ? "Uploading..." : "Upload to Story"}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.cameraScreen}>
        <View style={styles.cameraFeed}>
          {hasCameraPermission ? (
            <CameraView
              ref={cameraRef}
              active={step === "camera"}
              animateShutter
              facing={cameraFacing}
              mode={cameraMode}
              mute={false}
              style={styles.liveCamera}
              videoQuality="720p"
              onMountError={(event) => {
                setUploadError(event.message)
              }}
            />
          ) : (
            <View style={styles.cameraPermissionState}>
              <Ionicons name="camera-outline" size={42} color={colors.text} />
              <Text style={styles.cameraPermissionTitle}>
                Camera access is needed
              </Text>
              <Text style={styles.cameraPermissionCopy}>
                Allow camera access to capture a story from this screen.
              </Text>
            </View>
          )}
          <View style={styles.cameraShade} />
        </View>

        <View style={styles.cameraTopBar}>
          <Pressable
            accessibilityLabel="Close camera"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.iconButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>

          <View style={styles.cameraModePill}>
            <Ionicons name="camera" size={15} color={colors.text} />
            <Text style={styles.cameraModeText}>Story</Text>
          </View>

          <View style={styles.cameraTopActions}>
            <Pressable
              accessibilityLabel="Flip camera"
              accessibilityRole="button"
              onPress={flipCamera}
              style={({ pressed }) => [
                styles.iconButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <Ionicons name="camera-reverse-outline" size={23} color={colors.text} />
            </Pressable>
            <AccountAvatarButton />
          </View>
        </View>

        <View style={styles.cameraHint}>
          <Text style={styles.cameraHintText}>
            {isRecordingVideo
              ? `Frame ${recordingFrameNumber}/${MAX_RECORDED_STORY_FRAMES} - release to finish`
              : "Tap for photo, hold for video"}
          </Text>
        </View>

        <View style={styles.cameraControls}>
          <Pressable
            accessibilityLabel="Open camera roll"
            accessibilityRole="button"
            onPress={openGalleryPicker}
            disabled={isRecordingVideo}
            style={({ pressed }) => [
              styles.galleryButton,
              isRecordingVideo ? styles.controlDisabled : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Image source={{ uri: galleryItems[1].uri }} style={styles.galleryThumb} />
            <Ionicons name="images-outline" size={18} color={colors.text} />
          </Pressable>

          <Pressable
            accessibilityLabel="Tap for photo or hold to record video"
            accessibilityRole="button"
            onPressIn={handleShutterPressIn}
            onPressOut={handleShutterPressOut}
            style={({ pressed }) => [
              styles.shutterOuter,
              isRecordingVideo ? styles.shutterRecording : null,
              pressed && !isRecordingVideo ? styles.shutterPressed : null,
            ]}
          >
            <RecordingTimerRing
              progress={recordingFrameProgress}
              visible={isRecordingVideo}
            />
            <View
              style={[
                styles.shutterInner,
                isRecordingVideo ? styles.shutterInnerRecording : null,
              ]}
            />
          </Pressable>

          <View style={styles.cameraControlSpacer} />
        </View>
      </View>
    </SafeAreaView>
  )
}

function StoryHeaderPill() {
  return (
    <View style={styles.storyHeaderPill}>
      <Text numberOfLines={1} style={styles.storyHeaderTitle}>
        New Story
      </Text>
    </View>
  )
}

function StoryVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true
    instance.muted = true
    instance.audioMixingMode = "mixWithOthers"
    instance.play()
  })

  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      style={styles.previewImage}
    />
  )
}

function RecordingTimerRing({
  progress,
  visible,
}: {
  progress: number
  visible: boolean
}) {
  if (!visible) {
    return null
  }

  const elapsedTicks = Math.floor(
    clamp(progress, 0, 1) * RECORDING_RING_TICK_COUNT,
  )

  return (
    <View pointerEvents="none" style={styles.recordingTimerRing}>
      {Array.from({ length: RECORDING_RING_TICK_COUNT }).map((_, index) => {
        const angle = (index / RECORDING_RING_TICK_COUNT) * 360
        const isTickRemaining = index >= elapsedTicks

        return (
          <View
            key={index}
            style={[
              styles.recordingTimerTick,
              {
                opacity: isTickRemaining ? 1 : 0,
                transform: [
                  { rotate: `${angle}deg` },
                  { translateY: -50 },
                ],
              },
            ]}
          />
        )
      })}
    </View>
  )
}

function ToolRailButton({
  active,
  icon,
  onPress,
}: {
  active?: boolean
  icon: ComponentProps<typeof Ionicons>["name"]
  onPress?: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${icon} story tool`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolRailButton,
        active ? styles.toolRailButtonActive : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Ionicons name={icon} size={24} color={colors.text} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  cameraScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  cameraFeed: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: "#151922",
  },
  liveCamera: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  cameraShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  cameraPermissionState: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  cameraPermissionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  cameraPermissionCopy: {
    color: colors.mutedText,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "center",
  },
  cameraTopBar: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cameraTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.darkGlass,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraModePill: {
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.darkGlass,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  cameraModeText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  cameraHint: {
    marginTop: "auto",
    alignItems: "center",
    paddingBottom: 24,
  },
  cameraHintText: {
    color: colors.mutedText,
    fontSize: 13,
    fontWeight: "700",
  },
  cameraControls: {
    minHeight: 112,
    paddingHorizontal: 24,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  galleryButton: {
    width: 58,
    height: 58,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.lightGlass,
  },
  galleryThumb: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  shutterOuter: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 5,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.white,
  },
  recordingTimerRing: {
    position: "absolute",
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  recordingTimerTick: {
    position: "absolute",
    left: 52,
    top: 49,
    width: 4,
    height: 10,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  shutterRecording: {
    borderColor: "rgba(255,255,255,0.48)",
    transform: [{ scale: 1.04 }],
  },
  shutterInnerRecording: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  shutterPressed: {
    transform: [{ scale: 0.94 }],
  },
  controlDisabled: {
    opacity: 0.42,
  },
  cameraControlSpacer: {
    width: 58,
    height: 58,
  },
  previewScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  storyCanvas: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    marginHorizontal: 8,
    marginTop: 8,
    marginBottom: 96,
    borderRadius: 30,
  },
  storyCanvasPressLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  previewImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  previewShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  snapTopBar: {
    position: "absolute",
    top: 22,
    left: 0,
    right: 0,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  snapAccountButton: {
    position: "absolute",
    top: 22,
    right: 24,
  },
  snapCloseButton: {
    position: "absolute",
    left: 22,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  storyHeaderPill: {
    width: 118,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(11,13,17,0.42)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  storyHeaderThumbWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: "hidden",
  },
  storyHeaderThumb: {
    width: "100%",
    height: "100%",
  },
  storyHeaderTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  rightToolRail: {
    position: "absolute",
    top: 82,
    right: 24,
    width: 42,
    alignItems: "center",
    gap: 10,
  },
  toolRailButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(11,13,17,0.42)",
    alignItems: "center",
    justifyContent: "center",
  },
  toolRailButtonActive: {
    backgroundColor: colors.accent,
  },
  snapTextDragTarget: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 3,
    minHeight: 76,
    justifyContent: "center",
  },
  snapTextOverlay: {
    minHeight: 42,
    backgroundColor: "rgba(11,13,17,0.36)",
    paddingHorizontal: 24,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  snapText: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "700",
    textAlign: "center",
  },
  snapTextInput: {
    width: "100%",
    minHeight: 34,
    padding: 0,
    color: colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "700",
    textAlign: "center",
  },
  linkPreview: {
    position: "absolute",
    left: 24,
    right: 86,
    bottom: 188,
    minHeight: 42,
    borderRadius: 21,
    backgroundColor: "rgba(11,13,17,0.54)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  linkPreviewText: {
    flex: 1,
    minWidth: 0,
    color: colors.white,
    fontSize: 14,
    fontWeight: "700",
  },
  linkEditorPanel: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 110,
    minHeight: 70,
    borderRadius: 26,
    backgroundColor: "rgba(11,13,17,0.72)",
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  linkInputWrap: {
    flex: 1,
    minWidth: 0,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  linkInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    color: colors.text,
    fontSize: 15,
  },
  linkDoneButton: {
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  linkDoneText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "700",
  },
  storyFooter: {
    position: "absolute",
    left: 70,
    right: 70,
    bottom: 18,
    alignItems: "center",
  },
  uploadErrorText: {
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(224,22,22,0.82)",
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  storyPostButton: {
    width: "100%",
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(224,22,22,0.88)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  storyPostButtonDisabled: {
    opacity: 0.62,
  },
  storyPostLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.72,
  },
})
