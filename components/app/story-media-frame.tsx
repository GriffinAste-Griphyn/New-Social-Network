import Image from "next/image"
import type { ReactNode } from "react"

import { storyMediaContract } from "@/lib/story-media-contract"
import { cn } from "@/lib/utils"

type StoryMediaFrameProps = {
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl?: string | null
  alt: string
  sizes: string
  className?: string
  children?: ReactNode
  preloadImage?: boolean
  videoAutoPlay?: boolean
  videoControls?: boolean
  videoLoop?: boolean
  videoMuted?: boolean
}

export function StoryMediaFrame({
  assetKind,
  mediaUrl,
  thumbnailUrl = null,
  alt,
  sizes,
  className,
  children,
  preloadImage = false,
  videoAutoPlay = true,
  videoControls = false,
  videoLoop = true,
  videoMuted = true,
}: StoryMediaFrameProps) {
  return (
    <div
      className={cn(
        "relative aspect-[9/16] w-full overflow-hidden bg-black",
        className,
      )}
    >
      {assetKind === "video" ? (
        <video
          key={mediaUrl}
          src={mediaUrl}
          poster={thumbnailUrl ?? undefined}
          aria-label={alt}
          className="absolute inset-0 z-10 h-full w-full object-contain"
          autoPlay={videoAutoPlay}
          controls={videoControls}
          loop={videoLoop}
          muted={videoMuted}
          playsInline
          preload="metadata"
        />
      ) : (
        <Image
          src={mediaUrl}
          alt={alt}
          fill
          sizes={sizes}
          quality={storyMediaContract.imageEncoding.deliveryQuality}
          className="z-10 object-contain"
          preload={preloadImage}
        />
      )}

      {children ? <div className="absolute inset-0 z-20">{children}</div> : null}
    </div>
  )
}
