import { NextResponse } from "next/server"

import { createSession, isProfileComplete, resolveNextPath } from "@/lib/auth"
import { verifyEmailToken } from "@/lib/email-verification"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const nextPath = resolveNextPath(requestUrl.searchParams.get("next"), "/app")
  const result = await verifyEmailToken(requestUrl.searchParams.get("token") ?? "")

  if (!result.ok || !result.user) {
    const redirectUrl = new URL("/login", request.url)

    redirectUrl.searchParams.set("error", result.message)
    redirectUrl.searchParams.set("next", nextPath)

    return NextResponse.redirect(redirectUrl)
  }

  await createSession(result.user)

  const redirectUrl = new URL(
    isProfileComplete(result.user) ? nextPath : "/onboarding/profile",
    request.url,
  )

  if (!isProfileComplete(result.user)) {
    redirectUrl.searchParams.set("next", nextPath)
  }

  redirectUrl.searchParams.set(
    "message",
    isProfileComplete(result.user)
      ? "Email verified."
      : "Email verified. Choose your display name and handle to finish setup.",
  )

  return NextResponse.redirect(redirectUrl)
}
