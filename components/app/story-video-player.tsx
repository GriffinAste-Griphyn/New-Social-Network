"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LoaderCircle, Play, RotateCcw } from "lucide-react"

import { cn } from "@/lib/utils"

type PlaybackState =
  | "loading"
  | "buffering"
  | "ready"
  | "playing"
  | "blocked"
  | "failed"

type StoryVideoPlayerProps = {
  src: string
  poster?: string
  ariaLabel: string
  className?: string
  autoPlay: boolean
  controls: boolean
  loop: boolean
  muted: boolean
}

const hlsContentType = "application/vnd.apple.mpegurl"
const stalledPlaybackTimeoutMs = 8_000
const maximumAutomaticReloads = 1

function isHlsSource(src: string) {
  try {
    return new URL(src, window.location.href).pathname.endsWith(".m3u8")
  } catch {
    return src.split("?", 1)[0]?.endsWith(".m3u8") ?? false
  }
}

export function StoryVideoPlayer({
  src,
  poster,
  ariaLabel,
  className,
  autoPlay,
  controls,
  loop,
  muted,
}: StoryVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const activeSourceRef = useRef<string | null>(null)
  const automaticReloadsRef = useRef(0)
  const resumeTimeRef = useRef(0)
  const waitingTimerRef = useRef<number | null>(null)
  const [playbackState, setPlaybackState] = useState<PlaybackState>("loading")
  const [loadGeneration, setLoadGeneration] = useState(0)

  const clearWaitingTimer = useCallback(() => {
    if (waitingTimerRef.current !== null) {
      window.clearTimeout(waitingTimerRef.current)
      waitingTimerRef.current = null
    }
  }, [])

  const attemptPlay = useCallback(async () => {
    const video = videoRef.current
    if (!video) return

    try {
      await video.play()
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setPlaybackState("blocked")
    }
  }, [])

  const reloadPlayer = useCallback(() => {
    const video = videoRef.current
    if (video) {
      resumeTimeRef.current = Number.isFinite(video.currentTime)
        ? Math.max(0, video.currentTime)
        : 0
    }

    clearWaitingTimer()
    setPlaybackState("loading")
    setLoadGeneration((generation) => generation + 1)
  }, [clearWaitingTimer])

  const failOrReload = useCallback(() => {
    if (automaticReloadsRef.current < maximumAutomaticReloads) {
      automaticReloadsRef.current += 1
      reloadPlayer()
      return
    }

    clearWaitingTimer()
    setPlaybackState("failed")
  }, [clearWaitingTimer, reloadPlayer])

  const scheduleStallCheck = useCallback(() => {
    const video = videoRef.current
    if (!video || video.paused || video.ended) return

    clearWaitingTimer()
    setPlaybackState("buffering")
    const observedTime = video.currentTime
    waitingTimerRef.current = window.setTimeout(() => {
      waitingTimerRef.current = null
      const currentVideo = videoRef.current
      if (
        !currentVideo ||
        currentVideo.paused ||
        currentVideo.ended ||
        currentVideo.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ||
        currentVideo.currentTime > observedTime + 0.05
      ) {
        return
      }

      failOrReload()
    }, stalledPlaybackTimeoutMs)
  }, [clearWaitingTimer, failOrReload])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (activeSourceRef.current !== src) {
      activeSourceRef.current = src
      automaticReloadsRef.current = 0
      resumeTimeRef.current = 0
    }
    setPlaybackState("loading")

    let cancelled = false
    let destroyHls: (() => void) | undefined

    video.pause()
    video.removeAttribute("src")
    video.load()

    async function attachSource(video: HTMLVideoElement) {
      if (!isHlsSource(src) || video.canPlayType(hlsContentType)) {
        video.src = src
        video.load()
        return
      }

      const { default: Hls, ErrorTypes } = await import("hls.js")
      if (cancelled) return

      if (!Hls.isSupported()) {
        setPlaybackState("failed")
        return
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
      })
      destroyHls = () => hls.destroy()
      hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (!cancelled) hls.loadSource(src)
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data.fatal) return

        if (
          data.type === ErrorTypes.NETWORK_ERROR &&
          automaticReloadsRef.current < maximumAutomaticReloads
        ) {
          automaticReloadsRef.current += 1
          setPlaybackState("buffering")
          hls.startLoad(video.currentTime)
          return
        }

        if (
          data.type === ErrorTypes.MEDIA_ERROR &&
          automaticReloadsRef.current < maximumAutomaticReloads
        ) {
          automaticReloadsRef.current += 1
          setPlaybackState("buffering")
          hls.recoverMediaError()
          return
        }

        setPlaybackState("failed")
      })
    }

    void attachSource(video).catch(() => {
      if (!cancelled) setPlaybackState("failed")
    })

    return () => {
      cancelled = true
      destroyHls?.()
      video.pause()
      video.removeAttribute("src")
      video.load()
    }
  }, [loadGeneration, src])

  useEffect(() => clearWaitingTimer, [clearWaitingTimer])

  const handleCanPlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    const resumeTime = resumeTimeRef.current
    if (resumeTime > 0 && Number.isFinite(video.duration)) {
      video.currentTime = Math.min(resumeTime, Math.max(0, video.duration - 0.05))
      resumeTimeRef.current = 0
    }

    if (autoPlay) {
      void attemptPlay()
    } else {
      setPlaybackState(controls ? "ready" : "blocked")
    }
  }, [attemptPlay, autoPlay, controls])

  const handlePlaying = useCallback(() => {
    clearWaitingTimer()
    automaticReloadsRef.current = 0
    setPlaybackState("playing")
  }, [clearWaitingTimer])

  const handleManualRetry = useCallback(() => {
    automaticReloadsRef.current = 0
    reloadPlayer()
  }, [reloadPlayer])

  return (
    <>
      <video
        ref={videoRef}
        poster={poster}
        aria-label={ariaLabel}
        className={cn("absolute inset-0 z-10 h-full w-full object-contain", className)}
        autoPlay={autoPlay}
        controls={controls}
        loop={loop}
        muted={muted}
        playsInline
        preload="metadata"
        onCanPlay={handleCanPlay}
        onPlaying={handlePlaying}
        onWaiting={scheduleStallCheck}
        onStalled={scheduleStallCheck}
        onTimeUpdate={clearWaitingTimer}
        onError={failOrReload}
      >
        Your browser does not support video playback.
      </video>

      {(playbackState === "loading" || playbackState === "buffering") && (
        <div
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
          aria-live="polite"
        >
          <LoaderCircle className="size-7 animate-spin text-white/80" aria-hidden="true" />
          <span className="sr-only">
            {playbackState === "buffering" ? "Video buffering" : "Video loading"}
          </span>
        </div>
      )}

      {playbackState === "blocked" && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/25">
          <button
            type="button"
            onClick={() => void attemptPlay()}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-950 shadow-lg"
          >
            <Play className="size-4 fill-current" aria-hidden="true" />
            Play video
          </button>
        </div>
      )}

      {playbackState === "failed" && (
        <div
          className="absolute inset-0 z-30 grid place-items-center bg-black/50"
          role="alert"
        >
          <button
            type="button"
            onClick={handleManualRetry}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-950 shadow-lg"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Retry video
          </button>
        </div>
      )}
    </>
  )
}
