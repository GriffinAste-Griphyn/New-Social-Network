import Image from "next/image"
import {
  ArrowLeft,
  BarChart3,
  Clock3,
  ImagePlus,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { requireSession } from "@/lib/auth"
import { getMyStoryStack, type MyStoryItem } from "@/lib/story-store"

type MyStoryPageProps = {
  searchParams: Promise<{
    error?: string
    story?: string
  }>
}

function formatPostedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatRemaining(minutes: number) {
  if (minutes < 60) {
    return `${Math.max(1, minutes)}m remaining`
  }

  return `${Math.ceil(minutes / 60)}h remaining`
}

function StoryVisual({ story }: { story: MyStoryItem }) {
  if (story.assetKind === "video") {
    return (
      <video
        src={story.mediaUrl}
        poster={story.thumbnailUrl ?? undefined}
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        controls
      />
    )
  }

  return (
    <Image
      src={story.mediaUrl}
      alt="Your story"
      fill
      sizes="(min-width: 1024px) 680px, 100vw"
      className="object-cover"
      priority
    />
  )
}

function Flash({
  error,
  story,
}: {
  error?: string
  story?: string
}) {
  const message =
    error ??
    (story === "deleted"
      ? "Story item deleted."
      : story === "updated"
        ? "Story item updated."
        : null)

  if (!message) {
    return null
  }

  return (
    <div
      className={
        error
          ? "rounded-[8px] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]"
          : "rounded-[8px] bg-[#ecfdf3] px-4 py-3 text-sm text-[#166534]"
      }
    >
      {message}
    </div>
  )
}

function Playback({ story, count }: { story: MyStoryItem; count: number }) {
  const stickers = story.elements.filter((element) => element.kind === "sticker")
  const textElements = story.elements.filter((element) => element.kind === "text")
  const links = story.elements.filter((element) => element.kind === "link")

  return (
    <section className="overflow-hidden rounded-[8px] bg-neutral-950 shadow-[0_24px_70px_rgba(15,23,42,0.2)]">
      <div className="relative min-h-[720px]">
        <StoryVisual story={story} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/8 to-black/78" />

        <div className="relative flex min-h-[720px] flex-col justify-between p-5 text-white">
          <div className="space-y-4">
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(count, 1)}, minmax(0, 1fr))` }}>
              {Array.from({ length: Math.max(count, 1) }).map((_, index) => (
                <div
                  key={index}
                  className={`h-1 rounded-full ${index === 0 ? "bg-white" : "bg-white/40"}`}
                />
              ))}
            </div>

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">My Story</p>
                <p className="text-sm text-white/70">
                  {formatPostedAt(story.createdAt)} · {formatRemaining(story.minutesRemaining)}
                </p>
              </div>
              <a
                href="#manage"
                aria-label="Manage story"
                className="flex size-10 items-center justify-center rounded-full bg-white/14 backdrop-blur"
              >
                <MoreHorizontal className="size-5" />
              </a>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {stickers.map((element) => (
                <Badge
                  key={element.id}
                  className="border-none bg-[#fde047] text-[#17191f]"
                >
                  {element.label}
                </Badge>
              ))}
              {story.brandTags.map((tag) => (
                <Badge key={tag} className="border-none bg-white/14 text-white">
                  #{tag}
                </Badge>
              ))}
            </div>

            <div className="max-w-md space-y-3">
              {textElements.map((element) => (
                <p
                  key={element.id}
                  className="w-fit rounded-[8px] bg-white/14 px-3 py-2 text-xl font-semibold backdrop-blur"
                >
                  {element.label}
                </p>
              ))}

              {story.caption ? (
                <p className="text-3xl font-semibold leading-tight">
                  {story.caption}
                </p>
              ) : null}
            </div>

            {links.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {links.map((element) => (
                  <a
                    key={element.id}
                    href={element.href ?? "#"}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#17191f]"
                  >
                    <Link2 className="size-4" />
                    {element.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function StoryEditor({ story }: { story: MyStoryItem }) {
  const textOverlays = story.elements
    .filter((element) => element.kind === "text")
    .map((element) => element.label)
    .join("\n")
  const stickers = story.elements
    .filter((element) => element.kind === "sticker")
    .map((element) => element.label)
    .join(", ")
  const link = story.elements.find((element) => element.kind === "link")

  return (
    <article className="rounded-[8px] bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#17191f]">
            {formatPostedAt(story.createdAt)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[#6b7280]">
            <Clock3 className="size-4" />
            {formatRemaining(story.minutesRemaining)}
          </p>
        </div>
        <Badge className="border-none bg-[#f5f6f8] text-[#374151]">
          {story.assetKind}
        </Badge>
      </div>

      <details>
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[8px] bg-[#f5f6f8] px-3 py-2 text-sm font-medium text-[#374151] [&::-webkit-details-marker]:hidden">
          <Pencil className="size-4" />
          Edit caption, stickers, links
        </summary>

        <form
          action={`/api/stories/${story.id}`}
          method="post"
          className="mt-4 space-y-3"
        >
          <input type="hidden" name="action" value="update" />
          <Textarea
            name="caption"
            defaultValue={story.caption}
            placeholder="Caption"
            className="min-h-24 resize-none rounded-[8px] bg-[#f5f6f8]"
          />
          <Textarea
            name="textOverlays"
            defaultValue={textOverlays}
            placeholder="Text overlays, one per line"
            className="min-h-20 resize-none rounded-[8px] bg-[#f5f6f8]"
          />
          <Input
            name="stickers"
            defaultValue={stickers}
            placeholder="stickers"
            className="h-11 rounded-[8px] bg-[#f5f6f8]"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              name="linkLabel"
              defaultValue={link?.label ?? ""}
              placeholder="Link label"
              className="h-11 rounded-[8px] bg-[#f5f6f8]"
            />
            <Input
              name="linkUrl"
              type="url"
              defaultValue={link?.href ?? ""}
              placeholder="https://example.com"
              className="h-11 rounded-[8px] bg-[#f5f6f8]"
            />
          </div>
          <Input
            name="brandTags"
            defaultValue={story.brandTags.join(", ")}
            placeholder="brand tags"
            className="h-11 rounded-[8px] bg-[#f5f6f8]"
          />
          <Button type="submit" className="h-11 rounded-[8px] bg-[#111827]">
            Save changes
          </Button>
        </form>
      </details>

      <details className="mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[8px] bg-[#fff1f2] px-3 py-2 text-sm font-medium text-[#be123c] [&::-webkit-details-marker]:hidden">
          <Trash2 className="size-4" />
          Delete options
        </summary>
        <form action={`/api/stories/${story.id}`} method="post" className="mt-3">
          <input type="hidden" name="action" value="delete" />
          <p className="mb-3 text-sm leading-6 text-[#6b7280]">
            This removes the item from your active story immediately.
          </p>
          <Button
            type="submit"
            variant="outline"
            className="h-11 w-full rounded-[8px] border-[#fecdd3] bg-[#fff1f2] text-[#be123c] hover:bg-[#ffe4e6] hover:text-[#9f1239]"
          >
            <Trash2 className="size-4" />
            Delete this item
          </Button>
        </form>
      </details>
    </article>
  )
}

export default async function MyStoryPage({ searchParams }: MyStoryPageProps) {
  const session = await requireSession()
  const params = await searchParams
  const myStory = await getMyStoryStack(session.id)
  const currentStory = myStory.items[0] ?? null

  return (
    <main className="min-h-screen bg-[#eef0f3] px-4 py-5 text-[#17191f] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1180px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-white px-4 py-3 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
          <div className="flex items-center gap-3">
            <a
              href="/feed"
              aria-label="Back to feed"
              className="flex size-10 items-center justify-center rounded-full bg-[#f5f6f8] text-[#374151]"
            >
              <ArrowLeft className="size-5" />
            </a>
            <div>
              <p className="text-sm text-[#6b7280]">@{session.handle}</p>
              <h1 className="text-2xl font-semibold tracking-tight">
                My Story
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href="/stats"
              className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#f5f6f8] px-4 text-sm font-medium text-[#374151]"
            >
              <BarChart3 className="size-4" />
              Stats
            </a>
            <a
              href="/stories/new"
              className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#111827] px-4 text-sm font-medium text-white"
            >
              <ImagePlus className="size-4" />
              Add story
            </a>
          </div>
        </header>

        <div className="mb-5">
          <Flash error={params.error} story={params.story} />
        </div>

        {currentStory ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.58fr)]">
            <Playback story={currentStory} count={myStory.liveCount} />

            <aside id="manage" className="space-y-4">
              <section className="rounded-[8px] bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
                <p className="text-lg font-semibold">Manage story</p>
                <p className="mt-1 text-sm text-[#6b7280]">
                  {myStory.liveCount} active item{myStory.liveCount === 1 ? "" : "s"}.
                  Each item expires independently after 24 hours.
                </p>
              </section>

              {myStory.items.map((story) => (
                <StoryEditor key={story.id} story={story} />
              ))}
            </aside>
          </div>
        ) : (
          <section className="rounded-[8px] bg-white p-8 text-center shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-[#f5f6f8]">
              <ImagePlus className="size-7 text-[#374151]" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold">No active story yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#6b7280]">
              Add a photo or video to start your story stack. Your story will
              appear first in Following and expire after 24 hours.
            </p>
            <a
              href="/stories/new"
              className="mt-5 inline-flex h-11 items-center justify-center rounded-[8px] bg-[#111827] px-4 text-sm font-medium text-white"
            >
              Create story
            </a>
          </section>
        )}
      </div>
    </main>
  )
}
