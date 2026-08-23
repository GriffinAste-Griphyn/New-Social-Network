"use client"

import { useEffect, useRef, useState } from "react"
import { put } from "@vercel/blob/client"
import { Camera, Clapperboard, Coins, Loader2 } from "lucide-react"
import { rgbaToThumbHash } from "thumbhash"

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
import { highestQualityImageWithinBudget } from "@/lib/story-image-encoding"
import {
  isSupportedStoryImageInputContentType,
  isSupportedStoryVideoInputContentType,
  storyMediaContract,
  storyMediaInputAccept,
} from "@/lib/story-media-contract"

type StoryComposerProps = {
  handle: string
}

type PreparedImageUpload = {
  ok: true
  assetKind: "image"
  basePathname: string
  display: PreparedImageUploadPart
  thumbnail: PreparedImageUploadPart
}

type PreparedImageUploadPart = {
  pathname: string
  clientToken: string
  contentType: "image/avif" | "image/webp"
  maxSizeBytes: number
}

type PreparedVideoUpload = {
  ok: true
  assetKind: "video"
  uploadSessionId: string
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

const tusVersion = "1.0.0"
const tusChunkSizeBytes = 3 * 1024 * 1024
const tusRequestTimeoutMs = 5 * 60 * 1000
const tusMaxTransientRetries = 4
const videoUploadIdentityStoragePrefix = "ubeye:story-video-upload:v1:"
const terminalTusStatuses = new Set([403, 404, 410])
const transientTusStatuses = new Set([408, 409, 412, 423, 425, 429])
const inMemoryVideoUploadIdentities = new Map<
  string,
  VideoUploadIdentity
>()
const clientUploadIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type VideoUploadIdentity = {
  clientUploadId: string
  replaceUploadSessionId?: string
}

type TusUploadErrorKind = "permanent" | "protocol" | "transient"

class TusUploadError extends Error {
  constructor(
    message: string,
    readonly kind: TusUploadErrorKind,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = "TusUploadError"
  }
}

class TusUploadSessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "TusUploadSessionError"
  }
}

function fileAssetKind(file: File) {
  if (file.type.startsWith("image/")) {
    return "image" as const
  }

  if (file.type.startsWith("video/")) {
    return "video" as const
  }

  const extension = file.name.split(".").pop()?.toLowerCase()
  if (["jpg", "jpeg", "png", "webp"].includes(extension ?? "")) {
    return "image" as const
  }
  if (["mp4", "mov", "webm"].includes(extension ?? "")) {
    return "video" as const
  }

  return null
}

function resolvedMediaContentType(file: File, assetKind: "image" | "video") {
  if (file.type) {
    return file.type.toLowerCase()
  }

  const extension = file.name.split(".").pop()?.toLowerCase()
  if (assetKind === "image") {
    if (extension === "png") return "image/png"
    if (extension === "webp") return "image/webp"
    return "image/jpeg"
  }

  if (extension === "mov") return "video/quicktime"
  if (extension === "webm") return "video/webm"
  return "video/mp4"
}

async function sha256Hex(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

type BrowserImageDerivative = {
  blob: Blob
  contentType: "image/avif" | "image/webp"
  width: number
  height: number
}

async function canvasBlob(
  canvas: HTMLCanvasElement,
  contentType: "image/avif" | "image/webp",
  quality: number,
) {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, contentType, quality),
  )
  return blob?.type === contentType ? blob : null
}

async function highestQualityCanvasBlobWithinBudget(
  canvas: HTMLCanvasElement,
  contentType: "image/avif" | "image/webp",
  qualities: readonly number[],
  maxByteSize: number,
) {
  return highestQualityImageWithinBudget({
    qualities,
    maxByteSize,
    encode: (quality) => canvasBlob(canvas, contentType, quality),
  })
}

