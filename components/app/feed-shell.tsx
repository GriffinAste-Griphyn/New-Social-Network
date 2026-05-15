import Image from "next/image"
import {
  BarChart3,
  Bell,
  Camera,
  Check,
  ChevronRight,
  CircleEllipsis,
  Compass,
  House,
  Link2,
  LogOut,
  MapPin,
  MessageSquare,
  Plus,
  Search,
  Send,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react"

import { enableCreatorToolsAction, logoutAction } from "@/lib/auth-actions"
import type { CompleteAuthSession } from "@/lib/auth"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FollowProfile } from "@/lib/follow-store"
import type {
  FeedStory,
  FeedStoryCard,
  MyStorySummary,
  SuggestedAccount,
} from "@/lib/story-store"
import { cn } from "@/lib/utils"

type FeedShellProps = {
  session: CompleteAuthSession
  featuredStory: FeedStory | null
  myStory: MyStorySummary
  followingProfiles: FollowProfile[]
  followingStories: FeedStoryCard[]
  suggestedAccounts: SuggestedAccount[]
  discoverStories: FeedStoryCard[]
  flash:
    | {
        type: "success" | "error"
        message: string
      }
    | null
}

type AccountBubble = FollowProfile

type DiscoverTile = {
  id: string
  assetKind: "image" | "video"
  imageUrl: string
  thumbnailUrl: string | null
  title: string
  subtitle?: string
}

type ShellTargets = {
  following: string
  stories: string
  discover: string
  share: string
}

type LeadStory = {
  id: string
  creator: string
  handle: string
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  title: string
  meta: string
}

const fallbackDiscoverTiles: DiscoverTile[] = [
  {
    id: "fallback-discover-1",
    assetKind: "image",
    imageUrl:
      "https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=900&q=80",
    thumbnailUrl: null,
    title: "Late light, one take, and a clean vertical frame.",
  },
  {
    id: "fallback-discover-2",
    assetKind: "image",
    imageUrl:
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80",
    thumbnailUrl: null,
    title: "Plan ahead for a spring escape",
    subtitle: "Sponsored",
  },
  {
    id: "fallback-discover-3",
    assetKind: "image",
    imageUrl:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=900&q=80",
    thumbnailUrl: null,
    title: "After-hours stories from accounts people keep rewatching.",
  },
  {
    id: "fallback-discover-4",
    assetKind: "image",
    imageUrl:
      "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=80",
    thumbnailUrl: null,
    title: "Morning routine, reset clips, and fresh discover traffic.",
  },
]

function buildSuggestedProfiles(
  suggestedAccounts: SuggestedAccount[],
): AccountBubble[] {
  const unique = new Map<string, AccountBubble>()

  for (const account of suggestedAccounts) {
    if (!unique.has(account.id)) {
      unique.set(account.id, {
        id: account.id,
        name: account.name,
        handle: account.handle.replace(/^@/, ""),
        imageUrl: account.imageUrl,
      })
    }
  }

  return Array.from(unique.values()).slice(0, 8)
}

function buildDiscoverTiles(
  discoverStories: FeedStoryCard[],
): DiscoverTile[] {
  const dynamicTiles = discoverStories.slice(0, 6).map((story) => ({
    id: `discover-${story.id}`,
    assetKind: story.assetKind,
    imageUrl: story.mediaUrl,
    thumbnailUrl: story.thumbnailUrl,
    title: story.title,
  }))

  const unique = new Map<string, DiscoverTile>()

  for (const tile of [...dynamicTiles, ...fallbackDiscoverTiles]) {
    if (!unique.has(tile.id)) {
      unique.set(tile.id, tile)
    }
  }

  return Array.from(unique.values()).slice(0, 6)
}

