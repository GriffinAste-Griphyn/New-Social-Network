"use client"

import { useState } from "react"
import { put } from "@vercel/blob/client"
import { Camera, Clapperboard, Coins, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type StoryComposerProps = {
  handle: string
}

type PreparedImageUpload = {
  ok: true
  assetKind: "image"
  pathname: string
  clientToken: string
  contentType: string
}

type PreparedVideoUpload = {
  ok: true
  assetKind: "video"
  uid: string
  uploadUrl: string
  uploadProtocol: "tus"
}

type PreparedLegacyUpload = {
  ok: true
  assetKind: "image" | "video"
  uploadProtocol: "legacy"
}

type PreparedUpload = PreparedImageUpload | PreparedVideoUpload | PreparedLegacyUpload

function fileAssetKind(file: File) {
  if (file.type.startsWith("image/")) {
    return "image" as const
  }

  if (file.type.startsWith("video/")) {
    return "video" as const
  }

  return null
}

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function imageDimensions(file: File) {
  return new Promise<{ width: number | null; height: number | null }>((resolve) => {
    const image = new Image()
    const url = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: null, height: null })
    }
    image.src = url
  })
}

function videoMetadata(file: File) {
  return new Promise<{
    width: number | null
    height: number | null
    durationMs: number | null
  }>((resolve) => {
    const video = document.createElement("video")
    const url = URL.createObjectURL(file)

    video.preload = "metadata"
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve({
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        durationMs: Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : null,
      })
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: null, height: null, durationMs: null })
    }
    video.src = url
  })
}

function uploadTusFile(input: {
  uploadUrl: string
  file: File
  onProgress: (percent: number) => void
}) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.open("PATCH", input.uploadUrl)
    xhr.setRequestHeader("Tus-Resumable", "1.0.0")
    xhr.setRequestHeader("Upload-Offset", "0")
    xhr.setRequestHeader("Upload-Length", input.file.size.toString())
    xhr.setRequestHeader("Content-Type", "application/offset+octet-stream")
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress(100)
        resolve()
      } else {
        reject(new Error("Video upload failed."))
      }
    }
    xhr.onerror = () => reject(new Error("Video upload failed."))
    xhr.send(input.file)
  })
}

export function StoryComposer({ handle }: StoryComposerProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isUploading) {
      return
    }

    const form = event.currentTarget
    const formData = new FormData(form)
    const mediaEntry = formData.get("media")

    if (!(mediaEntry instanceof File) || mediaEntry.size <= 0) {
      setError("Choose an image or video before posting.")
      return
    }

    const assetKind = fileAssetKind(mediaEntry)

    if (!assetKind) {
      setError("Choose a supported image or video file.")
      return
    }

    setIsUploading(true)
    setProgress(0)
    setStatusText("Preparing upload")
    setError(null)

    try {
      const prepareResponse = await fetch("/api/stories/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetKind,
          fileName: mediaEntry.name || (assetKind === "image" ? "story.jpg" : "story.mp4"),
          contentType: mediaEntry.type || (assetKind === "image" ? "image/jpeg" : "video/mp4"),
          byteSize: mediaEntry.size,
        }),
      })
      const prepared = (await prepareResponse.json().catch(() => null)) as
        | (PreparedUpload & { error?: string })
        | null

      if (!prepareResponse.ok || !prepared?.ok) {
        throw new Error(prepared?.error ?? "Could not prepare the upload.")
      }

      if ("uploadProtocol" in prepared && prepared.uploadProtocol === "legacy") {
        setStatusText("Uploading story")
        const legacyResponse = await fetch("/api/stories", {
          method: "POST",
          body: formData,
        })

        window.location.assign(
          legacyResponse.redirected ? legacyResponse.url : "/app?story=created",
        )
        return
      }

      const checksum = await sha256Hex(mediaEntry)
      let completionPayload:
        | Record<string, string | number | null>
        | undefined

      if (prepared.assetKind === "image") {
        const dimensions = await imageDimensions(mediaEntry)

        setStatusText("Uploading image")
        await put(prepared.pathname, mediaEntry, {
          access: "private",
          token: prepared.clientToken,
          contentType: prepared.contentType,
          multipart: mediaEntry.size > 8 * 1024 * 1024,
          onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
        })

        completionPayload = {
          assetKind: "image",
          pathname: prepared.pathname,
          contentType: prepared.contentType,
          byteSize: mediaEntry.size,
          checksum,
          width: dimensions.width,
          height: dimensions.height,
        }
      } else {
        const metadata = await videoMetadata(mediaEntry)

        setStatusText("Uploading video")
        await uploadTusFile({
          uploadUrl: prepared.uploadUrl,
          file: mediaEntry,
          onProgress: setProgress,
        })

        completionPayload = {
          assetKind: "video",
          uid: prepared.uid,
          contentType: mediaEntry.type || "video/mp4",
          byteSize: mediaEntry.size,
          checksum,
          durationMs: metadata.durationMs,
          width: metadata.width,
          height: metadata.height,
        }
      }

      setStatusText("Finishing story")
      const completeResponse = await fetch("/api/stories/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...completionPayload,
          caption: formData.get("caption")?.toString() ?? "",
          brandTags: formData.get("brandTags")?.toString() ?? "",
        }),
      })
      const completed = (await completeResponse.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null

      if (!completeResponse.ok || !completed?.ok) {
        throw new Error(completed?.error ?? "Could not finish the story.")
      }

      window.location.assign("/app?story=created")
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Story upload failed. Try again.",
      )
      setStatusText("")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Card id="composer" className="bg-white">
      <CardHeader className="space-y-3">
        <Badge
          variant="secondary"
          className="w-fit border-none bg-[#9BE564]/35 text-neutral-950"
        >
          Story composer
        </Badge>
        <div className="space-y-1">
          <CardTitle>Post a story from @{handle}</CardTitle>
          <CardDescription>
            Stories go live for 24 hours. Brand tags and caption mentions become
            payout signals the moment the post lands.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="media" className="text-sm font-medium text-foreground">
              Story asset
            </label>
            <Input
              id="media"
              name="media"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              required
            />
            <p className="text-xs text-muted-foreground">
              JPG, PNG, WEBP, or video. Images upload up to 25 MB; videos upload
              directly to processing storage.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="caption" className="text-sm font-medium text-foreground">
              Caption
            </label>
            <Textarea
              id="caption"
              name="caption"
              className="min-h-28 resize-none"
              placeholder="Drop the context, scene, or brand mention here."
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="brandTags"
              className="text-sm font-medium text-foreground"
            >
              Brand tags
            </label>
            <Input
              id="brandTags"
              name="brandTags"
              placeholder="nike, matcha-house, local-run-club"
            />
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground">
            <div className="inline-flex items-center gap-2">
              <Camera className="size-4" />
              <span>Posting is available from the same account people use to follow and reply.</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <Clapperboard className="size-4" />
              <span>Video and image stories share the same feed surface.</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <Coins className="size-4" />
              <span>Explicit tags and caption mentions both write monetization signals.</span>
            </div>
          </div>

          {isUploading ? (
            <div className="space-y-2 rounded-[8px] border bg-muted/35 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{statusText}</span>
                <span className="font-mono text-muted-foreground">{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-[8px] bg-muted">
                <div
                  className="h-full bg-foreground transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isUploading}>
            {isUploading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Posting
              </>
            ) : (
              "Post story"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
