"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2 } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

type ProfileAvatarUploaderProps = {
  displayName: string
  avatarUrl: string | null
  className?: string
  avatarClassName?: string
  fallbackClassName?: string
  badgeClassName?: string
  showBadge?: boolean
}

export function ProfileAvatarUploader({
  displayName,
  avatarUrl,
  className,
  avatarClassName = "size-11",
  fallbackClassName = "bg-[#fde047] text-[#17191f]",
  badgeClassName,
  showBadge = true,
}: ProfileAvatarUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [uploadedAvatarUrl, setUploadedAvatarUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const currentAvatarUrl = uploadedAvatarUrl ?? avatarUrl

  async function uploadAvatar(file: File) {
    setError(null)

    const formData = new FormData()
    formData.append("avatar", file)

    const response = await fetch("/api/account/avatar", {
      method: "POST",
      body: formData,
    })

    const payload = (await response.json().catch(() => null)) as
      | {
          user?: {
            avatarUrl?: string | null
          }
          error?: string
        }
      | null

    if (!response.ok) {
      throw new Error(payload?.error ?? "Profile photo upload failed.")
    }

    const nextAvatarUrl = payload?.user?.avatarUrl

    if (nextAvatarUrl) {
      setUploadedAvatarUrl(nextAvatarUrl)
    }

    router.refresh()
  }

  return (
    <div className={cn("relative inline-flex flex-col items-end", className)}>
      <button
        type="button"
        className="relative flex size-full items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#17191f] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
        aria-label="Change profile picture"
        title="Change profile picture"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
      >
        <Avatar className={avatarClassName}>
          <AvatarImage src={currentAvatarUrl ?? undefined} alt={`${displayName} profile photo`} />
          <AvatarFallback className={fallbackClassName}>
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>
        {showBadge ? (
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-[#17191f] text-white ring-2 ring-white",
              badgeClassName,
            )}
          >
            {isUploading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Camera className="size-3" />
            )}
          </span>
        ) : isUploading ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/34 text-white">
            <Loader2 className="size-4 animate-spin" />
          </span>
        ) : null}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]

          event.target.value = ""

          if (!file) {
            return
          }

          setIsUploading(true)
          uploadAvatar(file)
            .catch((uploadError) => {
              const message =
                uploadError instanceof Error
                  ? uploadError.message
                  : "Profile photo upload failed."

              setError(message)
            })
            .finally(() => {
              setIsUploading(false)
            })
        }}
      />

      {error ? (
        <p className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-56 rounded-[8px] border border-red-200 bg-white px-3 py-2 text-left text-xs font-medium text-red-700 shadow-[0_12px_28px_rgba(15,23,42,0.16)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