function buildLeadStory(
  featuredStory: FeedStory | null,
  followingStories: FeedStoryCard[],
): LeadStory | null {
  if (featuredStory) {
    return {
      id: featuredStory.id,
      creator: featuredStory.creator,
      handle: featuredStory.handle,
      assetKind: featuredStory.assetKind,
      mediaUrl: featuredStory.mediaUrl,
      thumbnailUrl: featuredStory.thumbnailUrl,
      title: featuredStory.caption,
      meta: featuredStory.engagement,
    }
  }

  const fallback = followingStories[0]

  if (!fallback) {
    return null
  }

  return {
    id: fallback.id,
    creator: fallback.creator,
    handle: fallback.handle,
    assetKind: fallback.assetKind,
    mediaUrl: fallback.mediaUrl,
    thumbnailUrl: fallback.thumbnailUrl,
    title: fallback.title,
    meta: `${fallback.progressPercent}% live window remaining`,
  }
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function formatHandle(handle: string) {
  return handle.startsWith("@") ? handle : `@${handle}`
}

function AccountAvatar({
  account,
  className,
}: {
  account: AccountBubble
  className?: string
}) {
  return (
    <Avatar className={className}>
      {account.imageUrl ? (
        <AvatarImage src={account.imageUrl} alt={account.name} />
      ) : null}
      <AvatarFallback className="bg-[#e5e7eb] text-[#17191f]">
        {initials(account.name)}
      </AvatarFallback>
    </Avatar>
  )
}

function MyStoryBubble({
  myStory,
  variant,
}: {
  myStory: MyStorySummary
  variant: "app" | "web" | "desktop"
}) {
  const avatarSize =
    variant === "desktop" ? "size-[76px]" : variant === "web" ? "size-[86px]" : "size-[102px]"
  const articleWidth =
    variant === "desktop" ? "min-w-[84px]" : variant === "web" ? "min-w-[92px]" : "min-w-[96px]"
  const addSize =
    variant === "desktop" ? "size-8" : variant === "web" ? "size-8" : "size-9"
  const openHref = myStory.hasActiveStory ? "/stories/me" : "/stories/new"
  const thumbnail = myStory.latestThumbnailUrl

  return (
    <article className={cn("shrink-0 text-center", articleWidth)}>
      <div className={cn("relative mx-auto", avatarSize)}>
        <a
          href={openHref}
          aria-label={
            myStory.hasActiveStory ? "Open your story" : "Create your story"
          }
          className={cn(
            "relative block size-full overflow-hidden rounded-full p-[4px]",
            myStory.hasActiveStory
              ? "[background:linear-gradient(135deg,#ef4444,#f97316,#fde047)]"
              : "bg-[#e5e7eb]",
          )}
        >
          <span className="relative block size-full overflow-hidden rounded-full border-[4px] border-white bg-[#fde047]">
            {thumbnail ? (
              <Image
                src={thumbnail}
                alt="Your latest story"
                fill
                sizes="120px"
                className="object-cover"
              />
            ) : (
              <span className="flex size-full items-center justify-center text-sm font-medium text-[#17191f]">
                {initials(myStory.owner.name)}
              </span>
            )}
          </span>
        </a>
        <a
          href="/stories/new"
          aria-label="Add to your story"
          className={cn(
            "absolute -bottom-1 -right-1 flex items-center justify-center rounded-full border-[3px] border-white bg-[#111827] text-white shadow-[0_8px_18px_rgba(17,24,39,0.25)]",
            addSize,
          )}
        >
          <Plus className="size-4" />
        </a>
      </div>
      <p
        className={cn(
          "mt-4 truncate font-medium tracking-tight text-[#17191f]",
          variant === "desktop" ? "text-sm" : "text-[1rem]",
        )}
      >
        My Story
      </p>
      <p
        className={cn(
          "truncate text-[#9ca3af]",
          variant === "desktop" ? "text-xs" : "text-sm",
        )}
      >
        {myStory.hasActiveStory
          ? `${myStory.liveCount} live · ${myStory.expiresSoonLabel}`
          : "Add now"}
      </p>
    </article>
  )
}

function FollowButton({
  targetUserId,
  className,
}: {
  targetUserId: string
  className?: string
}) {
  return (
    <form action="/api/follows" method="post">
      <input type="hidden" name="action" value="follow" />
      <input type="hidden" name="targetUserId" value={targetUserId} />
      <input type="hidden" name="next" value="/feed" />
      <button
        type="submit"
        className={cn(
          "rounded-full bg-[#111827] px-3 py-1 text-xs font-medium text-white",
          className,
        )}
      >
        Follow
      </button>
    </form>
  )
}

function SuggestionList({
  accounts,
  emptyMessage,
}: {
  accounts: AccountBubble[]
  emptyMessage: string
}) {
  if (accounts.length === 0) {
    return (
      <div className="rounded-[8px] bg-[#f5f6f8] px-4 py-5 text-sm text-[#6b7280]">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {accounts.slice(0, 5).map((account) => (
        <div
          key={account.id}
          className="flex items-center justify-between gap-3 rounded-[8px] bg-[#f8fafc] px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-3">
            <AccountAvatar account={account} className="size-10" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#17191f]">
                {account.name}
              </p>
              <p className="truncate text-xs text-[#6b7280]">
                {formatHandle(account.handle)}
              </p>
            </div>
          </div>
          <FollowButton targetUserId={account.id} />
        </div>
      ))}
    </div>
  )
}

function FollowedAccountsEmptyState({
  className,
}: {
  className?: string
}) {
  return (
    <div className={cn("rounded-[8px] bg-[#f5f6f8] px-4 py-5 text-sm text-[#6b7280]", className)}>
      Follow people you want in your story feed.
    </div>
  )
}

function LiveStoriesEmptyState({
  hasFollowingProfiles,
}: {
  hasFollowingProfiles: boolean
}) {
  return (
    <div className="rounded-[8px] bg-[#f5f6f8] px-4 py-5 text-sm text-[#6b7280]">
      {hasFollowingProfiles
        ? "No live stories from the people you follow right now."
        : "Follow people to start building your story feed."}
    </div>
  )
}

function StoryMedia({
  assetKind,
  mediaUrl,
  thumbnailUrl,
  alt,
  sizes,
}: {
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  alt: string
  sizes: string
}) {
  const source = assetKind === "image" ? mediaUrl : thumbnailUrl

  if (source) {
    return (
      <Image
        src={source}
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover"
      />
    )
  }

  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#111827] via-[#262626] to-[#4b5563]">
      <div className="absolute right-3 top-3 rounded-full bg-white/14 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white">
        Video
      </div>
    </div>
  )
}

function FlashBanner({
  flash,
  className,
}: {
  flash: FeedShellProps["flash"]
  className?: string
}) {
  if (!flash) {
    return null
  }

  return (
    <div
      className={cn(
        "rounded-[8px] px-4 py-3 text-sm",
        flash.type === "success"
          ? "bg-[#ecfdf3] text-[#166534]"
          : "bg-[#fff1f2] text-[#be123c]",
        className,
      )}
    >
      {flash.message}
    </div>
  )
}

function SectionHeading({
  title,
  withChevron = true,
  className,
}: {
  title: string
  withChevron?: boolean
  className?: string
}) {
  return (
    <div className={cn("mb-3 flex items-center gap-1", className)}>
      <h2 className="text-[2rem] font-[350] tracking-tight text-[#17191f] sm:text-[2.15rem]">
        {title}
      </h2>
      {withChevron ? (
        <ChevronRight className="mt-1 size-7 text-[#c0c4cb]" />
      ) : null}
    </div>
  )
}

function FollowingStrip({
  myStory,
  accounts,
  variant,
}: {
  myStory: MyStorySummary
  accounts: AccountBubble[]
  variant: "app" | "web" | "desktop"
}) {
  const avatarSize =
    variant === "desktop" ? "size-[76px]" : variant === "web" ? "size-[86px]" : "size-[102px]"
  const articleWidth =
    variant === "desktop" ? "min-w-[84px]" : variant === "web" ? "min-w-[92px]" : "min-w-[96px]"
  const badgeClass =
    variant === "desktop"
      ? "inset-x-3 h-8 text-[11px]"
      : variant === "web"
        ? "inset-x-3 h-8 text-xs"
        : "inset-x-4 h-9 text-sm"

  return (
    <div className="flex gap-4 overflow-x-auto pb-1">
      <MyStoryBubble myStory={myStory} variant={variant} />
      {accounts.map((account) => (
        <article key={account.id} className={cn("shrink-0 text-center", articleWidth)}>
          <div
            className={cn(
              "relative mx-auto rounded-full p-[4px]",
              avatarSize,
              "[background:linear-gradient(135deg,#b84cff,#7c3aed)]",
            )}
          >
            <AccountAvatar account={account} className="size-full border-[4px] border-white" />
            <div
              className={cn(
                "absolute bottom-[-8px] flex items-center justify-center gap-1 rounded-full bg-[#a53af7] px-3 text-white shadow-[0_8px_18px_rgba(165,58,247,0.32)]",
                badgeClass,
              )}
            >
              <Check className="size-4" />
            </div>
          </div>
          <p
            className={cn(
              "mt-4 truncate font-medium tracking-tight text-[#17191f]",
              variant === "desktop" ? "text-sm" : "text-[1rem]",
            )}
          >
            {account.name}
          </p>
          <p
            className={cn(
              "truncate text-[#9ca3af]",
              variant === "desktop" ? "text-xs" : "text-sm",
            )}
          >
            {formatHandle(account.handle)}
          </p>
        </article>
      ))}
    </div>
  )
}

function FollowingCard({
  story,
  variant,
  className,
}: {
  story: FeedStoryCard
  variant: "app" | "web" | "desktop"
  className?: string
}) {
  const sizing =
    variant === "desktop"
      ? "min-h-[280px]"
      : variant === "web"
        ? "min-h-[320px] min-w-[220px]"
        : "min-h-[290px] min-w-[164px]"

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-[8px] bg-[#e5e7eb]",
        sizing,
        className,
      )}
    >
      <StoryMedia
        assetKind={story.assetKind}
        mediaUrl={story.mediaUrl}
        thumbnailUrl={story.thumbnailUrl}
        alt={story.title}
        sizes={variant === "desktop" ? "(min-width: 1024px) 320px, 100vw" : "240px"}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/12 via-black/8 to-black/78" />

      <div className="absolute left-3 top-3 flex size-11 items-center justify-center overflow-hidden rounded-full border-[3px] border-[#e01616] bg-white">
        <Avatar className="size-10">
          <AvatarFallback className="bg-white text-xs font-medium text-[#17191f]">
            {initials(story.creator)}
          </AvatarFallback>
        </Avatar>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-3">
        <p
          className={cn(
            "line-clamp-4 font-medium leading-[1.12] text-white",
            variant === "desktop" ? "text-[1.05rem]" : "text-[1rem]",
          )}
        >
          {story.title}
        </p>
        <div className="mt-3 h-2 rounded-full bg-white/28">
          <div
            className={cn(
              "h-full rounded-full",
              variant === "app" ? "bg-[#f9f871]" : "bg-[#d8b4fe]",
            )}
            style={{ width: `${story.progressPercent}%` }}
          />
        </div>
      </div>
    </article>
  )
}

