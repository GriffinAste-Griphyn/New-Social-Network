import { del } from "@vercel/blob"
import { after, NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  createStory,
  getStoryTextOverlaysForOwner,
  setStoryThumbnail,
} from "@/lib/story-store"
import {
  createOriginalQualityVideoThumbnail,
  createOriginalQualityVideoStoryAsset,
  isAllowedOriginalQualityVideoContentType,
  maxOriginalStoryVideoUploadBytes,
  publicStoryMediaUrl,
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
import {
  parseBrandTags,
  parseStoryCaption,
  parseStoryElements,
} from "@/lib/story-validators"

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

function payloadToFormData(payload: z.infer<typeof completeOriginalVideoSchema>) {
  const formData = new FormData()

  formData.set("caption", payload.caption)
  formData.set("brandTags", payload.brandTags)
  formData.set("stickers", payload.stickers)
  formData.set("textOverlays", payload.textOverlays)
  formData.set("textOverlayPositionX", payload.textOverlayPositionX ?? "50.00")
  formData.set("textOverlayPositionY", payload.textOverlayPositionY ?? "74.00")
  formData.set("linkLabel", payload.linkLabel)
  formData.set("linkUrl", payload.linkUrl)
  formData.set("linkOverlayPositionX", payload.linkOverlayPositionX ?? "50.00")
  formData.set("linkOverlayPositionY", payload.linkOverlayPositionY ?? "78.00")
  formData.set("quoteReplyId", payload.quoteReplyId)
  formData.set("quoteReplyPositionX", payload.quoteReplyPositionX ?? "50.00")
  formData.set("quoteReplyPositionY", payload.quoteReplyPositionY ?? "58.00")

  return formData
}

function originalVideoThumbnailPathname(pathname: string) {
  const extensionIndex = pathname.lastIndexOf(".")

  return extensionIndex >= 0
    ? `${pathname.slice(0, extensionIndex)}-thumb.jpg`
    : `${pathname}-thumb.jpg`
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

    const parsed = completeOriginalVideoSchema.safeParse(
      await request.json().catch(() => null),
    )

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Could not finish the original video upload." },
        { status: 400 },
      )
    }

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
    const formData = payloadToFormData(parsed.data)
    const storyElements = parseStoryElements(formData)
    const storyId = await createStory({
      session,
      caption: parseStoryCaption(formData.get("caption")),
      explicitBrandTags: parseBrandTags(formData.get("brandTags")),
      elements: storyElements,
      storedAsset,
    })
    const thumbnailPathname = parsed.data.pathname

    if (!storedAsset.thumbnailUrl) {
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
    }

    const completedAsset = storedAsset
    uploadedPathname = undefined
    storedAsset = undefined
    const textOverlays = await getStoryTextOverlaysForOwner(storyId, session.id)

    return NextResponse.json({
      ok: true,
      storyId,
      asset: {
        assetKind: completedAsset.assetKind,
        mediaUrl:
          publicStoryMediaUrl(completedAsset.mediaUrl, request, { signed: true }) ??
          completedAsset.mediaUrl,
        thumbnailUrl: publicStoryMediaUrl(completedAsset.thumbnailUrl, request, {
          signed: true,
        }),
      },
      processingStatus: completedAsset.processingStatus,
      textOverlays,
    })
  } catch (error) {
    if (storedAsset) {
      await removeStoryAsset(storedAsset.mediaUrl).catch(() => undefined)
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
