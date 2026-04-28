import type { ReactNode } from "react"
import { useRouter } from "expo-router"
import { useAuthFlow } from "@/lib/auth-flow"
import { useFollowState } from "@/lib/follow-state"
import { useMobileFeed } from "@/lib/mobile-stories-api"
import {
  DiscoverMosaic,
  FollowingPreviewRail,
  MobileHomeHeader,
  ScreenFrame,
  ScreenScroll,
  SectionTitle,
} from "@/components/social/ui"

export default function HomeScreen() {
  const router = useRouter()
  const { account } = useAuthFlow()
  const { revision } = useFollowState()
  const liveFeed = useMobileFeed(account?.mobileToken, revision)
  const followedStories = liveFeed.data?.followingStories ?? []
  const discoverTiles = liveFeed.data?.discoverTiles ?? []
  const myStory = liveFeed.data?.myStory ?? null
  const session = liveFeed.data?.session ?? account
  const activeStoryCount = myStory?.liveCount ?? followedStories.length

  return (
    <ScreenFrame>
      <ScreenScroll>
        <MobileHomeHeader
          activeStoryCount={activeStoryCount}
          displayName={session?.displayName ?? "Account"}
          handle={session?.handle ?? "account"}
          unreadReplyCount={0}
        />

        <Section
          title="Following"
          compact
          onPress={() => router.push("/following")}
        >
          <FollowingPreviewRail myStory={myStory} stories={followedStories} />
        </Section>

        <Section title="Discover" withChevron={false} compact>
          <DiscoverMosaic tiles={discoverTiles} />
        </Section>
      </ScreenScroll>
    </ScreenFrame>
  )
}

function Section({
  title,
  onPress,
  withChevron = true,
  compact = false,
  children,
}: {
  title: string
  onPress?: () => void
  withChevron?: boolean
  compact?: boolean
  children: ReactNode
}) {
  return (
    <>
      <SectionTitle
        title={title}
        onPress={onPress}
        withChevron={withChevron}
        compact={compact}
      />
      {children}
    </>
  )
}