function DiscoverCard({
  tile,
  tall = false,
  variant,
}: {
  tile: DiscoverTile
  tall?: boolean
  variant: "app" | "web" | "desktop"
}) {
  const minHeight =
    variant === "desktop"
      ? tall
        ? "min-h-[430px]"
        : "min-h-[230px]"
      : tall
        ? "min-h-[420px]"
        : "min-h-[250px]"

  return (
    <article
      className={cn("relative overflow-hidden rounded-[8px] bg-[#e5e7eb]", minHeight)}
    >
      <StoryMedia
        assetKind={tile.assetKind}
        mediaUrl={tile.imageUrl}
        thumbnailUrl={tile.thumbnailUrl}
        alt={tile.title}
        sizes={variant === "desktop" ? "(min-width: 1024px) 33vw, 100vw" : "(max-width: 430px) 50vw, 200px"}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/5 to-black/72" />

      <div className="absolute inset-x-0 bottom-0 p-4">
        {tile.subtitle ? (
          <Badge className="mb-2 rounded-full border-0 bg-white/14 px-2.5 text-white backdrop-blur">
            {tile.subtitle}
          </Badge>
        ) : null}
        <p className="line-clamp-4 text-[1rem] font-medium leading-[1.15] text-white">
          {tile.title}
        </p>
      </div>
    </article>
  )
}

