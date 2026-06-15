import { del } from "@vercel/blob"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { attachOriginalVideoToStoryForOwner } from "@/lib/story-store"
import {
  createOriginalQualityVideoAttachment,
  isAllowedOriginalQualityVideoContentType,
  maxOriginalStoryVideoUploadBytes,
  publicStoryMediaUrl,
  StoryUploadError,
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

function logOriginalVideoAttachEvent(
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

  try {
    const [{ id: storyId }, session] = await Promise.all([
      context.params,
      getCompleteMobileSession(request),
    ])

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
        { error: "Could not attach the original video." },
        { status: 400 },
      )
    }

    uploadedPathname = parsed.data.pathname
    const expectedPrefix = `stories/mobile-original/${session.id}/`

    if (
      !parsed.data.pathname.startsWith(expectedPrefix) ||
      parsed.data.pathname.includes("..") ||
      !isAllowedOriginalQualityVideoContentType(parsed.data.contentType)
    ) {
      return NextResponse.json(
        { error: "Could not attach the original video." },
        { status: 400 },
      )
    }

    logOriginalVideoAttachEvent("attach_started", {
      userId: session.id,
      storyId,
      pathname: parsed.data.pathname,
      byteSize: parsed.data.byteSize,
      durationMs: parsed.data.durationMs ?? null,
    })

    const original = await createOriginalQualityVideoAttachment({
      pathname: parsed.data.pathname,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
      checksum: parsed.data.checksum.toLowerCase(),
      durationMs: parsed.data.durationMs ?? null,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
    })
    const attachment = await attachOriginalVideoToStoryForOwner({
      ownerId: session.id,
      storyId,
      original,
    })

    uploadedPathname = undefined
    logOriginalVideoAttachEvent("attach_succeeded", {
      userId: session.id,
      storyId,
      pathname: original.storageKey,
      byteSize: original.byteSize,
      attachmentState: attachment.attachmentState,
    })

    return NextResponse.json({
      ok: true,
      storyId,
      attachmentState: attachment.attachmentState,
      asset: {
        renditions: {
          original: {
            mediaUrl:
              publicStoryMediaUrl(original.mediaUrl, request, { signed: true }) ??
              original.mediaUrl,
            thumbnailUrl: publicStoryMediaUrl(
              attachment.originalThumbnailUrl,
              request,
              { signed: true },
            ),
          },
        },
      },
    })
  } catch (error) {
    logOriginalVideoAttachEvent("attach_failed", {
      pathname: uploadedPathname ?? null,
      reason:
        error instanceof StoryUploadError || error instanceof Error
          ? error.message
          : "unknown",
    })

    if (uploadedPathname) {
      await del(uploadedPathname).catch(() => undefined)
    }

    return NextResponse.json(
      {
        error:
          error instanceof StoryUploadError || error instanceof Error
            ? error.message
            : "Could not attach the original video.",
      },
      { status: 400 },
    )
  }
}
