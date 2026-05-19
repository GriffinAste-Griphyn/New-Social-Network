import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"

import { getSession, isProfileComplete } from "@/lib/auth"
import { createStory } from "@/lib/story-store"
import {
  publicStoryMediaUrl,
  removeStoryAsset,
  saveStoryAsset,
  StoryUploadError,
} from "@/lib/story-storage"
import {
  parseBrandTags,
  parseStoryCaption,
  parseStoryElements,
} from "@/lib/story-validators"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

function redirectToApp(request: Request, searchParams?: Record<string, string>) {
  const url = new URL("/app", request.url)

  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  return NextResponse.redirect(url, { status: 303 })
}

export async function POST(request: Request) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await getSession()

  if (!session) {
    return NextResponse.redirect(
      new URL("/login?next=%2Fapp", request.url),
      {
        status: 303,
      },
    )
  }

  if (!isProfileComplete(session)) {
    return NextResponse.redirect(
      new URL("/onboarding/profile?next=%2Fapp", request.url),
      {
        status: 303,
      },
    )
  }

  const rateLimitResponse = await enforceRequestRateLimits(
    request,
    [
      {
        bucket: "web:story-upload:user",
        subject: session.id,
        options: mutationRateLimits.storyUploadUser,
      },
      {
        bucket: "web:story-upload:ip",
        subject: requestIpSubject(request),
        options: mutationRateLimits.storyUploadIp,
      },
    ],
    { redirectTo: "/app" },
  )
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  let storedAsset: Awaited<ReturnType<typeof saveStoryAsset>> | undefined

  try {
    const formData = await request.formData()
    const mediaEntry = formData.get("media")

    if (!(mediaEntry instanceof File)) {
      return redirectToApp(request, {
        error: "Choose an image or video before posting.",
      })
    }

    const caption = parseStoryCaption(formData.get("caption"))
    const explicitBrandTags = parseBrandTags(formData.get("brandTags"))
    const elements = parseStoryElements(formData)

    storedAsset = await saveStoryAsset(mediaEntry)
    const moderationMediaUrl =
      publicStoryMediaUrl(storedAsset.mediaUrl, request, { signed: true }) ??
      storedAsset.mediaUrl
    const moderationThumbnailUrl = publicStoryMediaUrl(
      storedAsset.thumbnailUrl,
      request,
      { signed: true },
    )

    await createStory({
      session,
      caption,
      explicitBrandTags,
      elements,
      storedAsset,
      moderationMediaUrl,
      moderationThumbnailUrl,
    })

    revalidatePath("/feed")

    return redirectToApp(request, {
      story: "created",
    })
  } catch (error) {
    if (storedAsset) {
      await removeStoryAsset(storedAsset.mediaUrl)
    }

    const message =
      error instanceof StoryUploadError
        ? error.message
        : "Story upload failed. Try again."

    return redirectToApp(request, {
      error: message,
    })
  }
}