function StoryComposerPanel({
  session,
  prefix,
  compact = false,
  className,
}: {
  session: CompleteAuthSession
  prefix: string
  compact?: boolean
  className?: string
}) {
  return (
    <section
      id={`${prefix}-share`}
      className={cn("rounded-[8px] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]", className)}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-medium tracking-tight text-[#17191f]">
            {session.creatorStatus === "active"
              ? "Post a story"
              : "Account setup"}
          </p>
          <p className="text-sm text-[#6b7280]">@{session.handle}</p>
        </div>
        <Badge
          variant="secondary"
          className="rounded-full border-0 bg-[#f5f6f8] px-3 py-1 text-[#374151]"
        >
          {session.creatorStatus === "active" ? "24h live" : "setup needed"}
        </Badge>
      </div>

      {session.creatorStatus !== "active" ? (
        <div className="space-y-4 rounded-[8px] bg-[#f5f6f8] p-4">
          <div>
            <p className="font-medium text-[#17191f]">
              Turn on posting when you are ready to share.
            </p>
            <p className="mt-1 text-sm leading-6 text-[#6b7280]">
              Your account stays the same. This opens story posting,
              analytics, and earning settings for @{session.handle}.
            </p>
          </div>
          <form action={enableCreatorToolsAction}>
            <input type="hidden" name="next" value="/feed" />
            <Button
              type="submit"
              className="h-11 w-full rounded-[8px] bg-[#111827] text-white hover:bg-[#0f172a]"
            >
              Turn on posting
            </Button>
          </form>
        </div>
      ) : null}

      {session.creatorStatus === "active" ? (
        <div className={cn("rounded-[8px] bg-[#f5f6f8] p-4", compact ? "p-3" : null)}>
          <div
            className={cn(
              "relative mb-4 overflow-hidden rounded-[8px] bg-[#10131a]",
              compact ? "aspect-[16/11]" : "aspect-[9/14]",
            )}
          >
            <Image
              src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80"
              alt="Story upload preview"
              fill
              sizes="340px"
              className="object-cover opacity-72"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/62" />
            <div className="absolute right-3 top-3 grid gap-2">
              <span className="flex size-9 items-center justify-center rounded-full bg-[#e01616] text-white">
                <Sparkles className="size-4" />
              </span>
              <span className="flex size-9 items-center justify-center rounded-full bg-black/38 text-white backdrop-blur">
                <Link2 className="size-4" />
              </span>
            </div>
            <div className="absolute inset-x-0 top-[48%] bg-black/34 px-4 py-2 text-center text-lg font-medium text-white">
              Add text
            </div>
          </div>
          <p className={cn("text-sm leading-6 text-[#6b7280]", compact ? "sr-only" : null)}>
            Open the full web editor to add media, one text overlay, and one link.
          </p>
          <a
            href="/stories/new"
            className={cn(
              "flex h-11 items-center justify-center gap-2 rounded-[8px] bg-[#e01616] px-4 text-sm font-medium text-white hover:bg-[#c91414]",
              compact ? "mt-3" : "mt-4",
            )}
          >
            <Camera className="size-4" />
            Upload to Story
          </a>
          <a
            href="/stats"
            className="mt-2 flex h-10 items-center justify-center gap-2 rounded-[8px] bg-white px-4 text-sm font-medium text-[#374151] hover:bg-[#eef0f3]"
          >
            <BarChart3 className="size-4" />
            View stats
          </a>
          <a
            href="/payouts"
            className="mt-2 flex h-10 items-center justify-center gap-2 rounded-[8px] bg-white px-4 text-sm font-medium text-[#374151] hover:bg-[#eef0f3]"
          >
            <WalletCards className="size-4" />
            Stripe payouts
          </a>
        </div>
      ) : null}
    </section>
  )
}

function AppBottomNav({ targets }: { targets: ShellTargets }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-[430px] items-center justify-around border-t border-black/6 bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] pt-3">
      <a href={`#${targets.following}`} className="text-[#3b414d]" aria-label="Following">
        <MapPin className="size-7" />
      </a>
      <a href={`#${targets.stories}`} className="text-[#3b414d]" aria-label="Live stories">
        <MessageSquare className="size-7" />
      </a>
      <a href={`#${targets.share}`} className="text-[#3b414d]" aria-label="Camera">
        <Camera className="size-8" />
      </a>
      <a href={`#${targets.discover}`} className="text-[#3b414d]" aria-label="Community">
        <Users className="size-7" />
      </a>
      <a href={`#${targets.share}`} className="relative text-[#3b414d]" aria-label="Updates">
        <Send className="size-7" />
        <span className="absolute -right-1 -top-1 size-3 rounded-full bg-[#e01616]" />
      </a>
    </nav>
  )
}

