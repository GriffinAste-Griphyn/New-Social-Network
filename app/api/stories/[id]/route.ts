import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"

import { getSession, isProfileComplete } from "@/lib/auth"
import { markMediaAssetDeleted } from "@/lib/media-assets"
import {
  removeStoryForOwner,
  updateStoryForOwner,
} from "@/lib/story-store"
import { removeStoryAsset } from "@/lib/story-storage"
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

function redirectToMyStory(request: Request, searchParams?: Record<string, string>) {
  const url = new URL("/stories/me", request.url)

  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  return NextResponse.redirect(url, { status: 303 })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await getSession()

  if (!session) {
    return NextResponse.redirect(new URL("/login?next=%2Fstories%2Fme", request.url), {
      status: 303,
    })
  }

  if (!isProfileComplete(session)) {
    return NextResponse.redirect(
      new URL("/onboarding/profile?next=%2Fstories%2Fme", request.url),
      {
        status: 303,
      },
    )
  }

  const { id } = await context.params
  const rateLimitResponse = await enforceRequestRateLimits(
    request,
    [
      {
        bucket: "web:story-write:user",
        subject: session.id,
        options: mutationRateLimits.storyWriteUser,
      },
      {
        bucket: "web:story-write:ip",
        subject: requestIpSubject(request),
        options: mutationRateLimits.storyWriteUser,
      },
    ],
    { redirectTo: "/stories/me" },
  )
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  try {
    const formData = await request.formData()
    const action = formData.get("action")

    if (action === "delete") {
      const removedStory = await removeStoryForOwner(id, session.id)

      await removeStoryAsset(removedStory.mediaUrl)
      await markMediaAssetDeleted({
        mediaAssetId: removedStory.mediaAssetId,
        actorUserId: session.id,
        reason: "Story was removed by its owner.",
      })
      revalidatePath("/feed")
      revalidatePath("/stories/me")

      return redirectToMyStory(request, {
        story: "deleted",
      })
    }

    if (action === "update") {
      await updateStoryForOwner({
        storyId: id,
        ownerId: session.id,
        caption: parseStoryCaption(formData.get("caption")),
        explicitBrandTags: parseBrandTags(formData.get("brandTags")),
        elements: parseStoryElements(formData),
      })

      revalidatePath("/feed")
      revalidatePath("/stories/me")

      return redirectToMyStory(request, {
        story: "updated",
      })
    }

    return redirectToMyStory(request, {
      error: "Choose a valid story action.",
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update this story."

    return redirectToMyStory(request, {
      error: message,
    })
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await getSession()

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isProfileComplete(session)) {
    return NextResponse.json({ error: "Profile setup required." }, { status: 403 })
  }

  const { id } = await context.params
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:story-delete:user",
      subject: session.id,
      options: mutationRateLimits.storyWriteUser,
    },
    {
      bucket: "web:story-delete:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.storyWriteUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  try {
    const removedStory = await removeStoryForOwner(id, session.id)

    await removeStoryAsset(removedStory.mediaUrl)
    await markMediaAssetDeleted({
      mediaAssetId: removedStory.mediaAssetId,
      actorUserId: session.id,
      reason: "Story was removed by its owner.",
    })
    revalidatePath("/feed")
    revalidatePath("/stories/me")

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete story."

    return NextResponse.json({ error: message }, { status: 400 })
  }
}