function storyCanvas(image: ImageBitmap, width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new Error("Could not prepare this image.")

  context.fillStyle = "#000000"
  context.fillRect(0, 0, width, height)

  const containScale = Math.min(width / image.width, height / image.height)
  const containWidth = image.width * containScale
  const containHeight = image.height * containScale
  context.drawImage(
    image,
    (width - containWidth) / 2,
    (height - containHeight) / 2,
    containWidth,
    containHeight,
  )
  return canvas
}

function base64Url(bytes: Uint8Array) {
  let binary = ""
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

async function buildBrowserImageDerivatives(file: File) {
  const image = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    const displayCanvas = storyCanvas(
      image,
      storyMediaContract.canvas.width,
      storyMediaContract.canvas.height,
    )
    const thumbnailCanvas = storyCanvas(
      image,
      storyMediaContract.thumbnail.width,
      storyMediaContract.thumbnail.height,
    )
    const avifDisplay = await highestQualityCanvasBlobWithinBudget(
      displayCanvas,
      "image/avif",
      storyMediaContract.imageEncoding.displayAvifQualities,
      storyMediaContract.upload.maxImageDisplayDerivativeBytes,
    )
    const displayBlob =
      avifDisplay ??
      (await highestQualityCanvasBlobWithinBudget(
        displayCanvas,
        "image/webp",
        storyMediaContract.imageEncoding.displayWebpQualities,
        storyMediaContract.upload.maxImageDisplayDerivativeBytes,
      ))
    const thumbnailBlob = await highestQualityCanvasBlobWithinBudget(
      thumbnailCanvas,
      "image/webp",
      storyMediaContract.imageEncoding.thumbnailWebpQualities,
      storyMediaContract.upload.maxImageThumbnailDerivativeBytes,
    )
    if (!displayBlob || !thumbnailBlob) {
      throw new Error("This image could not fit the story upload limits.")
    }
    if (
      displayBlob.size >
        storyMediaContract.upload.maxImageDisplayDerivativeBytes ||
      thumbnailBlob.size >
        storyMediaContract.upload.maxImageThumbnailDerivativeBytes
    ) {
      throw new Error("This image could not fit the story upload limits.")
    }

    const hashCanvas = document.createElement("canvas")
    hashCanvas.width = 18
    hashCanvas.height = 32
    const hashContext = hashCanvas.getContext("2d")
    if (!hashContext) throw new Error("Could not prepare this image.")
    hashContext.drawImage(thumbnailCanvas, 0, 0, 18, 32)
    const rgba = hashContext.getImageData(0, 0, 18, 32).data

    return {
      display: {
        blob: displayBlob,
        contentType: displayBlob.type as BrowserImageDerivative["contentType"],
        width: storyMediaContract.canvas.width,
        height: storyMediaContract.canvas.height,
      } satisfies BrowserImageDerivative,
      thumbnail: {
        blob: thumbnailBlob,
        contentType: "image/webp",
        width: storyMediaContract.thumbnail.width,
        height: storyMediaContract.thumbnail.height,
      } satisfies BrowserImageDerivative,
      thumbHash: base64Url(
        rgbaToThumbHash(
          18,
          32,
          new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
        ),
      ),
    }
  } finally {
    image.close()
  }
}

function videoUploadFingerprint(file: File, checksum: string) {
  return `${checksum}:${file.size}:${file.type.toLowerCase() || "video"}`
}

function uuidFromChecksum(checksum: string) {
  const hex = checksum.slice(0, 32).split("")

  hex[12] = "5"
  hex[16] = (8 + (Number.parseInt(hex[16] ?? "0", 16) % 4)).toString(16)

  return [
    hex.slice(0, 8).join(""),
    hex.slice(8, 12).join(""),
    hex.slice(12, 16).join(""),
    hex.slice(16, 20).join(""),
    hex.slice(20, 32).join(""),
  ].join("-")
}

function videoUploadStorageKey(fingerprint: string) {
  return `${videoUploadIdentityStoragePrefix}${fingerprint}`
}

function isValidUploadSessionId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100
}