function MobileAppFeed({
  session,
  myStory,
  followingProfiles,
  followingStories,
  suggestedProfiles,
  discoverTiles,
  flash,
  targets,
}: {
  session: CompleteAuthSession
  myStory: MyStorySummary
  followingProfiles: AccountBubble[]
  followingStories: FeedStoryCard[]
  suggestedProfiles: AccountBubble[]
  discoverTiles: DiscoverTile[]
  flash: FeedShellProps["flash"]
  targets: ShellTargets
}) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[430px] bg-white">
      <div className="px-4 pb-28 pt-5">
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pb-5 pt-1">
          <div className="flex items-center gap-3 justify-self-start">
            <a
              href={`#${targets.discover}`}
              aria-label="Search stories"
              className="flex size-12 items-center justify-center rounded-full bg-[#f5f6f8] text-[#6b7280]"
            >
              <Search className="size-6" />
            </a>
            <details className="relative">
              <summary
                aria-label="Open story actions"
                className="flex size-12 cursor-pointer list-none items-center justify-center rounded-full bg-[#f5f6f8] text-[#6b7280] [&::-webkit-details-marker]:hidden"
              >
                <CircleEllipsis className="size-6" />
              </summary>
              <div className="absolute left-0 top-14 z-20 w-44 rounded-[8px] border border-black/8 bg-white p-2 shadow-[0_16px_40px_rgba(15,23,42,0.16)]">
                <a
                  href={`#${targets.share}`}
                  className="block rounded-[8px] px-3 py-2 text-sm font-medium hover:bg-[#f5f6f8]"
                >
                  Post a story
                </a>
                <a
                  href={`#${targets.following}`}
                  className="block rounded-[8px] px-3 py-2 text-sm font-medium hover:bg-[#f5f6f8]"
                >
                  Following
                </a>
                <a
                  href={`#${targets.discover}`}
                  className="block rounded-[8px] px-3 py-2 text-sm font-medium hover:bg-[#f5f6f8]"
                >
                  Discover
                </a>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="block w-full rounded-[8px] px-3 py-2 text-left text-sm font-medium hover:bg-[#f5f6f8]"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>

          <p className="justify-self-center text-[2rem] font-medium tracking-tight text-[#17191f]">
            Stories
          </p>

          <a
            href={`#${targets.share}`}
            aria-label="Open your profile tools"
            className="flex size-12 items-center justify-center justify-self-end rounded-full bg-[#f5f6f8]"
          >
            <Avatar className="size-11">
              <AvatarFallback className="bg-[#fde047] text-[#17191f]">
                {initials(session.displayName)}
              </AvatarFallback>
            </Avatar>
          </a>
        </header>

        <FlashBanner flash={flash} className="mb-5" />

        <section id={targets.following} className="pb-7">
          <SectionHeading title="Following" />
          <FollowingStrip
            myStory={myStory}
            accounts={followingProfiles}
            variant="app"
          />
          {followingProfiles.length === 0 ? (
            <FollowedAccountsEmptyState className="mt-4" />
          ) : null}
        </section>

        <section id={targets.stories} className="pb-7">
          <SectionHeading title="Live Stories" />
          {followingStories.length === 0 ? (
            <LiveStoriesEmptyState
              hasFollowingProfiles={followingProfiles.length > 0}
            />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {followingStories.map((story) => (
                <FollowingCard key={story.id} story={story} variant="app" />
              ))}
            </div>
          )}
        </section>

        <section id={targets.discover} className="pb-8">
          <SectionHeading title="Discover" withChevron={false} />
          <div className="grid grid-cols-2 gap-3">
            {discoverTiles.slice(0, 4).map((tile, index) => (
              <DiscoverCard
                key={tile.id}
                tile={tile}
                tall={index === 0}
                variant="app"
              />
            ))}
          </div>
        </section>

        <section className="pb-8">
          <SectionHeading title="Suggested Accounts" withChevron={false} />
          <SuggestionList
            accounts={suggestedProfiles}
            emptyMessage="No new suggestions right now."
          />
        </section>

        <StoryComposerPanel session={session} prefix="app" className="shadow-none" />
      </div>

      <AppBottomNav targets={targets} />
    </div>
  )
}

