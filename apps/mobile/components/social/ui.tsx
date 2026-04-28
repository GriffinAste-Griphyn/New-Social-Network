import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"
import type {
  SocialDiscoverTile,
  SocialFollowingProfile,
  SocialStoryCard,
} from "@new-social-network/shared"
import type { ComponentProps, ReactNode } from "react"
import { useState } from "react"
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

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
  handle,
  unreadReplyCount,
}: {
  activeStoryCount: number
  displayName: string
  handle: string
  unreadReplyCount: number
}) {
  const router = useRouter()
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)

  const openRoute = (route: "/profile" | "/post" | "/replies") => {
    setIsAccountMenuOpen(false)
    router.push(route)
  }

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
        <HeaderCircle
          accessibilityLabel="Open account menu"
          background={colors.accent}
          onPress={() => setIsAccountMenuOpen(true)}
        >
          <Text style={styles.headerInitials}>{initials(displayName)}</Text>
        </HeaderCircle>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={isAccountMenuOpen}
        onRequestClose={() => setIsAccountMenuOpen(false)}
      >
        <View style={styles.accountMenuLayer}>
          <Pressable
            accessibilityLabel="Close account menu"
            accessibilityRole="button"
            onPress={() => setIsAccountMenuOpen(false)}
            style={styles.accountMenuBackdrop}
          />
          <View style={styles.accountMenu}>
            <View style={styles.accountMenuHeader}>
              <View style={styles.accountMenuAvatar}>
                <Text style={styles.accountMenuInitials}>
                  {initials(displayName)}
                </Text>
              </View>
              <View style={styles.accountMenuIdentity}>
                <Text style={styles.accountMenuName} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={styles.accountMenuHandle} numberOfLines={1}>
                  @{handle}
                </Text>
              </View>
            </View>

            <View style={styles.accountMenuStats}>
              <AccountStat label="Account" value="Unified" />
              <AccountStat
                label="Stories"
                value={`${activeStoryCount} live`}
              />
              <AccountStat
                label="Replies"
                value={`${unreadReplyCount} unread`}
              />
            </View>

            <View style={styles.accountMenuActions}>
              <AccountMenuAction
                icon="person-circle-outline"
                label="View profile"
                onPress={() => openRoute("/profile")}
              />
              <AccountMenuAction
                icon="add-circle-outline"
                label="Post a story"
                onPress={() => openRoute("/post")}
              />
              <AccountMenuAction
                icon="file-tray-full-outline"
                label="Story replies"
                onPress={() => openRoute("/replies")}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function AccountStat({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <View style={styles.accountStat}>
      <Text style={styles.accountStatValue}>{value}</Text>
      <Text style={styles.accountStatLabel}>{label}</Text>
    </View>
  )
}

function AccountMenuAction({
  icon,
  label,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"]
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.accountMenuAction,
        pressed ? styles.accountMenuActionPressed : null,
      ]}
    >
      <View style={styles.accountMenuActionIcon}>
        <Ionicons name={icon} size={18} color={colors.text} />
      </View>
      <Text style={styles.accountMenuActionText}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.faint} />
    </Pressable>
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.followingStrip}>
      {profiles.map((profile) => (
        <View key={profile.id} style={styles.followingBubble}>
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
      ))}
    </ScrollView>
  )
}

export function StoryRail({
  stories,
}: {
  stories: SocialStoryCard[]
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyRail}>
      {stories.map((story) => (
        <StoryCard key={story.id} story={story} compact />
      ))}
    </ScrollView>
  )
}

type MyStoryPreview = {
  hasActiveStory: boolean
  latestThumbnailUrl: string | null
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

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.followingPreviewRail}
    >
      <View style={[styles.followingPreviewCard, styles.myStoryPreviewCard]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            hasActiveMyStory ? "Open your story" : "Upload to your story"
          }
          onPress={() => router.push(hasActiveMyStory ? "/story/my-story" : "/post")}
          style={({ pressed }) => [
            styles.followingPreviewPressable,
            pressed ? styles.followingPreviewPressed : null,
          ]}
        >
          {myStory?.hasActiveStory && myStory.latestThumbnailUrl ? (
            <Image
              source={{ uri: myStory.latestThumbnailUrl }}
              style={styles.followingPreviewImage}
            />
          ) : (
            <View style={styles.myStoryEmptyPreview}>
              <View style={styles.myStoryEmptyIcon}>
                <Ionicons name="add" size={24} color="#fff" />
              </View>
            </View>
          )}
          <View style={styles.followingPreviewOverlay} />
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

      {stories.map((story) => {
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
      })}
    </ScrollView>
  )
}

