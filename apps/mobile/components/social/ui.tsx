import Ionicons from "@expo/vector-icons/Ionicons"
import * as ImagePicker from "expo-image-picker"
import { useRouter } from "expo-router"
import type {
  SocialDiscoverTile,
  SocialFollowingProfile,
  SocialStoryCard,
} from "@ubeye/shared"
import type { ReactElement, ReactNode } from "react"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import type { StyleProp, ViewStyle } from "react-native"
import type { DimensionValue } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useAuthFlow } from "@/lib/auth-flow"
import {
  getMobileApi,
  MobileApiError,
  normalizeMobileMediaUrl,
  postMobileFormApi,
} from "@/lib/mobile-api"

const colors = {
  background: "#f3f4f6",
  surface: "#ffffff",
  mutedSurface: "#f5f6f8",
  text: "#17191f",
  subtext: "#6b7280",
  faint: "#9ca3af",
  border: "#e5e7eb",
  purple: "#9333ea",
  purpleBadge: "#a53af7",
  dark: "#111827",
  danger: "#ef4444",
  accent: "#e01616",
  accentSoft: "rgba(224,22,22,0.22)",
}

const DISCOVER_CARD_HEIGHT = 220

type AccountMenuCreatorStats = {
  followerCount: number
  followingCount: number
  totalViews: number
  liveStories: number
  replies: number
  earnings: {
    totalCents: number
    pendingCents: number
    availableCents: number
    paidCents: number
    nextAvailableAt: string | null
  }
}

type ProfileAvatarResponse = {
  ok: true
  user: {
    email: string
    displayName: string | null
    handle: string | null
    avatarUrl: string | null
  }
}

type AccountAvatarButtonProps = {
  activeStoryCount?: number
  avatarUrl?: string | null
  displayName?: string | null
  email?: string | null
  handle?: string | null
  isProfilePhotoUploading?: boolean
  onProfilePhotoPress?: () => void
  unreadReplyCount?: number
}

export function ScreenFrame({
  children,
}: {
  children: ReactNode
}) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      {children}
    </SafeAreaView>
  )
}

export function ScreenScroll({
  children,
}: {
  children: ReactNode
}) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  )
}

export function MobileHomeHeader({
  activeStoryCount,
  displayName,
  email,
  handle,
  unreadReplyCount,
}: {
  activeStoryCount: number
  displayName: string
  email?: string | null
  handle: string
  unreadReplyCount: number
}) {
  const router = useRouter()

  return (
    <View style={styles.topBar}>
      <View style={[styles.headerCluster, styles.headerClusterLeft]}>
        <HeaderCircle
          accessibilityLabel="Search stories"
          onPress={() => router.push({ pathname: "/discover", params: { focus: "1" } })}
        >
          <Ionicons name="search-outline" size={24} color={colors.subtext} />
        </HeaderCircle>
      </View>

      <Text style={styles.appTitle}>Stories</Text>

      <View style={[styles.headerCluster, styles.headerClusterRight]}>
        <AccountAvatarButton
          activeStoryCount={activeStoryCount}
          displayName={displayName}
          email={email}
          handle={handle}
          unreadReplyCount={unreadReplyCount}
        />
      </View>
    </View>
  )
}