function MobileWebFeed({
  session,
  myStory,
  followingProfiles,
  followingStories,
  suggestedProfiles,
  discoverTiles,
  flash,
  targets,
}: {
  session: CompleteAuthSession
  myStory: MyStorySummary
  followingProfiles: AccountBubble[]
  followingStories: FeedStoryCard[]
  suggestedProfiles: AccountBubble[]
  discoverTiles: DiscoverTile[]
  flash: FeedShellProps["flash"]
  targets: ShellTargets
}) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="sticky top-4 z-10 mb-6 rounded-[8px] border border-black/6 bg-white/90 px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-[#6b7280]">Mobile web</p>
            <h1 className="text-[2.35rem] font-[350] tracking-tight text-[#17191f]">
              Stories
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden min-w-[220px] sm:block">
              <Input
                aria-label="Search stories"
                placeholder="Search people and stories"
                className="h-11 rounded-[8px] border-0 bg-[#f5f6f8] pl-4"
              />
            </div>
            <div className="flex size-11 items-center justify-center rounded-full bg-white text-[#6b7280] ring-1 ring-black/8">
              <Bell className="size-5" />
            </div>
            <div className="flex size-11 items-center justify-center rounded-full bg-[#fde047] text-[#17191f]">
              <span className="text-sm font-medium">
                {initials(session.displayName)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={`#${targets.following}`}
            className="rounded-full bg-[#f5f6f8] px-3 py-1.5 text-sm font-medium text-[#374151]"
          >
            Following
          </a>
          <a
            href={`#${targets.stories}`}
            className="rounded-full bg-[#f5f6f8] px-3 py-1.5 text-sm font-medium text-[#374151]"
          >
            Live stories
          </a>
          <a
            href={`#${targets.discover}`}
            className="rounded-full bg-[#f5f6f8] px-3 py-1.5 text-sm font-medium text-[#374151]"
          >
            Discover
          </a>
          <a
            href={`#${targets.share}`}
            className="rounded-full bg-[#111827] px-3 py-1.5 text-sm font-medium text-white"
          >
            Post
          </a>
        </div>
      </header>

      <div className="space-y-6">
        <FlashBanner flash={flash} />

        <section id={targets.following} className="rounded-[8px] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <SectionHeading title="Following" />
          <FollowingStrip
            myStory={myStory}
            accounts={followingProfiles}
            variant="web"
          />
          {followingProfiles.length === 0 ? (
            <FollowedAccountsEmptyState className="mt-4" />
          ) : null}
        </section>

        <section id={targets.stories} className="rounded-[8px] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <SectionHeading title="Live Stories" />
          {followingStories.length === 0 ? (
            <LiveStoriesEmptyState
              hasFollowingProfiles={followingProfiles.length > 0}
            />
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-1">
              {followingStories.map((story) => (
                <FollowingCard key={story.id} story={story} variant="web" />
              ))}
            </div>
          )}
        </section>

        <section id={targets.discover} className="rounded-[8px] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <SectionHeading title="Discover" withChevron={false} />
          <div className="grid grid-cols-2 gap-4">
            {discoverTiles.map((tile, index) => (
              <DiscoverCard
                key={tile.id}
                tile={tile}
                tall={index === 0 || index === 3}
                variant="web"
              />
            ))}
          </div>
        </section>

        <section className="rounded-[8px] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <SectionHeading title="Suggested Accounts" withChevron={false} />
          <SuggestionList
            accounts={suggestedProfiles}
            emptyMessage="No new suggestions right now."
          />
        </section>

        <StoryComposerPanel session={session} prefix="mobile-web" />
      </div>
    </div>
  )
}

