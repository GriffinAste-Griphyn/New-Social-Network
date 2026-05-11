"use client"

import { useState } from "react"
import { Flag, MoreHorizontal, UserX } from "lucide-react"

export function StoryActionsMenu({
  creatorId,
  storyId,
}: {
  creatorId: string
  storyId: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const reportStory = async () => {
    if (isSubmitting) return

    setIsSubmitting(true)
    setMessage(null)

    try {
      const response = await fetch(
        `/api/stories/${encodeURIComponent(storyId)}/report`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: "other" }),
        },
      )
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not report this story.")
      }

      setMessage("Report sent.")
      setIsOpen(false)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not report this story.",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const blockCreator = async () => {
    if (isSubmitting) return

    setIsSubmitting(true)
    setMessage(null)

    try {
      const response = await fetch("/api/blocks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ blockedUserId: creatorId }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not block this user.")
      }

      window.location.reload()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not block this user.",
      )
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Open story options"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex size-9 items-center justify-center rounded-full bg-black/28 text-white backdrop-blur transition hover:bg-black/42"
      >
        <MoreHorizontal className="size-5" />
      </button>
      {isOpen ? (
        <div className="absolute right-0 top-11 z-20 w-52 rounded-[8px] border border-white/12 bg-neutral-950/94 p-2 text-sm shadow-[0_18px_48px_rgba(0,0,0,0.34)] backdrop-blur">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={reportStory}
            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left font-medium text-white hover:bg-white/10 disabled:opacity-60"
          >
            <Flag className="size-4" />
            Report content
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={blockCreator}
            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left font-medium text-[#fecdd3] hover:bg-white/10 disabled:opacity-60"
          >
            <UserX className="size-4" />
            Block user
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="absolute right-0 top-11 z-10 w-52 rounded-[8px] bg-black/70 px-3 py-2 text-xs text-white shadow-lg">
          {message}
        </p>
      ) : null}
    </div>
  )
}
