import { del } from "@vercel/blob"
import { after, NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  completeMobileVideoStory,
  getExistingMobileVideoStoryCompletion,
} from "@/lib/stories/mobile-video-completion"
import { setStoryThumbnail } from "@/lib/story-store"
import {
  createOriginalQualityVideoThumbnail,
  createOriginalQualityPlaybackStoryAsset,
  createOriginalQualityVideoStoryAsset,
  isAllowedOriginalQualityVideoContentType,
  isAllowedOriginalQualityPlaybackVideoContentType,
  maxOriginalStoryVideoPlaybackUploadBytes,
  maxOriginalStoryVideoUploadBytes,
  removeStoryAsset,
  isAllowedOriginalQualityVideoThumbnailContentType,
  maxOriginalStoryVideoThumbnailUploadBytes,
  StoryUploadError,
  type StoredStoryAsset,
} from "@/lib/story-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"
export const maxDuration = 60

const playbackRenditionCompleteSchema = z.object({
  quality: z.enum(["1080p", "720p", "540p"]),
  pathname: z.string().trim().min(1).max(500),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(maxOriginalStoryVideoPlaybackUploadBytes),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  durationMs: z.number().int().positive().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
})

const completeOriginalVideoSchema = z.object({
  pathname: z.string().trim().min(1).max(500).nullable().optional(),
  contentType: z.string().trim().min(1).max(120).nullable().optional(),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(maxOriginalStoryVideoUploadBytes)
    .nullable()
    .optional(),
  checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .nullable()
    .optional(),
  playbackPathname: z.string().trim().min(1).max(500).nullable().optional(),
  playbackContentType: z.string().trim().min(1).max(120).nullable().optional(),
  playbackByteSize: z
    .number()
    .int()
    .positive()
    .max(maxOriginalStoryVideoPlaybackUploadBytes)
    .nullable()
    .optional(),
  playbackChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .nullable()
    .optional(),
  playbackDurationMs: z.number().int().positive().nullable().optional(),
  playbackWidth: z.number().int().positive().nullable().optional(),
  playbackHeight: z.number().int().positive().nullable().optional(),
  playbackRenditions: z.array(playbackRenditionCompleteSchema).max(3).default([]),
  thumbnailPathname: z.string().trim().min(1).max(500).nullable().optional(),
  thumbnailContentType: z.string().trim().min(1).max(120).nullable().optional(),
  thumbnailByteSize: z
    .number()
    .int()
    .positive()
    .max(maxOriginalStoryVideoThumbnailUploadBytes)
    .nullable()
    .optional(),
  thumbnailChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .nullable()
    .optional(),
  durationMs: z.number().int().positive().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  caption: z.string().default(""),
  brandTags: z.string().default(""),
  stickers: z.string().default(""),
  textOverlays: z.string().default(""),
  textOverlayPositionX: z.string().optional(),
  textOverlayPositionY: z.string().optional(),
  linkLabel: z.string().default(""),
  linkUrl: z.string().default(""),
  linkOverlayPositionX: z.string().optional(),
  linkOverlayPositionY: z.string().optional(),
  quoteReplyId: z.string().default(""),
  quoteReplyPositionX: z.string().optional(),
  quoteReplyPositionY: z.string().optional(),
}).superRefine((value, context) => {
  const hasOriginalUpload = Boolean(value.pathname)
  const hasPlaybackUpload = Boolean(value.playbackPathname)

  if (hasOriginalUpload) {
    if (!value.contentType || !value.byteSize || !value.checksum) {
      context.addIssue({
        code: "custom",
        path: ["pathname"],
        message: "Original upload metadata is incomplete.",
      })
    }
    return
  }

  if (
    !hasPlaybackUpload ||
    !value.playbackContentType ||
    !value.playbackByteSize ||
    !value.playbackChecksum
  ) {
    context.addIssue({
      code: "custom",
      path: ["playbackPathname"],
      message: "Playback upload metadata is required.",
    })
  }
})

