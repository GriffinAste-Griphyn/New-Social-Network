"use client"

import type { PointerEvent } from "react"
import { useEffect, useRef, useState } from "react"
import {
  Camera,
  ChevronDown,
  ImagePlus,
  Link2,
  MoveVertical,
  Type,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const overlayBounds = {
  min: -220,
  max: 220,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function StoryCreateForm() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [overlayText, setOverlayText] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const [activePanel, setActivePanel] = useState<"text" | "link">("text")
  const [textOffset, setTextOffset] = useState(0)
  const [isDraggingText, setIsDraggingText] = useState(false)
  const dragStart = useRef({ pointerY: 0, offset: 0 })
  const previewUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])

  const hasOverlayText = overlayText.trim().length > 0
  const hasLink = linkUrl.trim().length > 0

  const handleMediaChange = (selectedFile: File | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }

    setFile(selectedFile)

    if (!selectedFile) {
      setPreviewUrl(null)
      return
    }

    const objectUrl = URL.createObjectURL(selectedFile)
    previewUrlRef.current = objectUrl
    setPreviewUrl(objectUrl)
  }

  const beginTextDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!hasOverlayText) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = {
      pointerY: event.clientY,
      offset: textOffset,
    }
    setIsDraggingText(true)
  }

  const moveText = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingText) {
      return
    }

    const delta = event.clientY - dragStart.current.pointerY
    setTextOffset(clamp(dragStart.current.offset + delta, overlayBounds.min, overlayBounds.max))
  }

  const endTextDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsDraggingText(false)
  }

  return (
    <form
      action="/api/stories"
      method="post"
      encType="multipart/form-data"
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_390px]"
    >
      <input type="hidden" name="caption" value="" />
      <input type="hidden" name="brandTags" value="" />
      <input type="hidden" name="stickers" value="" />
      <input type="hidden" name="textOverlays" value={overlayText.trim()} />
      <input type="hidden" name="linkLabel" value={hasLink ? "Open link" : ""} />
      <input type="hidden" name="linkUrl" value={linkUrl.trim()} />

      <section className="overflow-hidden rounded-[28px] bg-[#050608] shadow-[0_24px_70px_rgba(15,23,42,0.18)] lg:rounded-[8px]">
        <div className="relative mx-auto flex min-h-[72svh] max-w-[520px] items-center justify-center overflow-hidden bg-neutral-950 lg:min-h-[760px] lg:max-w-none">
          {previewUrl ? (
            file?.type.startsWith("video/") ? (
              <video
                src={previewUrl}
                className="absolute inset-0 h-full w-full object-cover"
                controls
                playsInline
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Selected story preview"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )
          ) : (
            <div className="space-y-4 px-8 text-center text-white">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-white/10">
                <Camera className="size-7" />
              </div>
              <div>
                <p className="text-xl font-medium">Create your story</p>
                <p className="mt-2 max-w-sm text-sm leading-6 text-white/62">
                  Take a photo or choose one from your camera roll.
                </p>
              </div>
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-b from-black/28 via-transparent to-black/56" />

          <div className="absolute left-4 right-4 top-4 flex items-center justify-between gap-3 text-white lg:left-5 lg:right-5">
            <a
              href="/feed"
              aria-label="Back to feed"
              className="flex size-10 items-center justify-center rounded-full bg-black/34 backdrop-blur"
            >
              <ChevronDown className="size-5 rotate-90" />
            </a>
            <div className="rounded-full bg-black/34 px-4 py-2 text-sm font-medium backdrop-blur">
              My Story
            </div>
          </div>

          <div className="absolute right-4 top-20 flex flex-col gap-2 lg:right-5">
            <button
              type="button"
              aria-label="Add text"
              onClick={() => setActivePanel("text")}
              className={cn(
                "flex size-10 items-center justify-center rounded-full text-white backdrop-blur transition",
                activePanel === "text" ? "bg-[#e01616]" : "bg-black/38",
              )}
            >
              <Type className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Add link"
              onClick={() => setActivePanel("link")}
              className={cn(
                "flex size-10 items-center justify-center rounded-full text-white backdrop-blur transition",
                activePanel === "link" ? "bg-[#e01616]" : "bg-black/38",
              )}
            >
              <Link2 className="size-5" />
            </button>
          </div>

          {hasOverlayText ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="Drag text overlay up or down"
              onPointerDown={beginTextDrag}
              onPointerMove={moveText}
              onPointerUp={endTextDrag}
              onPointerCancel={endTextDrag}
              className={cn(
                "absolute left-0 right-0 top-[47%] cursor-ns-resize select-none bg-black/34 px-6 py-2 text-center text-[1.35rem] font-medium leading-tight text-white backdrop-blur-[2px]",
                isDraggingText ? "bg-black/48" : null,
              )}
              style={{ transform: `translateY(${textOffset}px)` }}
            >
              {overlayText.trim()}
            </div>
          ) : null}

          {hasLink ? (
            <button
              type="button"
              onClick={() => setActivePanel("link")}
              className="absolute bottom-24 left-5 right-5 flex min-h-10 items-center gap-2 rounded-full bg-black/42 px-4 text-left text-sm font-medium text-white backdrop-blur lg:left-6 lg:right-auto lg:max-w-[320px]"
            >
              <Link2 className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{linkUrl.trim()}</span>
            </button>
          ) : null}

          <div className="absolute bottom-5 left-6 right-6">
            <Button
              type="submit"
              className="h-11 w-full rounded-full bg-[#e01616]/90 text-sm font-medium text-white hover:bg-[#c91414] lg:mx-auto lg:max-w-[260px]"
            >
              Upload to Story
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[8px] bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)] lg:sticky lg:top-6 lg:self-start">
        <div className="mb-5">
          <p className="text-sm font-medium text-[#e01616]">Web story editor</p>
          <h2 className="mt-1 text-2xl font-[350] tracking-tight text-[#17191f]">
            Upload to My Story
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#6b7280]">
            Desktop and mobile web share the same clean flow. Add media, optional
            text, and one link.
          </p>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <label
              htmlFor="media"
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-[#111827] px-4 text-sm font-medium text-white"
            >
              <Camera className="size-4" />
              Camera
            </label>
            <label
              htmlFor="media"
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-[#f5f6f8] px-4 text-sm font-medium text-[#374151]"
            >
              <ImagePlus className="size-4" />
              Camera roll
            </label>
            <Input
              id="media"
              name="media"
              type="file"
              accept="image/*,video/*"
              capture="environment"
              required
              className="sr-only"
              onChange={(event) => handleMediaChange(event.target.files?.[0] ?? null)}
            />
          </div>

          <div className="rounded-[8px] bg-[#f5f6f8] p-3">
            <button
              type="button"
              onClick={() => setActivePanel("text")}
              className="mb-2 flex items-center gap-2 text-sm font-medium text-[#374151]"
            >
              <Type className="size-4" />
              Text
            </button>
            <Input
              value={overlayText}
              onFocus={() => setActivePanel("text")}
              onChange={(event) => setOverlayText(event.target.value)}
              maxLength={64}
              placeholder="Add text"
              className="h-11 border-0 bg-white"
            />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[#6b7280]">
              <MoveVertical className="size-3.5" />
              Drag the text on the preview to move it up or down.
            </p>
          </div>

          <div className="rounded-[8px] bg-[#f5f6f8] p-3">
            <button
              type="button"
              onClick={() => setActivePanel("link")}
              className="mb-2 flex items-center gap-2 text-sm font-medium text-[#374151]"
            >
              <Link2 className="size-4" />
              Link
            </button>
            <Input
              value={linkUrl}
              onFocus={() => setActivePanel("link")}
              onChange={(event) => setLinkUrl(event.target.value)}
              type="url"
              placeholder="https://example.com"
              className="h-11 border-0 bg-white"
            />
          </div>
        </div>
      </section>
    </form>
  )
}