export function AccountAvatarButton({
  activeStoryCount = 0,
  avatarUrl,
  displayName,
  email,
  handle,
  isProfilePhotoUploading = false,
  onProfilePhotoPress,
  unreadReplyCount = 0,
}: AccountAvatarButtonProps) {
  const router = useRouter()
  const { account, expireSession, updateAccount } = useAuthFlow()
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [creatorStats, setCreatorStats] =
    useState<AccountMenuCreatorStats | null>(null)
  const [creatorStatsState, setCreatorStatsState] = useState<
    "idle" | "loading" | "settled"
  >("idle")
  const [creatorStatsError, setCreatorStatsError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    if (!isAccountMenuOpen || creatorStatsState !== "idle") {
      return
    }

    setCreatorStatsState("loading")
    getMobileApi<{ ok: true; stats: AccountMenuCreatorStats }>(
      "/api/mobile/creator/stats",
    )
      .then((payload) => {
        if (!isMounted) return
        setCreatorStats(payload.stats)
        setCreatorStatsError(null)
      })
      .catch((error) => {
        if (!isMounted) return
        setCreatorStatsError(
          error instanceof Error
            ? error.message
            : "Could not load creator payout information.",
        )
      })
      .finally(() => {
        if (isMounted) {
          setCreatorStatsState("settled")
        }
      })

    return () => {
      isMounted = false
    }
  }, [creatorStatsState, isAccountMenuOpen])

  const closeAccountMenu = () => setIsAccountMenuOpen(false)
  const resolvedDisplayName = displayName ?? account?.displayName ?? "Account"
  const resolvedEmail = email ?? account?.email
  const resolvedHandle = handle ?? account?.handle ?? "account"
  const resolvedAvatarUrl = normalizeMobileMediaUrl(avatarUrl ?? account?.avatarUrl)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const shouldShowAvatar = Boolean(
    resolvedAvatarUrl && failedAvatarUrl !== resolvedAvatarUrl,
  )
  const isAvatarUploading = isProfilePhotoUploading || isUploadingAvatar

  const chooseProfilePhoto = async () => {
    if (onProfilePhotoPress) {
      onProfilePhotoPress()
      return
    }

    if (isUploadingAvatar) {
      return
    }

    if (!account?.mobileToken) {
      expireSession()
      return
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      Alert.alert(
        "Photo library access needed",
        "Allow photo library access to choose a profile picture.",
      )
      return
    }

    let result: ImagePicker.ImagePickerResult

    try {
      result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        mediaTypes: ["images"],
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.86,
      })
    } catch (error) {
      Alert.alert(
        "Could not open photos",
        error instanceof Error
          ? error.message
          : "Close Expo Go and try choosing a profile picture again.",
      )
      return
    }

    if (result.canceled) {
      return
    }

    closeAccountMenu()

    const asset = result.assets[0]
    const formData = new FormData()
    const fileName =
      asset.fileName ??
      `profile-photo.${asset.mimeType?.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg"}`

    formData.append("avatar", {
      uri: asset.uri,
      name: fileName,
      type: asset.mimeType ?? "image/jpeg",
    } as unknown as Blob)

    setIsUploadingAvatar(true)

    try {
      const response = await postMobileFormApi<ProfileAvatarResponse>(
        "/api/mobile/account/avatar",
        formData,
        { authToken: account.mobileToken },
      )

      updateAccount({
        email: response.user.email,
        displayName: response.user.displayName ?? resolvedDisplayName,
        handle: response.user.handle ?? resolvedHandle,
        avatarUrl: response.user.avatarUrl,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not update profile photo."

      if (error instanceof MobileApiError && error.status === 401) {
        expireSession()
        Alert.alert(
          "Sign in again",
          "Your local app session expired. Sign in, then choose Profile picture again.",
        )
        return
      }

      Alert.alert("Could not update photo", message)
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  const changeProfilePhoto = () => {
    if (isAvatarUploading) {
      return
    }

    void chooseProfilePhoto()
  }

  return (
    <>
      <HeaderCircle
        accessibilityLabel="Open account menu"
        background={colors.accent}
        onPress={() => setIsAccountMenuOpen(true)}
      >
        {shouldShowAvatar && resolvedAvatarUrl ? (
          <Image
            onError={() => setFailedAvatarUrl(resolvedAvatarUrl)}
            source={{ uri: resolvedAvatarUrl }}
            style={styles.headerAvatarImage}
          />
        ) : (
          <Text style={styles.headerInitials}>
            {initials(resolvedDisplayName)}
          </Text>
        )}
      </HeaderCircle>

      <Modal
        animationType="fade"
        transparent
        visible={isAccountMenuOpen}
        onRequestClose={closeAccountMenu}
      >
        <View style={styles.accountMenuLayer}>
          <Pressable
            accessibilityLabel="Close account menu"
            accessibilityRole="button"
            onPress={closeAccountMenu}
            style={styles.accountMenuBackdrop}
          />
          <View style={styles.accountMenu}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.accountMenuScrollContent}
            >
              <View style={styles.accountMenuHeader}>
                <Pressable
                  accessibilityLabel="Change profile picture"
                  accessibilityRole="button"
                  disabled={isAvatarUploading}
                  onPress={changeProfilePhoto}
                  style={({ pressed }) => [
                    styles.accountMenuAvatar,
                    pressed ? styles.accountMenuAvatarPressed : null,
                  ]}
                >
                  {shouldShowAvatar && resolvedAvatarUrl ? (
                    <Image
                      onError={() => setFailedAvatarUrl(resolvedAvatarUrl)}
                      source={{ uri: resolvedAvatarUrl }}
                      style={styles.accountMenuAvatarImage}
                    />
                  ) : (
                    <Text style={styles.accountMenuInitials}>
                      {initials(resolvedDisplayName)}
                    </Text>
                  )}
                  <View style={styles.accountMenuAvatarEditBadge}>
                    {isAvatarUploading ? (
                      <ActivityIndicator size="small" color={colors.surface} />
                    ) : (
                      <Ionicons name="camera" size={13} color={colors.surface} />
                    )}
                  </View>
                </Pressable>
                <View style={styles.accountMenuIdentity}>
                  <Text style={styles.accountMenuName} numberOfLines={1}>
                    {resolvedDisplayName}
                  </Text>
                  <Text style={styles.accountMenuHandle} numberOfLines={1}>
                    @{resolvedHandle}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Close account menu"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={closeAccountMenu}
                  style={({ pressed }) => [
                    styles.accountMenuCloseButton,
                    pressed ? styles.accountMenuCloseButtonPressed : null,
                  ]}
                >
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              <View style={styles.accountSection}>
                <View style={styles.accountSectionHeader}>
                  <Text style={styles.accountSectionTitle}>Account</Text>
                </View>
                <View style={styles.accountMenuDetails}>
                  <AccountDetail label="Handle" value={`@${resolvedHandle}`} />
                  {resolvedEmail ? (
                    <AccountDetail label="Email" value={resolvedEmail} />
                  ) : null}
                  <AccountDetail
                    label="Followers"
                    value={formatCompactNumber(creatorStats?.followerCount ?? 0)}
                  />
                  <AccountDetail
                    label="Following"
                    value={formatCompactNumber(creatorStats?.followingCount ?? 0)}
                  />
                  <AccountDetail label="Live stories" value={`${activeStoryCount}`} />
                  <AccountDetail label="Unread replies" value={`${unreadReplyCount}`} />
                </View>
              </View>

              <Pressable
                accessibilityLabel="Open my story stats"
                accessibilityRole="button"
                onPress={() => {
                  closeAccountMenu()
                  router.push("/my-story-stats")
                }}
                style={({ pressed }) => [
                  styles.accountMenuAction,
                  pressed ? styles.accountMenuActionPressed : null,
                ]}
              >
                <Ionicons name="analytics-outline" size={19} color={colors.text} />
                <Text style={styles.accountMenuActionText}>
                  My Story Stats
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>

              <View style={styles.accountSection}>
                <View style={styles.accountSectionHeader}>
                  <Text style={styles.accountSectionTitle}>Creator payouts</Text>
                  {creatorStatsState === "loading" ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : null}
                </View>

                {creatorStatsError ? (
                  <Text style={styles.accountSectionError}>
                    {creatorStatsError}
                  </Text>
                ) : (
                  <>
                    <View style={styles.payoutSummaryGrid}>
                      <PayoutMetric
                        label="Available"
                        value={formatMoney(creatorStats?.earnings.availableCents ?? 0)}
                        tone="accent"
                      />
                      <PayoutMetric
                        label="Pending"
                        value={formatMoney(creatorStats?.earnings.pendingCents ?? 0)}
                      />
                      <PayoutMetric
                        label="Paid"
                        value={formatMoney(creatorStats?.earnings.paidCents ?? 0)}
                      />
                      <PayoutMetric
                        label="Lifetime"
                        value={formatMoney(creatorStats?.earnings.totalCents ?? 0)}
                      />
                    </View>
                    <View style={styles.payoutDetailCard}>
                      <AccountDetail
                        label="Story views"
                        value={formatCompactNumber(creatorStats?.totalViews ?? 0)}
                      />
                      <AccountDetail
                        label="Story replies"
                        value={formatCompactNumber(creatorStats?.replies ?? 0)}
                      />
                      <AccountDetail
                        label="Next available"
                        value={formatAvailability(
                          creatorStats?.earnings.nextAvailableAt ?? null,
                        )}
                      />
                    </View>
                  </>
                )}
              </View>

              <Pressable
                accessibilityLabel="Open creator analytics"
                accessibilityRole="button"
                onPress={() => {
                  closeAccountMenu()
                  router.push("/creator-stats")
                }}
                style={({ pressed }) => [
                  styles.accountMenuAction,
                  pressed ? styles.accountMenuActionPressed : null,
                ]}
              >
                <Ionicons name="wallet-outline" size={19} color={colors.text} />
                <Text style={styles.accountMenuActionText}>
                  Earnings and payouts
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}

function PayoutMetric({
  label,
  tone,
  value,
}: {
  label: string
  tone?: "accent"
  value: string
}) {
  return (
    <View style={styles.payoutMetric}>
      <Text style={styles.payoutMetricLabel}>{label}</Text>
      <Text
        style={[
          styles.payoutMetricValue,
          tone === "accent" ? styles.payoutMetricValueAccent : null,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

function AccountDetail({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <View style={styles.accountDetail}>
      <Text style={styles.accountDetailLabel}>{label}</Text>
      <Text style={styles.accountDetailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

function HeaderCircle({
  children,
  background = colors.mutedSurface,
  accessibilityLabel,
  onPress,
}: {
  children: ReactNode
  background?: string
  accessibilityLabel?: string
  onPress?: () => void
}) {
  const style = [styles.headerCircle, { backgroundColor: background }]

  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          ...style,
          pressed ? styles.headerCirclePressed : null,
        ]}
      >
        {children}
      </Pressable>
    )
  }

  return <View style={style}>{children}</View>
}

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <View style={styles.screenHeader}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.screenTitle}>{title}</Text>
        {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  )
}

export function DiscoverHeader() {
  return (
    <View style={styles.discoverHeader}>
      <View style={styles.discoverHeaderTop}>
        <Text style={styles.screenTitle}>Discover</Text>
        <View style={styles.peopleSearch}>
          <Ionicons name="search-outline" size={18} color={colors.subtext} />
          <TextInput
            style={styles.peopleSearchInput}
            placeholder="Search people"
            placeholderTextColor={colors.subtext}
            returnKeyType="search"
          />
        </View>
      </View>
      <Text style={styles.screenSubtitle}>
        A dedicated native surface for stories from people you do not already follow.
      </Text>
    </View>
  )
}

export function SectionTitle({
  onPress,
  title,
  withChevron = true,
  compact = false,
}: {
  onPress?: () => void
  title: string
  withChevron?: boolean
  compact?: boolean
}) {
  const content = (
    <>
      <Text style={[styles.sectionTitle, compact ? styles.sectionTitleCompact : null]}>
        {title}
      </Text>
      {withChevron ? (
        <Ionicons
          name="chevron-forward"
          size={compact ? 18 : 22}
          color="#c0c4cb"
        />
      ) : null}
    </>
  )

  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={`Open ${title}`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.sectionTitleRow,
          pressed ? styles.sectionTitleRowPressed : null,
        ]}
      >
        {content}
      </Pressable>
    )
  }

  return (
    <View style={styles.sectionTitleRow}>
      {content}
    </View>
  )
}

