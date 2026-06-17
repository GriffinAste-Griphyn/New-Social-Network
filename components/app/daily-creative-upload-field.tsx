"use client"

import { useEffect, useRef, useState } from "react"
import { put } from "@vercel/blob/client"
import { CheckCircle2, ImageIcon, Loader2, Upload, Video } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type PreparedCreativeUpload = {
  ok: true
  assetKind: "video" | "poster"
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

function fallbackContentType(kind: "video" | "poster") {
  return kind === "video" ? "video/mp4" : "image/jpeg"
}

function uploadLabel(kind: "video" | "poster", state: UploadState) {
  if (state.status === "uploading") {
    return `Uploading ${state.progress}%`
  }

  if (state.status === "ready") {
    return state.fileName
  }

  return kind === "video" ? "Drop video or choose file" : "Drop poster or choose file"
}

async function prepareCreativeUpload(kind: "video" | "poster", file: File) {
  const response = await fetch("/api/advertiser/daily/creative-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetKind: kind,
      fileName: file.name || (kind === "video" ? "daily-video.mp4" : "daily-poster.jpg"),
      contentType: file.type || fallbackContentType(kind),
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
  const posterInputRef = useRef<HTMLInputElement>(null)
  const [draggingKind, setDraggingKind] = useState<"video" | "poster" | null>(null)
  const [videoState, setVideoState] = useState<UploadState>(defaultUploadState)
  const [posterState, setPosterState] = useState<UploadState>(defaultUploadState)
  const [error, setError] = useState<string | null>(null)

  const isUploading =
    videoState.status === "uploading" || posterState.status === "uploading"

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

  async function uploadCreative(kind: "video" | "poster", file: File | null) {
    if (!file || file.size <= 0) {
      return
    }

    const setState = kind === "video" ? setVideoState : setPosterState

    setError(null)
    setState({
      fileName: file.name || (kind === "video" ? "Daily video" : "Daily poster"),
      progress: 0,
      status: "uploading",
      url: "",
    })

    try {
      const prepared = await prepareCreativeUpload(kind, file)
      const blob = await put(prepared.pathname, file, {
        access: "public",
        token: prepared.clientToken,
        contentType: prepared.contentType,
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => {
          setState((current) => ({
            ...current,
            progress: Math.round(percentage),
          }))
        },
      })

      setState({
        fileName: file.name || (kind === "video" ? "Daily video" : "Daily poster"),
        progress: 100,
        status: "ready",
        url: blob.url,
      })
    } catch (uploadError) {
      setState(defaultUploadState)
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Daily creative upload failed.",
      )
    }
  }

  function handleDrop(
    event: React.DragEvent<HTMLButtonElement>,
    kind: "video" | "poster",
  ) {
    event.preventDefault()
    setDraggingKind(null)
    void uploadCreative(kind, event.dataTransfer.files[0] ?? null)
  }

  function renderDropZone(kind: "video" | "poster", state: UploadState) {
    const Icon = kind === "video" ? Video : ImageIcon
    const inputRef = kind === "video" ? videoInputRef : posterInputRef
    const accept =
      kind === "video"
        ? "video/mp4,video/quicktime,video/x-m4v"
        : "image/jpeg,image/png,image/webp"

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-[#71717a]" />
          {kind === "video" ? "Video creative" : "Poster image"}
          {kind === "poster" ? (
            <span className="text-xs font-normal text-[#71717a]">Optional</span>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            void uploadCreative(kind, event.currentTarget.files?.[0] ?? null)
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault()
            setDraggingKind(kind)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDraggingKind(null)}
          onDrop={(event) => handleDrop(event, kind)}
          className={cn(
            "flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-[8px] border border-dashed border-[#d4d4d8] bg-[#fafafa] px-4 py-6 text-center transition-colors",
            "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            draggingKind === kind && "border-[#18181b] bg-white",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-white text-[#18181b] shadow-sm">
            {state.status === "uploading" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : state.status === "ready" ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <Upload className="size-5" />
            )}
          </span>
          <span className="text-sm font-medium text-[#18181b]">
            {uploadLabel(kind, state)}
          </span>
          <span className="text-xs text-[#71717a]">
            {kind === "video" ? "MP4, MOV, or M4V up to 150 MB" : "JPG, PNG, or WEBP up to 5 MB"}
          </span>
          {state.status === "uploading" ? (
            <span className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-[#e4e4e7]">
              <span
                className="block h-full rounded-full bg-[#18181b]"
                style={{ width: `${state.progress}%` }}
              />
            </span>
          ) : null}
        </button>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="space-y-4">
      <input type="hidden" name="videoUrl" value={videoState.url} />
      <input type="hidden" name="thumbnailUrl" value={posterState.url} />

      <div className="grid gap-4 xl:grid-cols-2">
        {renderDropZone("video", videoState)}
        {renderDropZone("poster", posterState)}
      </div>

      {videoState.url || posterState.url ? (
        <div className="grid gap-3 rounded-[8px] border border-[#e4e4e7] bg-white p-3 xl:grid-cols-2">
          {videoState.url ? (
            <video
              src={videoState.url}
              controls
              muted
              playsInline
              className="aspect-video w-full rounded-[6px] bg-black object-cover"
            />
          ) : null}
          {posterState.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={posterState.url}
              alt=""
              className="aspect-video w-full rounded-[6px] bg-[#f4f4f5] object-cover"
            />
          ) : null}
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
