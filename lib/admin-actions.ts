"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  approveModeratedStory,
  rejectModeratedStory,
  requireAdminSession,
} from "@/lib/admin-store"

function getStoryId(formData: FormData) {
  const storyId = formData.get("storyId")

  return typeof storyId === "string" ? storyId : ""
}

export async function approveModeratedStoryAction(formData: FormData) {
  const session = await requireAdminSession()
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
  const session = await requireAdminSession()
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