export function FollowingStrip({
  profiles,
}: {
  profiles: SocialFollowingProfile[]
}) {
  return (
    <FlatList
      data={profiles}
      horizontal
      keyExtractor={(profile) => profile.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.followingStrip}
      initialNumToRender={6}
      maxToRenderPerBatch={8}
      windowSize={5}
      renderItem={({ item: profile }) => (
        <View style={styles.followingBubble}>
          <View style={styles.followingRing}>
            <Image source={{ uri: profile.imageUrl }} style={styles.followingImage} />
            <View style={styles.followingBadge}>
              <Ionicons name="checkmark" size={16} color="#fff" />
            </View>
          </View>
          <Text style={styles.followingName} numberOfLines={1}>
            {profile.name}
          </Text>
          <Text style={styles.followingHandle} numberOfLines={1}>
            @{profile.handle}
          </Text>
        </View>
      )}
    />
  )
}

export function StoryRail({
  stories,
}: {
  stories: SocialStoryCard[]
}) {
  return (
    <FlatList
      data={stories}
      horizontal
      keyExtractor={(story) => story.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.storyRail}
      initialNumToRender={4}
      maxToRenderPerBatch={5}
      windowSize={5}
      renderItem={({ item }) => <StoryCard story={item} compact />}
    />
  )
}

