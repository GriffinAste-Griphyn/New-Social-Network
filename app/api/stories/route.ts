import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"

import { getSession, isProfileComplete } from "@/lib/auth"
import { createStory } from "@/lib/story-store"
import { removeStoryAsset, saveStoryAsset, StoryUploadError } from "@/lib/story-storage"
import {
  parseBrandTags,
  parseStoryCaption,
  parseStoryElements,
} from "@/lib/story-validators"

export const runtime = "nodejs"

function redirectToFeed(request: Request, searchParams?: Record<string, string>) {
  const url = new URL("/feed", request.url)

  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  return NextResponse.redirect(url, { status: 303 })
}

export async function POST(request: Request) {
  const session = await getSession()

  if (!session) {
    return NextResponse.redirect(
      new URL("/login?next=%2Ffeed", request.url),
      {
        status: 303,
      },
    )
  }

  if (!isProfileComplete(session)) {
    return NextResponse.redirect(
      new URL("/onboarding/profile?next=%2Ffeed", request.url),
      {
        status: 303,
      },
    )
  }

  let storedAsset: Awaited<ReturnType<typeof saveStoryAsset>> | undefined

  try {
    const formData = await request.formData()
    const mediaEntry = formData.get("media")

    if (!(mediaEntry instanceof File)) {
      return redirectToFeed(request, {
        error: "Choose an image or video before posting.",
      })
    }

    const caption = parseStoryCaption(formData.get("caption"))
    const explicitBrandTags = parseBrandTags(formData.get("brandTags"))
    const elements = parseStoryElements(formData)

    storedAsset = await saveStoryAsset(mediaEntry)

    await createStory({
      session,
      caption,
      explicitBrandTags,
      elements,
      storedAsset,
    })

    revalidatePath("/feed")

    return redirectToFeed(request, {
      story: "created",
    })
  } catch (error) {
    if (storedAsset) {
      await removeStoryAsset(storedAsset.mediaUrl)
    }

    const message =
      error instanceof StoryUploadError || error instanceof Error
        ? error.message
        : "Story upload failed."

    return redirectToFeed(request, {
      error: message,
    })
  }
}
