"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  approveModeratedStory,
  rejectModeratedStory,
  requireAdminSession,
} from "@/lib/admin-store"
import {
  assertSameOriginAction,
  enforceActionRateLimits,
  mutationRateLimits,
} from "@/lib/request-security"

function getStoryId(formData: FormData) {
  const storyId = formData.get("storyId")

  return typeof storyId === "string" ? storyId : ""
}

async function enforceAdminMutation(userId: string) {
  try {
    await enforceActionRateLimits([
      {
        bucket: "web:admin:moderation",
        subject: userId,
        options: mutationRateLimits.storyWriteUser,
      },
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request."

    redirect(`/admin?error=${encodeURIComponent(message)}`)
  }
}

async function enforceAdminOrigin() {
  try {
    await assertSameOriginAction()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request."

    redirect(`/admin?error=${encodeURIComponent(message)}`)
  }
}

export async function approveModeratedStoryAction(formData: FormData) {
  await enforceAdminOrigin()
  const session = await requireAdminSession()
  await enforceAdminMutation(session.id)
  const storyId = getStoryId(formData)

  if (!storyId) {
    redirect("/admin?error=Choose%20a%20story%20to%20approve.")
  }

  await approveModeratedStory({
    storyId,
    reviewerId: session.id,
  })

  revalidatePath("/admin")
  redirect("/admin?moderation=approved")
}

export async function rejectModeratedStoryAction(formData: FormData) {
  await enforceAdminOrigin()
  const session = await requireAdminSession()
  await enforceAdminMutation(session.id)
  const storyId = getStoryId(formData)

  if (!storyId) {
    redirect("/admin?error=Choose%20a%20story%20to%20remove.")
  }

  await rejectModeratedStory({
    storyId,
    reviewerId: session.id,
  })

  revalidatePath("/admin")
  redirect("/admin?moderation=removed")
}
