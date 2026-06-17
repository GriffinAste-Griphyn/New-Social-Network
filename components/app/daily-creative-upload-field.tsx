"use client"

import type { DragEvent } from "react"
import { useEffect, useRef, useState } from "react"
import { put } from "@vercel/blob/client"
import { CheckCircle2, Loader2, Upload, Video } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type PreparedCreativeUpload = {
  ok: true
  assetKind: "video"
  pathname: string
  clientToken: string
  contentType: string
  maxSizeBytes: number
}

type UploadState = {
  fileName: string
  progress: number
  status: "idle" | "uploading" | "ready"
  url: string
}

const defaultUploadState: UploadState = {
  fileName: "",
  progress: 0,
  status: "idle",
  url: "",
}

function uploadLabel(state: UploadState) {
  if (state.status === "uploading") {
    return `Uploading ${state.progress}%`
  }

  if (state.status === "ready") {
    return state.fileName
  }

  return "Drop video or choose file"
}

async function prepareCreativeUpload(file: File) {
  const response = await fetch("/api/advertiser/daily/creative-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetKind: "video",
      fileName: file.name || "daily-video.mp4",
      contentType: file.type || "video/mp4",
      byteSize: file.size,
    }),
  })
  const payload = (await response.json().catch(() => null)) as
    | (PreparedCreativeUpload & { error?: string })
    | null

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? "Could not prepare the Daily creative upload.")
  }

  return payload
}

export function DailyCreativeUploadField() {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [videoState, setVideoState] = useState<UploadState>(defaultUploadState)
  const [error, setError] = useState<string | null>(null)

  const isUploading = videoState.status === "uploading"

  useEffect(() => {
    const form = rootRef.current?.closest("form")
    if (!form) {
      return
    }

    function handleSubmit(event: SubmitEvent) {
      if (isUploading) {
        event.preventDefault()
        event.stopPropagation()
        setError("Wait for the Daily creative upload to finish.")
        return
      }

      if (!videoState.url) {
        event.preventDefault()
        event.stopPropagation()
        setError("Upload a Daily video creative before creating the campaign.")
      }
    }

    form.addEventListener("submit", handleSubmit)

    return () => form.removeEventListener("submit", handleSubmit)
  }, [isUploading, videoState.url])

  async function uploadCreative(file: File | null) {
    if (!file || file.size <= 0) {
      return
    }

    setError(null)
    setVideoState({
      fileName: file.name || "Daily video",
      progress: 0,
      status: "uploading",
      url: "",
    })

    try {
      const prepared = await prepareCreativeUpload(file)
      const blob = await put(prepared.pathname, file, {
        access: "public",
        token: prepared.clientToken,
        contentType: prepared.contentType,
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => {
          setVideoState((current) => ({
            ...current,
            progress: Math.round(percentage),
          }))
        },
      })

      setVideoState({
        fileName: file.name || "Daily video",
        progress: 100,
        status: "ready",
        url: blob.url,
      })
    } catch (uploadError) {
      setVideoState(defaultUploadState)
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Daily creative upload failed.",
      )
    }
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setIsDragging(false)
    void uploadCreative(event.dataTransfer.files[0] ?? null)
  }

  return (
    <div ref={rootRef} className="space-y-4">
      <input type="hidden" name="videoUrl" value={videoState.url} />

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Video className="size-4 text-[#71717a]" />
          Video creative
        </div>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/x-m4v"
          className="sr-only"
          onChange={(event) => {
            void uploadCreative(event.currentTarget.files?.[0] ?? null)
          }}
        />
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-[8px] border border-dashed border-[#d4d4d8] bg-[#fafafa] px-4 py-6 text-center transition-colors",
            "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            isDragging && "border-[#18181b] bg-white",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-white text-[#18181b] shadow-sm">
            {videoState.status === "uploading" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : videoState.status === "ready" ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <Upload className="size-5" />
            )}
          </span>
          <span className="text-sm font-medium text-[#18181b]">
            {uploadLabel(videoState)}
          </span>
          <span className="text-xs text-[#71717a]">
            MP4, MOV, or M4V up to 150 MB
          </span>
          {videoState.status === "uploading" ? (
            <span className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-[#e4e4e7]">
              <span
                className="block h-full rounded-full bg-[#18181b]"
                style={{ width: `${videoState.progress}%` }}
              />
            </span>
          ) : null}
        </button>
      </div>

      {videoState.url ? (
        <div className="rounded-[8px] border border-[#e4e4e7] bg-white p-3">
          <video
            src={videoState.url}
            controls
            muted
            playsInline
            className="aspect-video w-full rounded-[6px] bg-black object-cover"
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-[#991b1b]">
          {error}
        </div>
      ) : null}

      {isUploading ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full rounded-[8px] border-[#d4d4d8] bg-white"
          disabled
        >
          <Loader2 className="size-4 animate-spin" />
          Uploading creative
        </Button>
      ) : null}
    </div>
  )
}
