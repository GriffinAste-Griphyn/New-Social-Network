"use client"

import Image from "next/image"
import { useEffect, useRef } from "react"
import { Play, Sparkles, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { FeedStory } from "@/lib/story-store"

type StoryViewportProps = {
  story: FeedStory | null
}

export function StoryViewport({ story }: StoryViewportProps) {
  const recordedStoryIdsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!story || recordedStoryIdsRef.current.has(story.id)) {
      return
    }

    const startedAt = Date.now()
    const timer = window.setTimeout(() => {
      recordedStoryIdsRef.current.add(story.id)

      void fetch(`/api/stories/${encodeURIComponent(story.id)}/impressions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          viewedMs: Date.now() - startedAt,
          completed: true,
        }),
      }).catch(() => undefined)
    }, 4_000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [story])

  if (!story) {
    return (
      <section className="flex min-h-[720px] flex-col justify-between overflow-hidden rounded-[28px] bg-neutral-950 p-6 text-white shadow-[0_32px_72px_rgba(10,10,10,0.24)]">
        <div className="space-y-4">
          <Badge className="w-fit border-none bg-white/12 text-white">
            Feed waiting on the first story
          </Badge>
          <h2 className="max-w-lg text-3xl font-medium leading-9">
            The feed is real now. Post the first live story and it will render
            here from Neon, not from a mock constant.
          </h2>
          <p className="max-w-md text-sm leading-6 text-white/72">
            Upload an image or video, add a caption, and tag a brand if the post
            should create monetization signals.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-h-[720px] flex-col justify-between overflow-hidden rounded-[28px] bg-neutral-950 shadow-[0_32px_72px_rgba(10,10,10,0.24)]">
      <div className="relative flex-1">
        {story.assetKind === "video" ? (
          <video
            key={story.mediaUrl}
            src={story.mediaUrl}
            poster={story.thumbnailUrl ?? undefined}
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          <Image
            src={story.mediaUrl}
            alt={`${story.creator} featured story`}
            fill
            sizes="(min-width: 1024px) 720px, 100vw"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/75" />

        <div className="relative flex h-full flex-col justify-between p-5 text-white">
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {["bg-white", "bg-white/45", "bg-white/45", "bg-white/45"].map(
                (bar, index) => (
                  <div
                    key={`${bar}-${index}`}
                    className={`h-1 rounded-full ${bar}`}
                  />
                ),
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{story.handle}</p>
                <p className="text-sm text-white/70">{story.creator}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge className="border-none bg-white/14 text-white backdrop-blur">
                  For You
                </Badge>
                <Badge className="border-none bg-[#9BE564] text-neutral-950">
                  Live payout
                </Badge>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="max-w-sm space-y-3">
              <div className="flex flex-wrap gap-2">
                {story.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="border-none bg-white/12 text-white"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>

              <p className="text-2xl font-medium leading-8 sm:text-[2rem] sm:leading-9">
                {story.caption}
              </p>

              <div className="flex flex-wrap gap-3 text-sm text-white/75">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="size-4" />
                  {story.payoutHint}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <TrendingUp className="size-4" />
                  {story.engagement}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button className="bg-white text-neutral-950 hover:bg-white/90">
                <Play className="size-4 fill-current" />
                Watch next
              </Button>
              <Button
                variant="outline"
                className="border-white/25 bg-white/10 text-white hover:bg-white/16 hover:text-white"
              >
                View payout logic
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