type MyStoryPreview = {
  hasActiveStory: boolean
  latestThumbnailUrl: string | null
  latestAssetKind: "image" | "video" | null
  latestTextOverlays?: Array<{
    id: string
    label: string
    positionX: number
    positionY: number
  }>
  owner: {
    name: string
    handle: string
    imageUrl: string | null
  }
}

export function FollowingPreviewRail({
  myStory,
  stories,
}: {
  myStory?: MyStoryPreview | null
  stories: SocialStoryCard[]
}) {
  const router = useRouter()
  const hasActiveMyStory = Boolean(myStory?.hasActiveStory)
  const myStoryPreviewUrl = normalizeMobileMediaUrl(myStory?.latestThumbnailUrl)

  return (
    <FlatList
      data={stories}
      horizontal
      keyExtractor={(story) => story.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.followingPreviewRail}
      initialNumToRender={4}
      maxToRenderPerBatch={5}
      windowSize={5}
      ListHeaderComponent={hasActiveMyStory ? (
        <View style={[styles.followingPreviewCard, styles.myStoryPreviewCard]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open your story"
            onPress={() => router.push("/story/my-story")}
            style={({ pressed }) => [
              styles.followingPreviewPressable,
              pressed ? styles.followingPreviewPressed : null,
            ]}
          >
            {myStoryPreviewUrl ? (
              <StoryVisual
                assetKind={myStory?.latestAssetKind ?? "image"}
                mediaUrl={myStoryPreviewUrl}
                thumbnailUrl={myStoryPreviewUrl}
                title="My Story"
              />
            ) : (
              <View style={styles.myStoryEmptyPreview} />
            )}
            <View style={styles.followingPreviewOverlay} />
            <StoryVisualTextOverlays
              textOverlays={myStory?.latestTextOverlays ?? []}
              compact
            />
            {myStory?.latestAssetKind === "video" && myStoryPreviewUrl ? (
              <View style={styles.myStoryVideoBadge}>
                <Ionicons name="play" size={12} color="#fff" />
              </View>
            ) : null}
            <View style={styles.myStoryAddBadge}>
              <Ionicons name="add" size={16} color="#fff" />
            </View>

            <View style={styles.followingPreviewFooter}>
              <View style={[styles.followingPreviewIndicator, styles.myStoryPreviewIndicator]}>
                <View style={styles.followingPreviewIndicatorDot} />
              </View>
              <Text
                style={styles.followingPreviewName}
                numberOfLines={1}
                ellipsizeMode="tail"
                allowFontScaling={false}
              >
                My Story
              </Text>
            </View>
          </Pressable>
        </View>
      ) : null}
      renderItem={({ item: story }) => {
        const isMyStory = story.id === "my-story"

        return (
          <View
            key={story.id}
            style={[
              styles.followingPreviewCard,
              isMyStory ? styles.myStoryPreviewCard : null,
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isMyStory ? "Open story camera" : `Open ${story.creator} story`
              }
              onPress={() =>
                isMyStory ? router.push("/post") : router.push(`/story/${story.id}`)
              }
              style={({ pressed }) => [
                styles.followingPreviewPressable,
                pressed ? styles.followingPreviewPressed : null,
              ]}
            >
              <StoryVisual
                assetKind={story.assetKind}
                mediaUrl={story.mediaUrl}
                thumbnailUrl={story.thumbnailUrl}
                title={story.creator}
              />
              <View style={styles.followingPreviewOverlay} />
              <StoryVisualTextOverlays
                textOverlays={story.textOverlays ?? []}
                compact
              />

              {isMyStory ? (
                <View style={styles.myStoryAddBadge}>
                  <Ionicons name="add" size={16} color="#fff" />
                </View>
              ) : null}

              <View style={styles.followingPreviewFooter}>
                <View
                  style={[
                    styles.followingPreviewIndicator,
                    isMyStory ? styles.myStoryPreviewIndicator : null,
                  ]}
                >
                  <View style={styles.followingPreviewIndicatorDot} />
                </View>
                <Text
                  style={styles.followingPreviewName}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  allowFontScaling={false}
                >
                  {story.creator}
                </Text>
              </View>
            </Pressable>
          </View>
        )
      }}
    />
  )
}

export function StoryList({
  ListHeaderComponent,
  contentContainerStyle,
  showStoryTitle = true,
  stories,
}: {
  ListHeaderComponent?: ReactElement
  contentContainerStyle?: StyleProp<ViewStyle>
  showStoryTitle?: boolean
  stories: SocialStoryCard[]
}) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.storyList, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
    >
      {ListHeaderComponent ? (
        <View style={styles.storyListHeader}>{ListHeaderComponent}</View>
      ) : null}
      {stories.map((story, index) => (
        <View key={story.id}>
          {index > 0 ? <StoryListSeparator /> : null}
          <StoryCard story={story} showTitle={showStoryTitle} />
        </View>
      ))}
    </ScrollView>
  )
}