function parseStoredVideoUploadIdentity(
  storedValue: string,
): VideoUploadIdentity | null {
  if (clientUploadIdPattern.test(storedValue)) {
    return { clientUploadId: storedValue }
  }

  try {
    const parsed = JSON.parse(storedValue) as Partial<VideoUploadIdentity>

    if (
      typeof parsed.clientUploadId !== "string" ||
      !clientUploadIdPattern.test(parsed.clientUploadId) ||
      (parsed.replaceUploadSessionId !== undefined &&
        !isValidUploadSessionId(parsed.replaceUploadSessionId))
    ) {
      return null
    }

    return {
      clientUploadId: parsed.clientUploadId,
      ...(parsed.replaceUploadSessionId
        ? { replaceUploadSessionId: parsed.replaceUploadSessionId }
        : {}),
    }
  } catch {
    return null
  }
}

function storeVideoUploadIdentity(
  fingerprint: string,
  identity: VideoUploadIdentity,
) {
  inMemoryVideoUploadIdentities.set(fingerprint, identity)

  try {
    window.sessionStorage.setItem(
      videoUploadStorageKey(fingerprint),
      JSON.stringify(identity),
    )
  } catch {
    // The in-memory identity still deduplicates retries in the current page.
  }
}

function getOrCreateVideoUploadIdentity(
  fingerprint: string,
  checksum: string,
) {
  const inMemoryIdentity = inMemoryVideoUploadIdentities.get(fingerprint)

  if (inMemoryIdentity) {
    return inMemoryIdentity
  }

  try {
    const storedValue = window.sessionStorage.getItem(
      videoUploadStorageKey(fingerprint),
    )
    const storedIdentity = storedValue
      ? parseStoredVideoUploadIdentity(storedValue)
      : null

    if (storedIdentity) {
      inMemoryVideoUploadIdentities.set(fingerprint, storedIdentity)
      return storedIdentity
    }

    if (storedValue) {
      window.sessionStorage.removeItem(videoUploadStorageKey(fingerprint))
    }
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers.
  }

  const clientUploadId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : uuidFromChecksum(checksum)
  const identity = { clientUploadId }

  storeVideoUploadIdentity(fingerprint, identity)

  return identity
}

function markVideoUploadSessionForReplacement(
  fingerprint: string,
  clientUploadId: string,
  uploadSessionId: string,
) {
  storeVideoUploadIdentity(fingerprint, {
    clientUploadId,
    replaceUploadSessionId: uploadSessionId,
  })
}

function clearVideoUploadReplacement(
  fingerprint: string,
  clientUploadId: string,
) {
  storeVideoUploadIdentity(fingerprint, { clientUploadId })
}

function clearVideoUploadIdentity(fingerprint: string) {
  inMemoryVideoUploadIdentities.delete(fingerprint)

  try {
    window.sessionStorage.removeItem(videoUploadStorageKey(fingerprint))
  } catch {
    // Nothing else is required when session storage is unavailable.
  }
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

function abortError() {
  return new DOMException("The upload was canceled.", "AbortError")
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function tusHttpError(status: number, operation: "check" | "upload") {
  if (terminalTusStatuses.has(status)) {
    return new TusUploadSessionError(
      "This video upload session expired or is no longer available. Submit again to start a fresh upload.",
      status,
    )
  }

  if (transientTusStatuses.has(status) || status >= 500) {
    return new TusUploadError(
      `The video upload ${operation} is temporarily unavailable.`,
      "transient",
      status,
    )
  }

  return new TusUploadError(
    `The video upload ${operation} failed (${status}).`,
    "permanent",
    status,
  )
}

function parseTusIntegerHeader(value: string | null, headerName: string) {
  const normalized = value?.trim() ?? ""

  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    throw new TusUploadError(
      `The upload service returned an invalid ${headerName} header.`,
      "protocol",
    )
  }

  const parsed = Number(normalized)

  if (!Number.isSafeInteger(parsed)) {
    throw new TusUploadError(
      `The upload service returned an invalid ${headerName} header.`,
      "protocol",
    )
  }

  return parsed
}

function uploadProgressPercent(uploadedBytes: number, totalBytes: number) {
  if (uploadedBytes >= totalBytes) {
    return 100
  }

  return Math.max(0, Math.min(99, Math.floor((uploadedBytes / totalBytes) * 100)))
}

function waitForTusRetry(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort)
      resolve()
    }, delayMs)
    const handleAbort = () => {
      window.clearTimeout(timeoutId)
      reject(abortError())
    }

    signal.addEventListener("abort", handleAbort, { once: true })
  })
}

