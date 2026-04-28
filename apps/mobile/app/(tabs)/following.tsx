import { useAuthFlow } from "@/lib/auth-flow"
import { useFollowState } from "@/lib/follow-state"
import { useMobileFeed } from "@/lib/mobile-stories-api"
import {
  ScreenFrame,
  ScreenHeader,
  ScreenScroll,
  StoryList,
} from "@/components/social/ui"

export default function FollowingScreen() {
  const { account } = useAuthFlow()
  const { revision } = useFollowState()
  const liveFeed = useMobileFeed(account?.mobileToken, revision)
  const chronologicalStories = (liveFeed.data?.followingStories ?? [])
    .sort(
      (left, right) =>
        Date.parse(right.lastUploadedAt) - Date.parse(left.lastUploadedAt),
    )

  return (
    <ScreenFrame>
      <ScreenScroll>
        <ScreenHeader
          title="Following"
          subtitle="Live stories from accounts you already follow."
        />
        <StoryList stories={chronologicalStories} />
      </ScreenScroll>
    </ScreenFrame>
  )
}
