import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { createStory } from "@/lib/story-store"
import {
  publicStoryMediaUrl,
  removeStoryAsset,
  saveStoryAsset,
  StoryUploadError,
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

export async function POST(request: Request) {
  let storedAsset: Awaited<ReturnType<typeof saveStoryAsset>> | undefined

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
        bucket: "mobile:story-upload:user",
        subject: session.id,
        options: mutationRateLimits.storyUploadUser,
      },
      {
        bucket: "mobile:story-upload:ip",
        subject: requestIpSubject(request),
        options: mutationRateLimits.storyUploadIp,
      },
    ])
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    const formData = await request.formData()
    const mediaEntry = formData.get("media")

    if (!(mediaEntry instanceof File)) {
      return NextResponse.json(
        { error: "Choose an image or video before posting." },
        { status: 400 },
      )
    }

    storedAsset = await saveStoryAsset(mediaEntry)

    const storyId = await createStory({
      session,
      caption: parseStoryCaption(formData.get("caption")),
      explicitBrandTags: parseBrandTags(formData.get("brandTags")),
      elements: parseStoryElements(formData),
      storedAsset,
    })

    return NextResponse.json({
      ok: true,
      storyId,
      asset: {
        assetKind: storedAsset.assetKind,
        mediaUrl:
          publicStoryMediaUrl(storedAsset.mediaUrl, request, { signed: true }) ??
          storedAsset.mediaUrl,
        thumbnailUrl: publicStoryMediaUrl(storedAsset.thumbnailUrl, request, {
          signed: true,
        }),
      },
    })
  } catch (error) {
    if (storedAsset) {
      await removeStoryAsset(storedAsset.mediaUrl)
    }

    const message =
      error instanceof StoryUploadError
        ? error.message
        : "Story upload failed. Try again."

    return NextResponse.json({ error: message }, { status: 400 })
  }
}