function tusRetryDelay(attempt: number) {
  return Math.min(4_000, 500 * 2 ** attempt)
}

function readTusOffset(input: {
  uploadUrl: string
  fileSize: number
  signal: AbortSignal
}) {
  if (input.signal.aborted) {
    return Promise.reject(abortError())
  }

  return new Promise<number>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) {
        return
      }

      settled = true
      input.signal.removeEventListener("abort", handleAbort)
      callback()
    }
    const handleAbort = () => xhr.abort()

    xhr.open("HEAD", input.uploadUrl)
    xhr.timeout = tusRequestTimeoutMs
    xhr.setRequestHeader("Tus-Resumable", tusVersion)
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(() => reject(tusHttpError(xhr.status, "check")))
        return
      }

      try {
        const offset = parseTusIntegerHeader(
          xhr.getResponseHeader("Upload-Offset"),
          "Upload-Offset",
        )
        const uploadLengthHeader = xhr.getResponseHeader("Upload-Length")

        if (
          uploadLengthHeader !== null &&
          parseTusIntegerHeader(uploadLengthHeader, "Upload-Length") !==
            input.fileSize
        ) {
          throw new TusUploadError(
            "The upload session belongs to a different video.",
            "protocol",
          )
        }

        if (offset > input.fileSize) {
          throw new TusUploadError(
            "The upload service returned an offset beyond the end of the video.",
            "protocol",
          )
        }

        finish(() => resolve(offset))
      } catch (error) {
        finish(() => reject(error))
      }
    }
    xhr.onerror = () =>
      finish(() =>
        reject(
          new TusUploadError(
            "The video upload check lost its network connection.",
            "transient",
          ),
        ),
      )
    xhr.ontimeout = () =>
      finish(() =>
        reject(
          new TusUploadError(
            "The video upload check timed out.",
            "transient",
          ),
        ),
      )
    xhr.onabort = () => finish(() => reject(abortError()))
    input.signal.addEventListener("abort", handleAbort, { once: true })
    xhr.send()
  })
}

async function readTusOffsetWithRetry(input: {
  uploadUrl: string
  fileSize: number
  signal: AbortSignal
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readTusOffset(input)
    } catch (error) {
      if (
        !(error instanceof TusUploadError) ||
        error.kind !== "transient" ||
        attempt >= tusMaxTransientRetries
      ) {
        throw error
      }

      await waitForTusRetry(tusRetryDelay(attempt), input.signal)
    }
  }
}

function patchTusChunk(input: {
  uploadUrl: string
  file: File
  offset: number
  chunkEnd: number
  signal: AbortSignal
  onProgress: (uploadedBytes: number) => void
}) {
  if (input.signal.aborted) {
    return Promise.reject(abortError())
  }

  return new Promise<number>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) {
        return
      }

      settled = true
      input.signal.removeEventListener("abort", handleAbort)
      callback()
    }
    const handleAbort = () => xhr.abort()

    xhr.open("PATCH", input.uploadUrl)
    xhr.timeout = tusRequestTimeoutMs
    xhr.setRequestHeader("Tus-Resumable", tusVersion)
    xhr.setRequestHeader("Upload-Offset", input.offset.toString())
    xhr.setRequestHeader("Content-Type", "application/offset+octet-stream")
    xhr.upload.onprogress = (event) => {
      const loadedBytes = Math.min(event.loaded, input.chunkEnd - input.offset)
      input.onProgress(input.offset + loadedBytes)
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(() => reject(tusHttpError(xhr.status, "upload")))
        return
      }

      try {
        const confirmedOffset = parseTusIntegerHeader(
          xhr.getResponseHeader("Upload-Offset"),
          "Upload-Offset",
        )

        if (confirmedOffset !== input.chunkEnd) {
          throw new TusUploadError(
            "The upload service confirmed an unexpected video offset.",
            "protocol",
          )
        }

        finish(() => resolve(confirmedOffset))
      } catch (error) {
        finish(() => reject(error))
      }
    }
    xhr.onerror = () =>
      finish(() =>
        reject(
          new TusUploadError(
            "The video upload lost its network connection.",
            "transient",
          ),
        ),
      )
    xhr.ontimeout = () =>
      finish(() =>
        reject(
          new TusUploadError("The video upload timed out.", "transient"),
        ),
      )
    xhr.onabort = () => finish(() => reject(abortError()))
    input.signal.addEventListener("abort", handleAbort, { once: true })
    xhr.send(input.file.slice(input.offset, input.chunkEnd))
  })
}

