import { del } from "@vercel/blob"
import { after, NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  allowsLegacyOriginalVideoStory,
  legacyOriginalVideoRetiredResponse,
} from "@/lib/mobile-media-pipeline"
import {
  completeMobileVideoStory,
  getExistingMobileVideoStoryCompletion,
} from "@/lib/stories/mobile-video-completion"
import { setStoryThumbnail } from "@/lib/story-store"
import {
  createOriginalQualityVideoThumbnail,
  createOriginalQualityVideoStoryAsset,
  isAllowedOriginalQualityVideoContentType,
  maxOriginalStoryVideoUploadBytes,
  removeStoredStoryAsset,
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

const completeOriginalVideoSchema = z.object({
  pathname: z.string().trim().min(1).max(500),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive().max(maxOriginalStoryVideoUploadBytes),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
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

    if (
      !allowsLegacyOriginalVideoStory({ request, phase: "complete" })
    ) {
      return NextResponse.json(legacyOriginalVideoRetiredResponse, {
        status: 410,
      })
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
      pathname: parsed.data.pathname,
      byteSize: parsed.data.byteSize,
      durationMs: parsed.data.durationMs ?? null,
      hasClientThumbnail: Boolean(parsed.data.thumbnailPathname),
    })

    const expectedPrefix = `stories/mobile-original/${session.id}/`
    const hasThumbnailUpload = Boolean(parsed.data.thumbnailPathname)

    if (
      !parsed.data.pathname.startsWith(expectedPrefix) ||
      parsed.data.pathname.includes("..") ||
      !isAllowedOriginalQualityVideoContentType(parsed.data.contentType)
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
        parsed.data.thumbnailPathname !==
          originalVideoThumbnailPathname(parsed.data.pathname) ||
        !parsed.data.thumbnailPathname.endsWith("-thumb.jpg") ||
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

    const existingCompletion = await getExistingMobileVideoStoryCompletion({
      request,
      session,
      storageProvider: "vercel-blob",
      storageKey: parsed.data.pathname,
    })

    if (existingCompletion) {
      logOriginalVideoCompleteEvent("complete_reused", {
        userId: session.id,
        pathname: parsed.data.pathname,
        storyId: existingCompletion.storyId,
        processingStatus: existingCompletion.processingStatus,
        moderationStatus: existingCompletion.moderationStatus ?? null,
      })

      return NextResponse.json(existingCompletion)
    }

    uploadedPathname = parsed.data.pathname
    storedAsset = await createOriginalQualityVideoStoryAsset({
      pathname: parsed.data.pathname,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
      checksum: parsed.data.checksum.toLowerCase(),
      thumbnailPathname: parsed.data.thumbnailPathname ?? null,
      thumbnailContentType: parsed.data.thumbnailContentType ?? null,
      thumbnailByteSize: parsed.data.thumbnailByteSize ?? null,
      thumbnailChecksum: parsed.data.thumbnailChecksum?.toLowerCase() ?? null,
      durationMs: parsed.data.durationMs ?? null,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
    })
    const thumbnailPathname = parsed.data.pathname
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
      await removeStoredStoryAsset(storedAsset).catch(() => undefined)
    } else if (uploadedPathname) {
      await del(uploadedPathname).catch(() => undefined)
      await del(originalVideoThumbnailPathname(uploadedPathname)).catch(
        () => undefined,
      )
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
