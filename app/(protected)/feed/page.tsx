import { FeedShell } from "@/components/app/feed-shell"
import { requireSession } from "@/lib/auth"
import { getFeedData } from "@/lib/story-store"

type FeedPageProps = {
  searchParams: Promise<{
    error?: string
    story?: string
  }>
}

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const session = await requireSession()
  const params = await searchParams
  const feedData = await getFeedData(session.id)
  const flash =
    typeof params.error === "string"
      ? {
          type: "error" as const,
          message: params.error,
        }
      : params.story === "created"
        ? {
            type: "success" as const,
            message: "Story is live. Your feed updated immediately.",
          }
        : null

  return (
    <FeedShell
      session={session}
      featuredStory={feedData.featuredStory}
      myStory={feedData.myStory}
      followingProfiles={feedData.followingProfiles}
      followingStories={feedData.followingStories}
      suggestedAccounts={feedData.suggestedAccounts}
      discoverStories={feedData.discoverStories}
      flash={flash}
    />
  )
}