function originalVideoThumbnailPathname(pathname: string) {
  const extensionIndex = pathname.lastIndexOf(".")

  return extensionIndex >= 0
    ? `${pathname.slice(0, extensionIndex)}-thumb.jpg`
    : `${pathname}-thumb.jpg`
}

function logOriginalVideoCompleteEvent(
  event: string,
  metadata: Record<string, string | number | boolean | null | undefined>,
) {
  console.info(
    "mobile_original_video_complete",
    JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined),
      ),
    }),
  )
}

export async function POST(request: Request) {
  let uploadedPathname: string | undefined
  let uploadedPlaybackPathnames: string[] = []
  let uploadedThumbnailPathname: string | undefined
  let storedAsset: StoredStoryAsset | undefined

  try {
    const session = await getCompleteMobileSession(request)

    if (!session) {
      return NextResponse.json(
        { error: "Sign in before uploading stories." },
        { status: 401 },
      )
    }

    const rateLimitResponse = await enforceRequestRateLimits(request, [
      {
        bucket: "mobile:story-video-original-complete:user",
        subject: session.id,
        options: mutationRateLimits.storyUploadUser,
      },
      {
        bucket: "mobile:story-video-original-complete:ip",
        subject: requestIpSubject(request),
        options: mutationRateLimits.storyUploadIp,
      },
    ])
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    const parsed = completeOriginalVideoSchema.safeParse(
      await request.json().catch(() => null),
    )

    if (!parsed.success) {
      logOriginalVideoCompleteEvent("complete_invalid_payload", {
        userId: session.id,
        ip: requestIpSubject(request),
      })
      return NextResponse.json(
        { error: "Could not finish the original video upload." },
        { status: 400 },
      )
    }

    logOriginalVideoCompleteEvent("complete_started", {
      userId: session.id,
      pathname: parsed.data.pathname ?? null,
      byteSize: parsed.data.byteSize ?? null,
      playbackByteSize: parsed.data.playbackByteSize ?? null,
      durationMs: parsed.data.durationMs ?? null,
      playbackDurationMs: parsed.data.playbackDurationMs ?? null,
      playbackFirst: !parsed.data.pathname,
      hasPlaybackRendition: Boolean(parsed.data.playbackPathname),
      playbackRenditionCount: parsed.data.playbackRenditions.length,
      hasClientThumbnail: Boolean(parsed.data.thumbnailPathname),
    })

    const expectedPrefix = `stories/mobile-original/${session.id}/`
    const expectedPlaybackPrefix = `stories/mobile-playback/${session.id}/`
    const hasOriginalUpload = Boolean(parsed.data.pathname)
    const hasThumbnailUpload = Boolean(parsed.data.thumbnailPathname)
    const hasPlaybackUpload = Boolean(parsed.data.playbackPathname)

    if (
      hasOriginalUpload &&
      (!parsed.data.pathname?.startsWith(expectedPrefix) ||
        parsed.data.pathname.includes("..") ||
        !parsed.data.contentType ||
        !isAllowedOriginalQualityVideoContentType(parsed.data.contentType) ||
        !parsed.data.byteSize ||
        !parsed.data.checksum)
    ) {
      return NextResponse.json(
        { error: "Could not finish the original video upload." },
        { status: 400 },
      )
    }

    if (
      hasThumbnailUpload &&
      (!parsed.data.thumbnailPathname?.startsWith(expectedPrefix) ||
        parsed.data.thumbnailPathname.includes("..") ||
        !parsed.data.thumbnailPathname.endsWith("-thumb.jpg") ||
        (hasOriginalUpload &&
          parsed.data.thumbnailPathname !==
            originalVideoThumbnailPathname(parsed.data.pathname!)) ||
        !parsed.data.thumbnailContentType ||
        !isAllowedOriginalQualityVideoThumbnailContentType(
          parsed.data.thumbnailContentType,
        ) ||
        !parsed.data.thumbnailByteSize ||
        !parsed.data.thumbnailChecksum)
    ) {
      return NextResponse.json(
        { error: "Could not finish the original video upload." },
        { status: 400 },
      )
    }

    if (
      hasPlaybackUpload &&
      (!parsed.data.playbackPathname?.startsWith(expectedPlaybackPrefix) ||
        parsed.data.playbackPathname.includes("..") ||
        !parsed.data.playbackPathname.endsWith(".mp4") ||
        !parsed.data.playbackContentType ||
        !isAllowedOriginalQualityPlaybackVideoContentType(
          parsed.data.playbackContentType,
        ) ||
        !parsed.data.playbackByteSize ||
        !parsed.data.playbackChecksum)
    ) {
      return NextResponse.json(
        { error: "Could not finish the original video upload." },
        { status: 400 },
      )
    }

    const seenPlaybackRenditionPathnames = new Set<string>()
    const seenPlaybackRenditionQualities = new Set<string>()
    const hasInvalidPlaybackRenditions = parsed.data.playbackRenditions.some(
      (rendition) => {
        if (
          seenPlaybackRenditionPathnames.has(rendition.pathname) ||
          seenPlaybackRenditionQualities.has(rendition.quality)
        ) {
          return true
        }

        seenPlaybackRenditionPathnames.add(rendition.pathname)
        seenPlaybackRenditionQualities.add(rendition.quality)

        return (
          !rendition.pathname.startsWith(expectedPlaybackPrefix) ||
          rendition.pathname.includes("..") ||
          !rendition.pathname.endsWith(".mp4") ||
          !isAllowedOriginalQualityPlaybackVideoContentType(
            rendition.contentType,
          )
        )
      },
    )

    if (hasInvalidPlaybackRenditions) {
      return NextResponse.json(
        { error: "Could not finish the original video upload." },
        { status: 400 },
      )
    }

    const completionStorageKey = hasOriginalUpload
      ? parsed.data.pathname!
      : parsed.data.playbackPathname!
    const existingCompletion = await getExistingMobileVideoStoryCompletion({
      request,
      session,
      storageProvider: "vercel-blob",
      storageKey: completionStorageKey,
    })

    if (existingCompletion) {
      logOriginalVideoCompleteEvent("complete_reused", {
        userId: session.id,
        pathname: completionStorageKey,
        storyId: existingCompletion.storyId,
        processingStatus: existingCompletion.processingStatus,
        moderationStatus: existingCompletion.moderationStatus ?? null,
      })

      return NextResponse.json(existingCompletion)
    }

    uploadedPathname = parsed.data.pathname ?? undefined
    uploadedThumbnailPathname = parsed.data.thumbnailPathname ?? undefined
    uploadedPlaybackPathnames = Array.from(
      new Set(
        [
          parsed.data.playbackPathname ?? undefined,
          ...parsed.data.playbackRenditions.map((rendition) => rendition.pathname),
        ].filter((value): value is string => Boolean(value)),
      ),
    )
    const normalizedPlaybackRenditions = parsed.data.playbackRenditions.map(
      (rendition) => ({
        ...rendition,
        checksum: rendition.checksum.toLowerCase(),
        durationMs: rendition.durationMs ?? null,
        width: rendition.width ?? null,
        height: rendition.height ?? null,
      }),
    )
    storedAsset = hasOriginalUpload
      ? await createOriginalQualityVideoStoryAsset({
          pathname: parsed.data.pathname!,
          contentType: parsed.data.contentType!,
          byteSize: parsed.data.byteSize!,
          checksum: parsed.data.checksum!.toLowerCase(),
          playbackPathname: parsed.data.playbackPathname ?? null,
          playbackContentType: parsed.data.playbackContentType ?? null,
          playbackByteSize: parsed.data.playbackByteSize ?? null,
          playbackChecksum: parsed.data.playbackChecksum?.toLowerCase() ?? null,
          playbackDurationMs: parsed.data.playbackDurationMs ?? null,
          playbackWidth: parsed.data.playbackWidth ?? null,
          playbackHeight: parsed.data.playbackHeight ?? null,
          playbackRenditions: normalizedPlaybackRenditions,
          thumbnailPathname: parsed.data.thumbnailPathname ?? null,
          thumbnailContentType: parsed.data.thumbnailContentType ?? null,
          thumbnailByteSize: parsed.data.thumbnailByteSize ?? null,
          thumbnailChecksum: parsed.data.thumbnailChecksum?.toLowerCase() ?? null,
          durationMs: parsed.data.durationMs ?? null,
          width: parsed.data.width ?? null,
          height: parsed.data.height ?? null,
        })
      : await createOriginalQualityPlaybackStoryAsset({
          playbackPathname: parsed.data.playbackPathname!,
          playbackContentType: parsed.data.playbackContentType!,
          playbackByteSize: parsed.data.playbackByteSize!,
          playbackChecksum: parsed.data.playbackChecksum!.toLowerCase(),
          playbackDurationMs: parsed.data.playbackDurationMs ?? null,
          playbackWidth: parsed.data.playbackWidth ?? null,
          playbackHeight: parsed.data.playbackHeight ?? null,
          playbackRenditions: normalizedPlaybackRenditions,
          thumbnailPathname: parsed.data.thumbnailPathname ?? null,
          thumbnailContentType: parsed.data.thumbnailContentType ?? null,
          thumbnailByteSize: parsed.data.thumbnailByteSize ?? null,
          thumbnailChecksum: parsed.data.thumbnailChecksum?.toLowerCase() ?? null,
          durationMs: parsed.data.durationMs ?? null,
          width: parsed.data.width ?? null,
          height: parsed.data.height ?? null,
        })
    const thumbnailPathname = parsed.data.pathname ?? parsed.data.playbackPathname!
    const completion = await completeMobileVideoStory({
      request,
      session,
      fields: parsed.data,
      storedAsset,
      onStoryCreated: async (storyId) => {
        if (storedAsset?.thumbnailUrl) {
          return
        }

        after(async () => {
          try {
            const thumbnailUrl =
              await createOriginalQualityVideoThumbnail(thumbnailPathname)
            await setStoryThumbnail(storyId, thumbnailUrl)
          } catch (thumbnailError) {
            console.error("Could not create original story video thumbnail.", {
              storyId,
              pathname: thumbnailPathname,
              error: thumbnailError,
            })
          }
        })
      },
    })

    const completedAsset = storedAsset
    uploadedPathname = undefined
    uploadedPlaybackPathnames = []
    uploadedThumbnailPathname = undefined
    storedAsset = undefined

    logOriginalVideoCompleteEvent("complete_succeeded", {
      userId: session.id,
      storyId: completion.storyId,
      pathname: completedAsset.storageKey,
      byteSize: completedAsset.byteSize,
      processingStatus: completion.processingStatus,
      moderationStatus: completion.moderationStatus ?? null,
    })

    return NextResponse.json(completion)
  } catch (error) {
    logOriginalVideoCompleteEvent("complete_failed", {
      pathname: storedAsset?.storageKey ?? uploadedPathname ?? null,
      reason:
        error instanceof StoryUploadError || error instanceof Error
          ? error.message
          : "unknown",
    })
    if (storedAsset) {
      const mediaUrls = Array.from(
        new Set(
          [
            storedAsset.mediaUrl,
            storedAsset.thumbnailUrl,
            storedAsset.originalMediaUrl,
            storedAsset.originalThumbnailUrl,
            ...(storedAsset.playbackRenditions ?? []).map(
              (rendition) => rendition.mediaUrl,
            ),
          ].filter((value): value is string => Boolean(value)),
        ),
      )
      await Promise.allSettled(
        mediaUrls.map((mediaUrl) => removeStoryAsset(mediaUrl)),
      )
    } else if (uploadedPathname || uploadedPlaybackPathnames.length > 0) {
      const pathnames = Array.from(
        new Set(
          [
            uploadedPathname,
            ...uploadedPlaybackPathnames,
            uploadedPathname
              ? originalVideoThumbnailPathname(uploadedPathname)
              : undefined,
            uploadedThumbnailPathname,
          ].filter((value): value is string => Boolean(value)),
        ),
      )
      await Promise.allSettled(pathnames.map((pathname) => del(pathname)))
    }

    return NextResponse.json(
      {
        error:
          error instanceof StoryUploadError || error instanceof Error
            ? error.message
            : "Could not finish the original video upload.",
      },
      { status: 400 },
    )
  }
}
