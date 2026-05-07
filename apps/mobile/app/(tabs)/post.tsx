import Ionicons from "@expo/vector-icons/Ionicons"
import { CameraView, useCameraPermissions } from "expo-camera"
import * as ImagePicker from "expo-image-picker"
import { useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useAuthFlow } from "@/lib/auth-flow"
import { postMobileFormApi } from "@/lib/mobile-api"
import type { MobileStoryUploadResponse } from "@/lib/mobile-stories-api"

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

export default function PostScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const cameraRef = useRef<CameraView>(null)
  const cameraRequestStarted = useRef(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("back")
  const [step, setStep] = useState<FlowStep>("camera")
  const [isGalleryOpen, setIsGalleryOpen] = useState(false)
  const [selectedMedia, setSelectedMedia] = useState<StoryMedia | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [overlayText, setOverlayText] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const [isTextEditing, setIsTextEditing] = useState(false)
  const [isLinkEditing, setIsLinkEditing] = useState(false)
  const [textVerticalOffset, setTextVerticalOffset] = useState(0)
  const textDragStartY = useRef(0)
  const hasCameraPermission = Boolean(cameraPermission?.granted)

  const activeMedia = useMemo(
    () => selectedMedia ?? galleryItems[0],
    [selectedMedia],
  )
  const hasOverlayText = overlayText.trim().length > 0
  const hasLink = linkUrl.trim().length > 0
  const textPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          hasOverlayText && Math.abs(gestureState.dy) > 6,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          hasOverlayText && Math.abs(gestureState.dy) > 6,
        onPanResponderGrant: () => {
          textDragStartY.current = textVerticalOffset
        },
        onPanResponderMove: (_, gestureState) => {
          setTextVerticalOffset(
            clamp(textDragStartY.current + gestureState.dy, -240, 220),
          )
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [hasOverlayText, textVerticalOffset],
  )

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
    if (!hasCameraPermission) {
      const permission = await requestCameraPermission()

      if (!permission.granted) {
        setUploadError("Camera permission is required to capture a story.")
        return
      }
    }

    try {
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

  const chooseGalleryMedia = (media: StoryMedia) => {
    setSelectedMedia(media)
    setIsGalleryOpen(false)
    setStep("edit")
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
  }

  const finishLinkEditing = () => {
    setIsLinkEditing(false)
  }

  const nudgeText = (amount: number) => {
    setTextVerticalOffset((current) => clamp(current + amount, -240, 220))
  }

  const flipCamera = () => {
    setCameraFacing((current) => (current === "back" ? "front" : "back"))
  }

  if (step === "edit") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.previewScreen}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add text to story"
            onPress={openTextEditor}
            style={styles.storyCanvas}
          >
            {activeMedia.assetKind === "video" ? (
              <View style={styles.videoPreviewPlaceholder}>
                <Ionicons name="play-circle" size={54} color={colors.text} />
                <Text style={styles.videoPreviewText}>Video selected</Text>
              </View>
            ) : (
              <Image source={{ uri: activeMedia.uri }} style={styles.previewImage} />
            )}
            <View style={styles.previewShade} />
          </Pressable>

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
            <StoryHeaderPill thumbnailUri={galleryItems[5].uri} />
          </View>

          <View style={styles.rightToolRail}>
            <ToolRailButton icon="text" active={isTextEditing} onPress={openTextEditor} />
            <ToolRailButton
              icon="link-outline"
              active={isLinkEditing}
              onPress={openLinkEditor}
            />
          </View>

          {isTextEditing || hasOverlayText ? (
            <View
              style={[
                styles.snapTextOverlay,
                { transform: [{ translateY: textVerticalOffset }] },
              ]}
              {...textPanResponder.panHandlers}
            >
              {isTextEditing ? (
                <TextInput
                  autoFocus
                  value={overlayText}
                  onChangeText={setOverlayText}
                  placeholder="Add text"
                  placeholderTextColor="rgba(255,255,255,0.68)"
                  style={styles.snapTextInput}
                  returnKeyType="done"
                  onSubmitEditing={finishTextEditing}
                />
              ) : (
                <Text style={styles.snapText}>{overlayText.trim()}</Text>
              )}
            </View>
          ) : null}

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

          {isTextEditing ? (
            <View style={styles.textMoveControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Move text up"
                onPress={() => nudgeText(-28)}
                style={({ pressed }) => [
                  styles.textMoveButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="chevron-up" size={22} color={colors.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Done editing text"
                onPress={finishTextEditing}
                style={({ pressed }) => [
                  styles.textDoneButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.textDoneLabel}>Done</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Move text down"
                onPress={() => nudgeText(28)}
                style={({ pressed }) => [
                  styles.textMoveButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Ionicons name="chevron-down" size={22} color={colors.text} />
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
              mode="picture"
              style={styles.liveCamera}
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
          <View style={styles.focusFrame} />
          <Text style={styles.cameraFacingLabel}>
            {cameraFacing === "back" ? "Back Camera" : "Front Camera"}
          </Text>
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
        </View>

        <View style={styles.cameraHint}>
          <Text style={styles.cameraHintText}>Tap to capture</Text>
        </View>

        <View style={styles.cameraControls}>
          <Pressable
            accessibilityLabel="Open camera roll"
            accessibilityRole="button"
            onPress={openGalleryPicker}
            style={({ pressed }) => [
              styles.galleryButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Image source={{ uri: galleryItems[1].uri }} style={styles.galleryThumb} />
            <Ionicons name="images-outline" size={18} color={colors.text} />
          </Pressable>

          <Pressable
            accessibilityLabel="Capture story photo"
            accessibilityRole="button"
            onPress={captureStory}
            style={({ pressed }) => [
              styles.shutterOuter,
              pressed ? styles.shutterPressed : null,
            ]}
          >
            <View style={styles.shutterInner} />
          </Pressable>

          <Pressable
            accessibilityLabel="Open photo gallery"
            accessibilityRole="button"
            onPress={() => setIsGalleryOpen(true)}
            style={({ pressed }) => [
              styles.secondaryControl,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons name="albums-outline" size={24} color={colors.text} />
          </Pressable>
        </View>

        <GalleryModal
          visible={isGalleryOpen}
          onClose={() => setIsGalleryOpen(false)}
          onSelect={chooseGalleryMedia}
        />
      </View>
    </SafeAreaView>
  )
}

function StoryHeaderPill({ thumbnailUri }: { thumbnailUri: string }) {
  return (
    <View style={styles.storyHeaderPill}>
      <View style={styles.storyHeaderThumbWrap}>
        <Image source={{ uri: thumbnailUri }} style={styles.storyHeaderThumb} />
      </View>
      <Text numberOfLines={1} style={styles.storyHeaderTitle}>
        New Story
      </Text>
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

function GalleryModal({
  onClose,
  onSelect,
  visible,
}: {
  onClose: () => void
  onSelect: (media: StoryMedia) => void
  visible: boolean
}) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.gallerySheetLayer}>
        <Pressable
          accessibilityLabel="Close gallery"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.galleryBackdrop}
        />
        <View style={styles.gallerySheet}>
          <View style={styles.galleryHeader}>
            <View>
              <Text style={styles.galleryTitle}>Camera Roll</Text>
              <Text style={styles.gallerySubtitle}>Choose a photo or video</Text>
            </View>
            <Pressable
              accessibilityLabel="Close gallery"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.galleryCloseButton}
            >
              <Ionicons name="close" size={20} color="#111827" />
            </Pressable>
          </View>

          <View style={styles.galleryGrid}>
            {galleryItems.map((media) => (
              <Pressable
                key={media.id}
                accessibilityRole="button"
                accessibilityLabel="Choose gallery item"
                onPress={() => onSelect(media)}
                style={({ pressed }) => [
                  styles.galleryItem,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Image source={{ uri: media.uri }} style={styles.galleryImage} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
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
  focusFrame: {
    position: "absolute",
    top: "36%",
    left: "24%",
    width: "52%",
    height: "22%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.54)",
  },
  cameraFacingLabel: {
    position: "absolute",
    top: "48%",
    alignSelf: "center",
    color: colors.mutedText,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  cameraTopBar: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  shutterPressed: {
    transform: [{ scale: 0.94 }],
  },
  secondaryControl: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.darkGlass,
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
  previewImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  videoPreviewPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#111827",
  },
  videoPreviewText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  previewShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  snapTopBar: {
    position: "absolute",
    top: 22,
    left: 22,
    right: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  snapCloseButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  storyHeaderPill: {
    flex: 1,
    maxWidth: 184,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(11,13,17,0.48)",
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
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
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 15,
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
  snapTextOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "47%",
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
  textMoveControls: {
    position: "absolute",
    left: 22,
    top: "37%",
    gap: 10,
    alignItems: "center",
  },
  textMoveButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(11,13,17,0.52)",
    alignItems: "center",
    justifyContent: "center",
  },
  textDoneButton: {
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  textDoneLabel: {
    color: colors.white,
    fontSize: 13,
    fontWeight: "700",
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
  gallerySheetLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  galleryBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  gallerySheet: {
    minHeight: 420,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.white,
    padding: 16,
  },
  galleryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  galleryTitle: {
    color: "#111827",
    fontSize: 22,
    fontWeight: "700",
  },
  gallerySubtitle: {
    marginTop: 2,
    color: "#6b7280",
    fontSize: 13,
  },
  galleryCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  galleryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  galleryItem: {
    width: "31.8%",
    aspectRatio: 0.75,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
  },
  galleryImage: {
    width: "100%",
    height: "100%",
  },
  pressed: {
    opacity: 0.72,
  },
})