function DesktopFeed({
  session,
  myStory,
  followingProfiles,
  followingStories,
  suggestedProfiles,
  discoverTiles,
  flash,
  targets,
  leadStory,
}: {
  session: CompleteAuthSession
  myStory: MyStorySummary
  followingProfiles: AccountBubble[]
  followingStories: FeedStoryCard[]
  suggestedProfiles: AccountBubble[]
  discoverTiles: DiscoverTile[]
  flash: FeedShellProps["flash"]
  targets: ShellTargets
  leadStory: LeadStory | null
}) {
  const liveStories = followingStories.length > 0 ? followingStories : []

  return (
    <div className="mx-auto max-w-[1220px] px-5 py-5 xl:px-6">
      <div className="grid items-start gap-5 lg:grid-cols-[72px_minmax(420px,520px)_minmax(300px,360px)] xl:grid-cols-[80px_minmax(440px,540px)_minmax(320px,380px)]">
        <aside className="sticky top-5 hidden min-h-[calc(100vh-2.5rem)] flex-col items-center justify-between rounded-[8px] bg-white px-3 py-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)] lg:flex">
          <div className="flex flex-col items-center gap-4">
            <a
              href="#desktop-top"
              aria-label="Home"
              className="flex size-12 items-center justify-center rounded-full bg-[#f5f6f8] text-[#17191f]"
            >
              <House className="size-5" />
            </a>

            <nav className="flex flex-col items-center gap-3">
              <a
                href={`#${targets.following}`}
                aria-label="Following"
                className="flex size-12 items-center justify-center rounded-full text-[#4b5563] hover:bg-[#f5f6f8]"
              >
                <Users className="size-5" />
              </a>
              <a
                href={`#${targets.stories}`}
                aria-label="Live stories"
                className="flex size-12 items-center justify-center rounded-full text-[#4b5563] hover:bg-[#f5f6f8]"
              >
                <Camera className="size-5" />
              </a>
              <a
                href={`#${targets.discover}`}
                aria-label="Discover"
                className="flex size-12 items-center justify-center rounded-full text-[#4b5563] hover:bg-[#f5f6f8]"
              >
                <Compass className="size-5" />
              </a>
              <a
                href={`#${targets.share}`}
                aria-label="Post a story"
                className="flex size-12 items-center justify-center rounded-full bg-[#111827] text-white shadow-[0_12px_26px_rgba(17,24,39,0.22)]"
              >
                <Sparkles className="size-5" />
              </a>
            </nav>
          </div>

          <div className="flex flex-col items-center gap-3">
            <Avatar className="size-12">
              <AvatarFallback className="bg-[#fde047] text-[#17191f]">
                {initials(session.displayName)}
              </AvatarFallback>
            </Avatar>
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex size-11 items-center justify-center rounded-full text-[#6b7280] hover:bg-[#f5f6f8]"
                aria-label="Sign out"
              >
                <LogOut className="size-5" />
              </button>
            </form>
          </div>
        </aside>

        <section className="min-w-0 rounded-[8px] bg-white px-4 pb-8 pt-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
          <header
            id="desktop-top"
            className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pb-5"
          >
            <div className="flex items-center gap-3 justify-self-start">
              <a
                href={`#${targets.discover}`}
                aria-label="Search stories"
                className="flex size-12 items-center justify-center rounded-full bg-[#f5f6f8] text-[#6b7280]"
              >
                <Search className="size-6" />
              </a>
            </div>

            <h1 className="justify-self-center text-2xl font-[350] tracking-normal text-[#17191f]">
              Stories
            </h1>

            <a
              href={`#${targets.share}`}
              aria-label="Open your profile tools"
              className="flex size-12 items-center justify-center justify-self-end rounded-full bg-[#e01616]"
            >
              <span className="text-sm font-medium text-white">
                {initials(session.displayName)}
              </span>
            </a>
          </header>

          <div className="space-y-7">
            <FlashBanner flash={flash} />

            <section id={targets.following}>
              <SectionHeading title="Following" />
              <FollowingStrip
                myStory={myStory}
                accounts={followingProfiles}
                variant="web"
              />
              {followingProfiles.length === 0 ? (
                <FollowedAccountsEmptyState className="mt-4" />
              ) : null}
            </section>

            <section id={targets.stories}>
              <SectionHeading title="Live Stories" />
              {liveStories.length === 0 ? (
                <LiveStoriesEmptyState
                  hasFollowingProfiles={followingProfiles.length > 0}
                />
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {liveStories.map((story) => (
                    <FollowingCard key={story.id} story={story} variant="app" />
                  ))}
                </div>
              )}
            </section>

            {leadStory ? (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-lg font-medium text-[#17191f]">
                    Watch now
                  </p>
                  <Badge className="rounded-full border-0 bg-[#e01616] text-white">
                    Live
                  </Badge>
                </div>
                <article className="relative aspect-[9/14] overflow-hidden rounded-[8px] bg-[#e5e7eb]">
                  <StoryMedia
                    assetKind={leadStory.assetKind}
                    mediaUrl={leadStory.mediaUrl}
                    thumbnailUrl={leadStory.thumbnailUrl}
                    alt={leadStory.title}
                    sizes="(min-width: 1024px) 520px, 100vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/16 via-black/8 to-black/76" />
                  <div className="absolute left-4 right-4 top-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {leadStory.creator}
                      </p>
                      <p className="text-xs text-white/72">
                        {leadStory.handle}
                      </p>
                    </div>
                    <p className="rounded-full bg-white/16 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                      {leadStory.meta}
                    </p>
                  </div>
                  <p className="absolute bottom-4 left-4 right-4 line-clamp-4 text-2xl font-medium leading-[1.08] text-white">
                    {leadStory.title}
                  </p>
                </article>
              </section>
            ) : null}

            <section id={targets.discover}>
              <SectionHeading title="Discover" withChevron={false} />
              <div className="grid grid-cols-2 gap-3">
                {discoverTiles.slice(0, 4).map((tile, index) => (
                  <DiscoverCard
                    key={tile.id}
                    tile={tile}
                    tall={index === 0}
                    variant="app"
                  />
                ))}
              </div>
            </section>

            <section>
              <SectionHeading title="Suggested Accounts" withChevron={false} />
              <SuggestionList
                accounts={suggestedProfiles}
                emptyMessage="No new suggestions right now."
              />
            </section>
          </div>
        </section>

        <aside className="sticky top-5 hidden self-start space-y-5 lg:block">
          <section className="rounded-[8px] bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
            <div className="flex items-center gap-3">
              <Avatar className="size-12">
                <AvatarFallback className="bg-[#fde047] text-[#17191f]">
                  {initials(session.displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-[#17191f]">
                  {session.displayName}
                </p>
                <p className="truncate text-sm text-[#6b7280]">
                  @{session.handle}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-[8px] bg-[#f5f6f8] px-3 py-3">
                <p className="text-sm font-medium text-[#17191f]">
                  Unified
                </p>
                <p className="mt-1 text-[11px] text-[#6b7280]">Account</p>
              </div>
              <div className="rounded-[8px] bg-[#f5f6f8] px-3 py-3">
                <p className="text-sm font-medium text-[#17191f]">
                  {myStory.liveCount}
                </p>
                <p className="mt-1 text-[11px] text-[#6b7280]">Live</p>
              </div>
              <div className="rounded-[8px] bg-[#f5f6f8] px-3 py-3">
                <p className="text-sm font-medium text-[#17191f]">
                  {suggestedProfiles.length}
                </p>
                <p className="mt-1 text-[11px] text-[#6b7280]">To follow</p>
              </div>
            </div>
          </section>

          <div id={targets.share}>
            <StoryComposerPanel session={session} prefix="desktop" compact />
          </div>
        </aside>

      </div>
    </div>
  )
}

export function FeedShell({
  session,
  featuredStory,
  myStory,
  followingProfiles,
  followingStories,
  suggestedAccounts,
  discoverStories,
  flash,
}: FeedShellProps) {
  const suggestedProfiles = buildSuggestedProfiles(suggestedAccounts)
  const discoverTiles = buildDiscoverTiles(discoverStories)
  const leadStory = buildLeadStory(featuredStory, followingStories)

  return (
    <main className="min-h-screen bg-[#f3f4f6] text-[#17191f]">
      <div className="sm:hidden">
        <MobileAppFeed
          session={session}
          myStory={myStory}
          followingProfiles={followingProfiles}
          followingStories={followingStories}
          suggestedProfiles={suggestedProfiles}
          discoverTiles={discoverTiles}
          flash={flash}
          targets={{
            following: "app-following",
            stories: "app-stories",
            discover: "app-discover",
            share: "app-share",
          }}
        />
      </div>

      <div className="hidden sm:block lg:hidden">
        <MobileWebFeed
          session={session}
          myStory={myStory}
          followingProfiles={followingProfiles}
          followingStories={followingStories}
          suggestedProfiles={suggestedProfiles}
          discoverTiles={discoverTiles}
          flash={flash}
          targets={{
            following: "mobile-web-following",
            stories: "mobile-web-stories",
            discover: "mobile-web-discover",
            share: "mobile-web-share",
          }}
        />
      </div>

      <div className="hidden lg:block">
        <DesktopFeed
          session={session}
          myStory={myStory}
          followingProfiles={followingProfiles}
          followingStories={followingStories}
          suggestedProfiles={suggestedProfiles}
          discoverTiles={discoverTiles}
          flash={flash}
          targets={{
            following: "desktop-following",
            stories: "desktop-stories",
            discover: "desktop-discover",
            share: "desktop-share",
          }}
          leadStory={leadStory}
        />
      </div>
    </main>
  )
}
