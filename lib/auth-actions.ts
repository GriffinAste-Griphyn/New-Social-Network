"use server"

import { redirect } from "next/navigation"

import {
  buildAuthErrorUrl,
  buildAuthMessageUrl,
  clearSession,
  createSession,
  isProfileComplete,
  resolveNextPath,
} from "@/lib/auth"
import {
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  profileSetupSchema,
  signupAccountTypeSchema,
  signupFlowSchema,
} from "@/lib/auth-validators"
import { sendUserVerificationEmail } from "@/lib/email-verification"
import {
  activateCreatorTools,
  authenticateUser,
  completeUserProfile,
  requestPasswordReset,
  registerUser,
  resetPassword,
} from "@/lib/user-store"

function resolveSignupNextPath(
  accountType: FormDataEntryValue | null,
  fallbackNext: FormDataEntryValue | null,
) {
  const parsedAccountType = signupAccountTypeSchema.safeParse(accountType)

  if (parsedAccountType.success) {
    return parsedAccountType.data === "advertiser" ? "/advertiser" : "/feed"
  }

  return resolveNextPath(fallbackNext, "/feed")
}

export async function loginAction(formData: FormData) {
  const nextPath = resolveNextPath(formData.get("next"), "/feed")
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    redirect(buildAuthErrorUrl("/login", "Enter a valid email and password.", nextPath))
  }

  const result = await authenticateUser(parsed.data)

  if (!result.ok) {
    if ("reason" in result && result.reason === "email_unverified") {
      try {
        await sendUserVerificationEmail({ ...result.user, nextPath })
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not send a verification email."

        redirect(buildAuthErrorUrl("/login", message, nextPath))
      }

      redirect(buildAuthMessageUrl("/login", result.message, nextPath))
    }

    redirect(buildAuthErrorUrl("/login", result.message, nextPath))
  }

  await createSession(result.user)
  if (!isProfileComplete(result.user)) {
    redirect(buildAuthMessageUrl("/onboarding/profile", "Choose your display name and handle to finish setup.", nextPath))
  }

  redirect(nextPath)
}

export async function signupAction(formData: FormData) {
  const nextPath = resolveSignupNextPath(
    formData.get("accountType"),
    formData.get("next"),
  )
  const parsed = signupFlowSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    accountType: formData.get("accountType"),
  })

  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message ?? "Check your sign up details."
    redirect(buildAuthErrorUrl("/signup", issue, nextPath))
  }

  const result = await registerUser(parsed.data)

  if (!result.ok) {
    redirect(buildAuthErrorUrl("/signup", result.message, nextPath))
  }

  try {
    await sendUserVerificationEmail({ ...result.user, nextPath })
  } catch (error) {
    const message =
      error instanceof Error
        ? `Account created, but verification email failed: ${error.message}`
        : "Account created, but verification email failed."

    redirect(buildAuthErrorUrl("/login", message, nextPath))
  }

  redirect(
    buildAuthMessageUrl(
      "/login",
      "Check your email to verify your account, then you can choose your display name and handle.",
      nextPath,
    ),
  )
}

export async function requestPasswordResetAction(formData: FormData) {
  const parsed = passwordResetRequestSchema.safeParse({
    email: formData.get("email"),
  })

  if (!parsed.success) {
    redirect("/forgot-password?error=Enter%20a%20valid%20email%20address.")
  }

  let result: Awaited<ReturnType<typeof requestPasswordReset>>

  try {
    result = await requestPasswordReset(parsed.data)
  } catch (error) {
    const message =
      error instanceof Error
        ? `Could not send reset email: ${error.message}`
        : "Could not send reset email."

    redirect(`/forgot-password?error=${encodeURIComponent(message)}`)
  }

  if (!result.ok) {
    redirect(`/forgot-password?error=${encodeURIComponent(result.message)}`)
  }

  redirect(`/forgot-password?message=${encodeURIComponent(result.message)}`)
}

export async function resetPasswordAction(formData: FormData) {
  const token = formData.get("token")
  const parsed = passwordResetSchema.safeParse({
    token,
    password: formData.get("password"),
  })

  if (!parsed.success) {
    const query = new URLSearchParams({
      error:
        parsed.error.issues[0]?.message ?? "Enter a valid new password.",
    })

    if (typeof token === "string" && token) {
      query.set("token", token)
    }

    redirect(`/reset-password?${query.toString()}`)
  }

  const result = await resetPassword(parsed.data)

  if (!result.ok) {
    const query = new URLSearchParams({
      error: result.message,
      token: parsed.data.token,
    })

    redirect(`/reset-password?${query.toString()}`)
  }

  redirect(buildAuthMessageUrl("/login", result.message, "/feed"))
}

export async function completeProfileAction(formData: FormData) {
  const nextPath = resolveNextPath(formData.get("next"), "/feed")
  const parsed = profileSetupSchema.safeParse({
    displayName: formData.get("displayName"),
    handle: formData.get("handle"),
    onboardingIntent: formData.get("onboardingIntent"),
  })

  if (!parsed.success) {
    const issue =
      parsed.error.issues[0]?.message ?? "Check your profile details."
    redirect(buildAuthErrorUrl("/onboarding/profile", issue, nextPath))
  }

  const result = await completeUserProfile(parsed.data)

  if (!result.ok) {
    redirect(buildAuthErrorUrl("/onboarding/profile", result.message, nextPath))
  }

  await createSession(result.user)
  redirect(nextPath)
}

export async function enableCreatorToolsAction(formData: FormData) {
  const nextPath = resolveNextPath(formData.get("next"), "/feed")
  const result = await activateCreatorTools()

  if (!result.ok) {
    redirect(`${nextPath}?error=${encodeURIComponent(result.message)}`)
  }

  await createSession(result.user)
  redirect(nextPath)
}

export async function logoutAction() {
  await clearSession()
  redirect("/")
}
