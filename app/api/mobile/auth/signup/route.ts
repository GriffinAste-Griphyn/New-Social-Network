import { NextResponse } from "next/server"

import { signupSchema } from "@/lib/auth-validators"
import { sendUserVerificationEmail } from "@/lib/email-verification"
import { registerUser } from "@/lib/user-store"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const parsed = signupSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Enter a valid email and password.",
      },
      { status: 400 },
    )
  }

  const result = await registerUser(parsed.data)

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }

  try {
    await sendUserVerificationEmail(result.user)
  } catch (error) {
    const message =
      error instanceof Error
        ? `Account created, but verification email failed: ${error.message}`
        : "Account created, but verification email failed."

    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    pendingEmail: result.user.email,
    message:
      "Check your email to verify your account, then return to the app.",
  })
}