function StoryListSeparator() {
  return <View style={styles.storyListSeparator} />
}

function StoryCard({
  story,
  compact = false,
  showTitle = true,
}: {
  story: SocialStoryCard
  compact?: boolean
  showTitle?: boolean
}) {
  const router = useRouter()

  return (
    <Pressable
      accessibilityLabel={`Open ${story.creator} story`}
      accessibilityRole="button"
      onPress={() => router.push(`/story/${story.id}`)}
      style={({ pressed }) => [
        styles.storyCard,
        compact ? styles.storyCardCompact : styles.storyCardFull,
        pressed ? styles.storyCardPressed : null,
      ]}
    >
      <StoryVisual
        assetKind={story.assetKind}
        mediaUrl={story.mediaUrl}
        thumbnailUrl={story.thumbnailUrl}
        title={story.title}
      />
      <View style={styles.storyOverlay} />
      <StoryVisualTextOverlays textOverlays={story.textOverlays ?? []} />

      <Pressable
        accessibilityLabel={`Open ${story.creator} profile`}
        accessibilityRole="button"
        onPress={(event) => {
          event.stopPropagation()
          router.push(`/creator/${story.id}`)
        }}
        style={({ pressed }) => [
          styles.storyAvatar,
          pressed ? styles.storyAvatarPressed : null,
        ]}
      >
        <Text style={styles.storyAvatarText}>{initials(story.creator)}</Text>
      </Pressable>

      <View style={styles.storyFooter}>
        {showTitle ? (
          <Text style={styles.storyTitle} numberOfLines={4}>
            {story.title}
          </Text>
        ) : null}
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${story.progressPercent}%`,
                backgroundColor: compact ? colors.accent : "#d8b4fe",
              },
            ]}
          />
        </View>
      </View>
    </Pressable>
  )
}

export function DiscoverMosaic({
  ListHeaderComponent,
  contentContainerStyle,
  tiles,
}: {
  ListHeaderComponent?: ReactElement
  contentContainerStyle?: StyleProp<ViewStyle>
  tiles: SocialDiscoverTile[]
}) {
  return (
    <DiscoverTileList
      ListHeaderComponent={ListHeaderComponent}
      contentContainerStyle={contentContainerStyle}
      tiles={tiles}
    />
  )
}

export function DiscoverGrid({
  ListHeaderComponent,
  contentContainerStyle,
  tiles,
}: {
  ListHeaderComponent?: ReactElement
  contentContainerStyle?: StyleProp<ViewStyle>
  tiles: SocialDiscoverTile[]
}) {
  return (
    <DiscoverTileList
      ListHeaderComponent={ListHeaderComponent}
      contentContainerStyle={contentContainerStyle}
      tiles={tiles}
    />
  )
}

function DiscoverTileList({
  ListHeaderComponent,
  contentContainerStyle,
  tiles,
}: {
  ListHeaderComponent?: ReactElement
  contentContainerStyle?: StyleProp<ViewStyle>
  tiles: SocialDiscoverTile[]
}) {
  const rows: SocialDiscoverTile[][] = []

  for (let index = 0; index < tiles.length; index += 2) {
    rows.push(tiles.slice(index, index + 2))
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.discoverListContent, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {ListHeaderComponent}
      {rows.map((row) => (
        <View key={row.map((tile) => tile.id).join(":")} style={styles.discoverGridRow}>
          {row.map((tile) => (
            <View key={tile.id} style={styles.discoverGridItem}>
              <DiscoverCard tile={tile} height={DISCOVER_CARD_HEIGHT} />
            </View>
          ))}
          {row.length === 1 ? (
            <View style={[styles.discoverGridItem, styles.discoverGridSpacer]} />
          ) : null}
        </View>
      ))}
    </ScrollView>
  )
}

function DiscoverCard({
  tile,
  height,
}: {
  tile: SocialDiscoverTile
  height: number
}) {
  const router = useRouter()

  return (
    <Pressable
      accessibilityLabel={`Open ${tile.title} story`}
      accessibilityRole="button"
      onPress={() => router.push(`/story/${tile.id}`)}
      style={({ pressed }) => [
        styles.discoverCard,
        { height },
        pressed ? styles.discoverCardPressed : null,
      ]}
    >
      <StoryVisual
        assetKind={tile.assetKind}
        mediaUrl={tile.imageUrl}
        thumbnailUrl={tile.thumbnailUrl}
        title={tile.title}
      />
      <View style={styles.discoverOverlay} />
      <View style={styles.discoverFooter}>
        <Text style={styles.discoverTitle} numberOfLines={4}>
          {tile.title}
        </Text>
      </View>
    </Pressable>
  )
}

export function ComposerCard({
  handle,
}: {
  handle: string
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeaderRow}>
        <View>
          <Text style={styles.panelTitle}>Post a story</Text>
          <Text style={styles.panelHandle}>@{handle}</Text>
        </View>
        <View style={styles.livePill}>
          <Text style={styles.livePillText}>24h live</Text>
        </View>
      </View>

      <InputGroup label="Media">
        <View style={styles.filePickerMock}>
          <Ionicons name="image-outline" size={16} color={colors.subtext} />
          <Text style={styles.filePickerText}>Choose photo or video</Text>
        </View>
      </InputGroup>

      <InputGroup label="Caption">
        <TextInput
          style={[styles.textInput, styles.textArea]}
          placeholder="Drop the hook, scene, or story text."
          placeholderTextColor={colors.faint}
          multiline
          textAlignVertical="top"
        />
      </InputGroup>

      <InputGroup label="Brand tags">
        <TextInput
          style={styles.textInput}
          placeholder="nike, marriott, local-run-club"
          placeholderTextColor={colors.faint}
        />
      </InputGroup>

      <Pressable style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Share story</Text>
      </Pressable>
    </View>
  )
}

function InputGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      {children}
    </View>
  )
}

export function SuggestedAccountsList({
  people,
}: {
  people: SocialFollowingProfile[]
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeaderRow}>
        <View>
          <Text style={styles.panelTitle}>Suggested accounts</Text>
          <Text style={styles.panelSubtext}>Follow people you want in your story feed</Text>
        </View>
        <Ionicons name="grid-outline" size={18} color={colors.faint} />
      </View>

      <View style={styles.suggestedList}>
        {people.map((person) => (
          <View key={person.id} style={styles.suggestedRow}>
            <View style={styles.suggestedIdentity}>
              <View style={styles.suggestedAvatar}>
                <Text style={styles.suggestedAvatarText}>{initials(person.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestedName}>{person.name}</Text>
                <Text style={styles.suggestedHandle}>@{person.handle}</Text>
              </View>
            </View>
            <Pressable style={styles.suggestedButton}>
              <Text style={styles.suggestedButtonText}>Follow</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  )
}

export function NotePanel({
  title,
  items,
}: {
  title: string
  items: string[]
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      <View style={styles.noteList}>
        {items.map((item) => (
          <View key={item} style={styles.noteRow}>
            <View style={styles.noteDot} />
            <Text style={styles.noteText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function StoryVisual({
  assetKind,
  mediaUrl,
  thumbnailUrl,
  title,
}: {
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  title: string
}) {
  const source = normalizeMobileMediaUrl(
    assetKind === "image" ? mediaUrl : thumbnailUrl,
  )

  if (source) {
    return (
      <Image
        key={source}
        source={{ uri: source }}
        style={styles.absoluteFill}
        resizeMode="cover"
        accessibilityLabel={title}
      />
    )
  }

  return (
    <View style={[styles.absoluteFill, styles.videoFallback]}>
      <Ionicons name="play" size={28} color="#fff" />
    </View>
  )
}

function StoryVisualTextOverlays({
  compact = false,
  textOverlays,
}: {
  compact?: boolean
  textOverlays: Array<{
    id: string
    label: string
    positionX: number
    positionY: number
  }>
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0 })
  const shortestSide =
    layout.width > 0 && layout.height > 0
      ? Math.min(layout.width, layout.height)
      : compact
        ? 126
        : 280
  const fontSize = Math.round(
    compact
      ? Math.min(Math.max(shortestSide * 0.07, 7), 10)
      : Math.min(Math.max(shortestSide * 0.052, 12), 17),
  )
  const lineHeight = Math.round(fontSize * 1.18)
  const minHeight = Math.round(fontSize * 1.65)
  const paddingHorizontal = Math.round(fontSize * 0.52)
  const paddingVertical = Math.max(1, Math.round(fontSize * 0.16))

  const handleLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout

    setLayout((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    )
  }

  return (
    <View
      pointerEvents="none"
      style={styles.storyVisualTextLayer}
      onLayout={handleLayout}
    >
      {textOverlays.slice(0, 2).map((overlay) => (
        <View
          key={overlay.id}
          style={[
            styles.storyVisualTextOverlay,
            {
              minHeight,
              paddingHorizontal,
              paddingVertical,
              top: `${Math.min(Math.max(overlay.positionY, 12), 86)}%` as DimensionValue,
            },
          ]}
        >
          <Text
            style={[
              styles.storyVisualText,
              {
                fontSize,
                lineHeight,
              },
            ]}
            numberOfLines={2}
          >
            {overlay.label}
          </Text>
        </View>
      ))}
    </View>
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

function formatMoney(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatCompactNumber(value: number) {
  return Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function formatAvailability(value: string | null) {
  if (!value) {
    return "No scheduled payout"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "No scheduled payout"
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 8,
    gap: 24,
  },
  topBar: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    minHeight: 48,
    position: "relative",
  },
  headerCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerClusterLeft: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
  headerClusterRight: {
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  headerCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
    overflow: "hidden",
  },
  headerCirclePressed: {
    opacity: 0.72,
  },
  headerInitials: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.surface,
  },
  headerAvatarImage: {
    width: "100%",
    height: "100%",
  },
  appTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.text,
  },
  accountMenuLayer: {
    flex: 1,
  },
  accountMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,24,39,0.16)",
  },
  accountMenu: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 58,
    maxHeight: "86%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.08)",
    backgroundColor: colors.surface,
    shadowColor: "#111827",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 12,
  },
  accountMenuScrollContent: {
    padding: 16,
  },
  accountMenuHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  accountMenuAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  accountMenuAvatarPressed: {
    opacity: 0.72,
  },
  accountMenuAvatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 29,
  },
  accountMenuInitials: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.surface,
  },
  accountMenuAvatarEditBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dark,
  },
  accountMenuIdentity: {
    flex: 1,
    minWidth: 0,
  },
  accountMenuCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
  },
  accountMenuCloseButtonPressed: {
    opacity: 0.7,
  },
  accountMenuName: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
  },
  accountMenuHandle: {
    marginTop: 2,
    fontSize: 17,
    color: colors.subtext,
  },
  accountSection: {
    marginTop: 16,
  },
  accountSectionHeader: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  accountSectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },
  accountSectionError: {
    marginTop: 8,
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: colors.danger,
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  accountMenuDetails: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    paddingHorizontal: 12,
  },
  accountDetail: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(17,24,39,0.08)",
  },
  accountDetailLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.subtext,
  },
  accountDetailValue: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  payoutSummaryGrid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  payoutMetric: {
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 74,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "space-between",
    backgroundColor: colors.surface,
  },
  payoutMetricLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.subtext,
  },
  payoutMetricValue: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
  },
  payoutMetricValueAccent: {
    color: colors.accent,
  },
  payoutDetailCard: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    paddingHorizontal: 12,
  },
  accountMenuAction: {
    marginTop: 16,
    minHeight: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.08)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
  },
  accountMenuActionPressed: {
    opacity: 0.76,
  },
  accountMenuActionText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  screenHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  eyebrow: {
    fontSize: 13,
    color: colors.subtext,
    marginBottom: 6,
  },
  screenTitle: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.text,
  },
  screenSubtitle: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 22,
    color: colors.subtext,
  },
  discoverHeader: {
    gap: 8,
  },
  discoverHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  peopleSearch: {
    width: 168,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  peopleSearchInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: 14,
    color: colors.text,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitleRowPressed: {
    opacity: 0.72,
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.text,
  },
  sectionTitleCompact: {
    fontSize: 20,
  },
  followingStrip: {
    gap: 18,
    paddingBottom: 4,
  },
  followingBubble: {
    width: 92,
    alignItems: "center",
  },
  followingRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    padding: 4,
    borderWidth: 3,
    borderColor: colors.purple,
    backgroundColor: colors.surface,
  },
  followingImage: {
    width: "100%",
    height: "100%",
    borderRadius: 40,
  },
  followingBadge: {
    position: "absolute",
    bottom: -8,
    left: 18,
    right: 18,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.purpleBadge,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  followingName: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  followingHandle: {
    marginTop: 2,
    fontSize: 13,
    color: colors.faint,
  },
  storyRail: {
    gap: 12,
    paddingBottom: 4,
  },
  followingPreviewRail: {
    gap: 10,
    paddingBottom: 4,
  },
  followingPreviewCard: {
    width: 126,
    height: 188,
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: "#d1d5db",
  },
  followingPreviewPressable: {
    flex: 1,
  },
  followingPreviewPressed: {
    opacity: 0.78,
  },
  followingPreviewImage: {
    width: "100%",
    height: "100%",
  },
  myStoryPreviewCard: {
    borderWidth: 2,
    borderColor: colors.dark,
  },
  myStoryEmptyPreview: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
  },
  myStoryAddBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.dark,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  myStoryVideoBadge: {
    position: "absolute",
    top: 42,
    right: 11,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(17,24,39,0.78)",
    alignItems: "center",
    justifyContent: "center",
  },
  followingPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,24,39,0.3)",
  },
  followingPreviewFooter: {
    position: "absolute",
    left: 8,
    right: 4,
    bottom: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  followingPreviewIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  followingPreviewIndicatorDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.accent,
  },
  myStoryPreviewIndicator: {
    backgroundColor: "rgba(17,24,39,0.28)",
  },
  followingPreviewName: {
    fontSize: 13,
    lineHeight: 14,
    fontWeight: "700",
    color: "#fff",
    flex: 1,
  },
  storyList: {
    paddingBottom: 32,
  },
  storyListHeader: {
    marginBottom: 24,
  },
  storyListSeparator: {
    height: 14,
  },
  storyCard: {
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: "#e5e7eb",
  },
  storyCardPressed: {
    opacity: 0.82,
  },
  storyCardCompact: {
    width: 172,
    height: 292,
  },
  storyCardFull: {
    height: 280,
  },
  absoluteFill: {
    ...StyleSheet.absoluteFillObject,
  },
  videoFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f2937",
  },
  storyVisualTextLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  storyVisualTextOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,13,17,0.42)",
  },
  storyVisualText: {
    color: "#fff",
    fontWeight: "800",
    textAlign: "center",
  },
  storyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,24,39,0.42)",
  },
  storyAvatar: {
    position: "absolute",
    top: 12,
    left: 12,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 3,
    borderColor: colors.danger,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  storyAvatarPressed: {
    opacity: 0.78,
  },
  storyAvatarImage: {
    width: "100%",
    height: "100%",
  },
  storyAvatarText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },
  storyFooter: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
  },
  storyTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "700",
    color: "#fff",
  },
  progressTrack: {
    marginTop: 12,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.28)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  discoverListContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 8,
  },
  discoverGridRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  discoverGridItem: {
    width: "48.2%",
    marginBottom: 12,
  },
  discoverGridSpacer: {
    opacity: 0,
  },
  discoverCard: {
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: "#e5e7eb",
  },
  discoverCardPressed: {
    opacity: 0.82,
  },
  discoverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,24,39,0.34)",
  },
  discoverFooter: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
  },
  discoverTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "700",
    color: "#fff",
  },
  panel: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 16,
  },
  panelHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  panelHandle: {
    marginTop: 2,
    fontSize: 14,
    color: colors.subtext,
  },
  panelSubtext: {
    marginTop: 4,
    fontSize: 14,
    color: colors.subtext,
  },
  livePill: {
    borderRadius: 999,
    backgroundColor: colors.mutedSurface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  livePillText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.subtext,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
  },
  filePickerMock: {
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
  },
  filePickerText: {
    fontSize: 14,
    color: colors.subtext,
  },
  textInput: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  textArea: {
    minHeight: 120,
  },
  primaryButton: {
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.dark,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  suggestedList: {
    gap: 12,
  },
  suggestedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  suggestedIdentity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  suggestedAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  suggestedAvatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  suggestedName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  suggestedHandle: {
    marginTop: 2,
    fontSize: 13,
    color: colors.subtext,
  },
  suggestedButton: {
    borderRadius: 999,
    backgroundColor: colors.dark,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  suggestedButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  noteList: {
    marginTop: 12,
    gap: 12,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  noteDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    backgroundColor: colors.dark,
  },
  noteText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.subtext,
  },
})
