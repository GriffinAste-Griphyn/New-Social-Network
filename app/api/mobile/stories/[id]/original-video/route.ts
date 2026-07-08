import { del } from "@vercel/blob"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { attachOriginalStoryRenditionForOwner } from "@/lib/story-store"
import {
  createOriginalQualityVideoStoryAsset,
  isAllowedOriginalQualityVideoContentType,
  maxOriginalStoryVideoUploadBytes,
  removeStoredStoryAsset,
  StoryUploadError,
  type StoredStoryAsset,
} from "@/lib/story-storage"

export const runtime = "nodejs"
export const maxDuration = 60

const attachOriginalVideoSchema = z.object({
  pathname: z.string().trim().min(1).max(500),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive().max(maxOriginalStoryVideoUploadBytes),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  durationMs: z.number().int().positive().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
})

function originalVideoThumbnailPathname(pathname: string) {
  const extensionIndex = pathname.lastIndexOf(".")

  return extensionIndex >= 0
    ? `${pathname.slice(0, extensionIndex)}-thumb.jpg`
    : `${pathname}-thumb.jpg`
}

function logOriginalAttachEvent(
  event: string,
  metadata: Record<string, string | number | boolean | null | undefined>,
) {
  console.info(
    "mobile_original_video_attach",
    JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined),
      ),
    }),
  )
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
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
        bucket: "mobile:story-video-original-attach:user",
        subject: session.id,
        options: mutationRateLimits.storyUploadUser,
      },
      {
        bucket: "mobile:story-video-original-attach:ip",
        subject: requestIpSubject(request),
        options: mutationRateLimits.storyUploadIp,
      },
    ])
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    const parsed = attachOriginalVideoSchema.safeParse(
      await request.json().catch(() => null),
    )

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Could not attach the original story video." },
        { status: 400 },
      )
    }

    const { id } = await context.params
    const expectedPrefix = `stories/mobile-original/${session.id}/`

    if (
      !parsed.data.pathname.startsWith(expectedPrefix) ||
      parsed.data.pathname.includes("..") ||
      !isAllowedOriginalQualityVideoContentType(parsed.data.contentType)
    ) {
      return NextResponse.json(
        { error: "Could not attach the original story video." },
        { status: 400 },
      )
    }

    uploadedPathname = parsed.data.pathname
    storedAsset = await createOriginalQualityVideoStoryAsset({
      pathname: parsed.data.pathname,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
      checksum: parsed.data.checksum.toLowerCase(),
      thumbnailPathname: null,
      thumbnailContentType: null,
      thumbnailByteSize: null,
      thumbnailChecksum: null,
      durationMs: parsed.data.durationMs ?? null,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
    })

    const result = await attachOriginalStoryRenditionForOwner({
      ownerId: session.id,
      storyId: id,
      storedAsset,
    })

    uploadedPathname = undefined
    storedAsset = undefined
    logOriginalAttachEvent("attach_succeeded", {
      userId: session.id,
      storyId: id,
      pathname: parsed.data.pathname,
      alreadyAttached: result.alreadyAttached,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    logOriginalAttachEvent("attach_failed", {
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
            : "Could not attach the original story video.",
      },
      { status: 400 },
    )
  }
}