async function uploadTusFile(input: {
  uploadUrl: string
  file: File
  signal: AbortSignal
  onProgress: (percent: number) => void
}) {
  let offset = await readTusOffsetWithRetry({
    uploadUrl: input.uploadUrl,
    fileSize: input.file.size,
    signal: input.signal,
  })
  let transientAttempts = 0

  input.onProgress(uploadProgressPercent(offset, input.file.size))

  while (offset < input.file.size) {
    const chunkStart = offset
    const chunkEnd = Math.min(offset + tusChunkSizeBytes, input.file.size)

    try {
      offset = await patchTusChunk({
        uploadUrl: input.uploadUrl,
        file: input.file,
        offset,
        chunkEnd,
        signal: input.signal,
        onProgress: (uploadedBytes) =>
          input.onProgress(
            Math.min(
              99,
              uploadProgressPercent(uploadedBytes, input.file.size),
            ),
          ),
      })
      transientAttempts = 0
      input.onProgress(uploadProgressPercent(offset, input.file.size))
    } catch (error) {
      if (
        !(error instanceof TusUploadError) ||
        error.kind !== "transient"
      ) {
        throw error
      }

      if (transientAttempts >= tusMaxTransientRetries) {
        throw new TusUploadError(
          "The video upload paused after repeated network failures. Submit again to resume it.",
          "transient",
          error.status,
        )
      }

      await waitForTusRetry(
        tusRetryDelay(transientAttempts),
        input.signal,
      )
      transientAttempts += 1

      const resumedOffset = await readTusOffsetWithRetry({
        uploadUrl: input.uploadUrl,
        fileSize: input.file.size,
        signal: input.signal,
      })

      if (resumedOffset < chunkStart || resumedOffset > chunkEnd) {
        throw new TusUploadError(
          "The upload service returned an unexpected resume offset.",
          "protocol",
        )
      }

      if (resumedOffset > chunkStart) {
        transientAttempts = 0
      }

      offset = resumedOffset
      input.onProgress(uploadProgressPercent(offset, input.file.size))
    }
  }
}

