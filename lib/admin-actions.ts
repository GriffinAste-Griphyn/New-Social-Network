"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  approveModeratedStory,
  rejectModeratedStory,
  requireAdminSession,
} from "@/lib/admin-store"
import {
  reviewSafetyReport,
  type SafetyReportReviewStatus,
} from "@/lib/social-safety"
import {
  assertSameOriginAction,
  enforceActionRateLimits,
  mutationRateLimits,
} from "@/lib/request-security"

function getStoryId(formData: FormData) {
  const storyId = formData.get("storyId")

  return typeof storyId === "string" ? storyId : ""
}

function getReportId(formData: FormData) {
  const reportId = formData.get("reportId")

  return typeof reportId === "string" ? reportId : ""
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

export async function reviewSafetyReportAction(formData: FormData) {
  await enforceAdminOrigin()
  const session = await requireAdminSession()
  await enforceAdminMutation(session.id)
  const reportId = getReportId(formData)
  const rawStatus = formData.get("status")
  const status: SafetyReportReviewStatus =
    rawStatus === "actioned" || rawStatus === "dismissed"
      ? rawStatus
      : "reviewed"
  const note = formData.get("resolutionNote")

  if (!reportId) {
    redirect("/admin?error=Choose%20a%20report%20to%20review.")
  }

  await reviewSafetyReport({
    reportId,
    reviewerId: session.id,
    status,
    resolutionNote: typeof note === "string" ? note : null,
  })

  revalidatePath("/admin")
  redirect(
    status === "actioned"
      ? "/admin?moderation=report-actioned"
      : "/admin?moderation=report-reviewed",
  )
}