export function StoryList({
  stories,
}: {
  stories: SocialStoryCard[]
}) {
  return (
    <View style={styles.storyList}>
      {stories.map((story) => (
        <StoryCard key={story.id} story={story} />
      ))}
    </View>
  )
}

function StoryCard({
  story,
  compact = false,
}: {
  story: SocialStoryCard
  compact?: boolean
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
        <Text style={styles.storyTitle} numberOfLines={4}>
          {story.title}
        </Text>
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
  tiles,
}: {
  tiles: SocialDiscoverTile[]
}) {
  return (
    <View style={styles.discoverMosaic}>
      {tiles.map((tile) => (
        <View key={tile.id} style={styles.discoverGridItem}>
          <DiscoverCard tile={tile} height={DISCOVER_CARD_HEIGHT} />
        </View>
      ))}
    </View>
  )
}

export function DiscoverGrid({
  tiles,
}: {
  tiles: SocialDiscoverTile[]
}) {
  return (
    <View style={styles.discoverGrid}>
      {tiles.map((tile) => (
        <View key={tile.id} style={styles.discoverGridItem}>
          <DiscoverCard tile={tile} height={DISCOVER_CARD_HEIGHT} />
        </View>
      ))}
    </View>
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
        {tile.subtitle ? (
          <Text style={styles.discoverSubtitle}>{tile.subtitle}</Text>
        ) : null}
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
  const source = assetKind === "image" ? mediaUrl : thumbnailUrl

  if (source) {
    return (
      <Image
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
  },
  headerCirclePressed: {
    opacity: 0.72,
  },
  headerInitials: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.surface,
  },
  appTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
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
    right: 16,
    top: 58,
    width: 306,
    maxWidth: "92%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.08)",
    backgroundColor: colors.surface,
    padding: 14,
    shadowColor: "#111827",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 12,
  },
  accountMenuHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  accountMenuAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  accountMenuInitials: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.surface,
  },
  accountMenuIdentity: {
    flex: 1,
    minWidth: 0,
  },
  accountMenuName: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  accountMenuHandle: {
    marginTop: 2,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: colors.subtext,
  },
  accountMenuStats: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  accountStat: {
    flex: 1,
    minHeight: 58,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  accountStatValue: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  accountStatLabel: {
    marginTop: 3,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: colors.subtext,
  },
  accountMenuActions: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  accountMenuAction: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  accountMenuActionPressed: {
    backgroundColor: colors.mutedSurface,
  },
  accountMenuActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mutedSurface,
  },
  accountMenuActionText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  screenHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  eyebrow: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: colors.subtext,
    marginBottom: 6,
  },
  screenTitle: {
    fontSize: 34,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.text,
  },
  screenSubtitle: {
    marginTop: 6,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.text,
  },
  sectionTitleCompact: {
    fontSize: 20,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  followingHandle: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
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
  myStoryEmptyIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dark,
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
  followingPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,24,39,0.18)",
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
    fontFamily: "Inter_400Regular",
    lineHeight: 14,
    fontWeight: "700",
    color: "#fff",
    flex: 1,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  storyList: {
    gap: 14,
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
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_700Bold",
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
  discoverMosaic: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  discoverGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  discoverGridItem: {
    width: "48.2%",
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
    backgroundColor: "rgba(17,24,39,0.26)",
  },
  discoverFooter: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
  },
  discoverSubtitle: {
    marginBottom: 6,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#f3f4f6",
  },
  discoverTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  panelHandle: {
    marginTop: 2,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: colors.subtext,
  },
  panelSubtext: {
    marginTop: 4,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: colors.subtext,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    marginBottom: 8,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
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
    fontFamily: "Inter_400Regular",
    color: colors.subtext,
  },
  textInput: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  suggestedName: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  suggestedHandle: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    color: colors.subtext,
  },
})