export function StoryComposer({ handle }: StoryComposerProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const uploadAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      uploadAbortControllerRef.current?.abort()
    },
    [],
  )

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isUploading || uploadAbortControllerRef.current) {
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

    const uploadAbortController = new AbortController()
    uploadAbortControllerRef.current = uploadAbortController
    let videoFingerprint: string | null = null
    let videoUploadIdentity: VideoUploadIdentity | null = null
    let preparedVideoUploadSessionId: string | null = null

    try {
      const contentType = resolvedMediaContentType(mediaEntry, assetKind)
      if (
        assetKind === "image" &&
        !isSupportedStoryImageInputContentType(contentType)
      ) {
        throw new Error("Choose a JPG, PNG, or WEBP image.")
      }
      if (
        assetKind === "video" &&
        !isSupportedStoryVideoInputContentType(contentType)
      ) {
        throw new Error("Choose an MP4, MOV, or WEBM video.")
      }
      if (
        assetKind === "image" &&
        mediaEntry.size > storyMediaContract.upload.maxImageBytes
      ) {
        throw new Error("Choose an image up to 25 MB.")
      }
      if (
        assetKind === "video" &&
        mediaEntry.size > storyMediaContract.upload.maxVideoBytes
      ) {
        throw new Error("Choose a video up to 512 MB.")
      }

      const resolvedVideoMetadata =
        assetKind === "video" ? await videoMetadata(mediaEntry) : null
      if (
        resolvedVideoMetadata?.durationMs &&
        resolvedVideoMetadata.durationMs >
          storyMediaContract.upload.maxVideoDurationSeconds * 1_000
      ) {
        throw new Error("Story videos are capped at 2 minutes.")
      }

      const imageDerivatives =
        assetKind === "image"
          ? await buildBrowserImageDerivatives(mediaEntry)
          : null
      const videoChecksum =
        assetKind === "video" ? await sha256Hex(mediaEntry) : null
      videoFingerprint =
        videoChecksum === null
          ? null
          : videoUploadFingerprint(mediaEntry, videoChecksum)
      videoUploadIdentity =
        videoFingerprint && videoChecksum
          ? getOrCreateVideoUploadIdentity(videoFingerprint, videoChecksum)
          : null
      const prepareResponse = await fetch("/api/stories/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: uploadAbortController.signal,
        body: JSON.stringify({
          assetKind,
          fileName: mediaEntry.name || (assetKind === "image" ? "story.jpg" : "story.mp4"),
          contentType,
          byteSize: mediaEntry.size,
          ...(imageDerivatives
            ? { displayContentType: imageDerivatives.display.contentType }
            : {}),
          ...(videoUploadIdentity ?? {}),
        }),
      })
      const prepared = (await prepareResponse.json().catch(() => null)) as
        | (PreparedUpload & { error?: string })
        | null

      if (!prepareResponse.ok || !prepared?.ok) {
        throw new Error(prepared?.error ?? "Could not prepare the upload.")
      }

      if (
        prepared.assetKind === "video" &&
        prepared.uploadProtocol === "tus" &&
        (!prepared.uploadSessionId || !prepared.uid || !prepared.uploadUrl)
      ) {
        throw new Error("The upload service returned an incomplete video session.")
      }

      if (prepared.assetKind === "video" && prepared.uploadProtocol === "tus") {
        preparedVideoUploadSessionId = prepared.uploadSessionId

        if (
          videoFingerprint &&
          videoUploadIdentity?.replaceUploadSessionId
        ) {
          clearVideoUploadReplacement(
            videoFingerprint,
            videoUploadIdentity.clientUploadId,
          )
          videoUploadIdentity = {
            clientUploadId: videoUploadIdentity.clientUploadId,
          }
        }
      }

      if ("uploadProtocol" in prepared && prepared.uploadProtocol === "legacy") {
        setStatusText("Uploading story")
        const legacyResponse = await fetch("/api/stories", {
          method: "POST",
          body: formData,
          signal: uploadAbortController.signal,
        })

        if (videoFingerprint) {
          clearVideoUploadIdentity(videoFingerprint)
        }

        window.location.assign(
          legacyResponse.redirected ? legacyResponse.url : "/app?story=created",
        )
        return
      }

      let completionPayload: Record<string, unknown> | undefined

      if (prepared.assetKind === "image") {
        if (!imageDerivatives) {
          throw new Error("Could not prepare the image derivatives.")
        }
        if (
          imageDerivatives.display.blob.size > prepared.display.maxSizeBytes ||
          imageDerivatives.thumbnail.blob.size > prepared.thumbnail.maxSizeBytes
        ) {
          throw new Error("The upload service returned incompatible image limits.")
        }

        setStatusText("Uploading image")
        await Promise.all([
          put(prepared.display.pathname, imageDerivatives.display.blob, {
            access: "private",
            token: prepared.display.clientToken,
            contentType: prepared.display.contentType,
            abortSignal: uploadAbortController.signal,
          }),
          put(prepared.thumbnail.pathname, imageDerivatives.thumbnail.blob, {
            access: "private",
            token: prepared.thumbnail.clientToken,
            contentType: prepared.thumbnail.contentType,
            abortSignal: uploadAbortController.signal,
          }),
        ])
        setProgress(100)

        completionPayload = {
          assetKind: "image",
          basePathname: prepared.basePathname,
          displayDerivative: {
            pathname: prepared.display.pathname,
            contentType: imageDerivatives.display.contentType,
            byteSize: imageDerivatives.display.blob.size,
            checksum: await sha256Hex(imageDerivatives.display.blob),
            width: imageDerivatives.display.width,
            height: imageDerivatives.display.height,
          },
          thumbnailDerivative: {
            pathname: prepared.thumbnail.pathname,
            contentType: imageDerivatives.thumbnail.contentType,
            byteSize: imageDerivatives.thumbnail.blob.size,
            checksum: await sha256Hex(imageDerivatives.thumbnail.blob),
            width: imageDerivatives.thumbnail.width,
            height: imageDerivatives.thumbnail.height,
          },
          thumbHash: imageDerivatives.thumbHash,
        }
      } else {
        setStatusText("Uploading video")
        await uploadTusFile({
          uploadUrl: prepared.uploadUrl,
          file: mediaEntry,
          signal: uploadAbortController.signal,
          onProgress: setProgress,
        })

        completionPayload = {
          assetKind: "video",
          uid: prepared.uid,
          uploadSessionId: prepared.uploadSessionId,
          contentType,
          byteSize: mediaEntry.size,
          checksum: videoChecksum!,
          durationMs: resolvedVideoMetadata?.durationMs ?? null,
          width: resolvedVideoMetadata?.width ?? null,
          height: resolvedVideoMetadata?.height ?? null,
        }
      }

      setStatusText("Finishing story")
      const completeResponse = await fetch("/api/stories/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: uploadAbortController.signal,
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
        if (
          assetKind === "video" &&
          terminalTusStatuses.has(completeResponse.status)
        ) {
          throw new TusUploadSessionError(
            completed?.error ??
              "This video upload session expired or is no longer available. Submit again to start a fresh upload.",
            completeResponse.status,
          )
        }

        throw new Error(completed?.error ?? "Could not finish the story.")
      }

      if (videoFingerprint) {
        clearVideoUploadIdentity(videoFingerprint)
      }

      window.location.assign("/app?story=created")
    } catch (uploadError) {
      if (
        uploadError instanceof TusUploadSessionError &&
        videoFingerprint &&
        videoUploadIdentity &&
        preparedVideoUploadSessionId
      ) {
        markVideoUploadSessionForReplacement(
          videoFingerprint,
          videoUploadIdentity.clientUploadId,
          preparedVideoUploadSessionId,
        )
      }

      setError(
        isAbortError(uploadError)
          ? "Upload canceled. Submit again to resume the video upload."
          : uploadError instanceof Error
          ? uploadError.message
          : "Story upload failed. Try again.",
      )
      setStatusText("")
    } finally {
      if (uploadAbortControllerRef.current === uploadAbortController) {
        uploadAbortControllerRef.current = null
      }
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
              accept={storyMediaInputAccept}
              disabled={isUploading}
              required
            />
            <p className="text-xs text-muted-foreground">
              JPG, PNG, WEBP, MP4, MOV, or WEBM. Images may be up to 25 MB;
              videos may be up to 512 MB and 2 minutes.
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
            <div
              className="space-y-2 rounded-[8px] border bg-muted/35 p-3"
              aria-live="polite"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{statusText}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">{progress}%</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => uploadAbortControllerRef.current?.abort()}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              <div
                className="h-2 overflow-hidden rounded-[8px] bg-muted"
                role="progressbar"
                aria-label="Story upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-valuetext={`${statusText}, ${progress}%`}
              >
                <div
                  className="h-full bg-foreground transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p
              className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
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
