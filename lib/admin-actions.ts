"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  approveModeratedStory,
  rejectModeratedStory,
  requireAdminSession,
  settleAdminCreatorPayout,
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

function getUserId(formData: FormData) {
  const userId = formData.get("userId")

  return typeof userId === "string" ? userId : ""
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

export async function settleCreatorPayoutAction(formData: FormData) {
  await enforceAdminOrigin()
  const session = await requireAdminSession()
  await enforceAdminMutation(session.id)
  const userId = getUserId(formData)

  if (!userId) {
    redirect("/admin?error=Choose%20a%20creator%20to%20settle.")
  }

  const result = await settleAdminCreatorPayout(userId)

  if (result.skippedReason) {
    const message =
      result.skippedReason === "stripe_not_configured"
        ? "Stripe is not configured."
        : "Creator Stripe payout account is not ready."

    redirect(`/admin?error=${encodeURIComponent(message)}`)
  }

  if (result.paidCount === 0) {
    redirect(
      "/admin?error=No%20Stripe%20transfers%20were%20created.%20Check%20the%20creator%20ledger%20status.",
    )
  }

  revalidatePath("/admin")
  redirect(`/admin?moderation=payout-settled&paid=${result.paidCount}`)
}
