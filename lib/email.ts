import { Resend } from "resend"

import { env } from "@/lib/env"

let resendClient: Resend | null = null

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case "\"":
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}

function getResendClient() {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required to send auth emails.")
  }

  resendClient ??= new Resend(env.RESEND_API_KEY)

  return resendClient
}

export async function sendVerificationEmail({
  displayName,
  email,
  verificationUrl,
  verificationCode,
}: {
  displayName: string
  email: string
  verificationUrl: string
  verificationCode: string
}) {
  const resend = getResendClient()
  const safeDisplayName = escapeHtml(displayName)
  const safeVerificationUrl = escapeHtml(verificationUrl)
  const safeVerificationCode = escapeHtml(verificationCode)
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: email,
    subject: "Verify your UBEYE email",
    text: [
      `Hi ${displayName},`,
      "",
      `Your UBEYE verification code is ${verificationCode}.`,
      "",
      "You can also verify your email with this secure link:",
      verificationUrl,
      "",
      "This code and link expire in 24 hours.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #17191f;">
        <h1 style="font-size: 24px;">Verify your email</h1>
        <p>Hi ${safeDisplayName},</p>
        <p>Use this code in the UBEYE app to finish setting up your account.</p>
        <p style="font-size: 30px; font-weight: 700; letter-spacing: 6px; color: #17191f; margin: 18px 0;">
          ${safeVerificationCode}
        </p>
        <p>You can also verify your email with this secure link.</p>
        <p>
          <a href="${safeVerificationUrl}" style="display: inline-block; border-radius: 999px; background: #17191f; color: #ffffff; padding: 12px 18px; text-decoration: none;">
            Verify email
          </a>
        </p>
        <p style="color: #62646d;">This code and link expire in 24 hours.</p>
      </div>
    `,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function sendPasswordResetEmail({
  displayName,
  email,
  resetUrl,
}: {
  displayName: string
  email: string
  resetUrl: string
}) {
  const resend = getResendClient()
  const safeDisplayName = escapeHtml(displayName)
  const safeResetUrl = escapeHtml(resetUrl)
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: email,
    subject: "Reset your UBEYE password",
    text: [
      `Hi ${displayName},`,
      "",
      "Use this link to reset your UBEYE password:",
      resetUrl,
      "",
      "This link expires in 1 hour. If you did not request it, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #17191f;">
        <h1 style="font-size: 24px;">Reset your password</h1>
        <p>Hi ${safeDisplayName},</p>
        <p>Use this link to reset your UBEYE password.</p>
        <p>
          <a href="${safeResetUrl}" style="display: inline-block; border-radius: 999px; background: #17191f; color: #ffffff; padding: 12px 18px; text-decoration: none;">
            Reset password
          </a>
        </p>
        <p style="color: #62646d;">This link expires in 1 hour. If you did not request it, you can ignore this email.</p>
      </div>
    `,
  })

  if (error) {
    throw new Error(error.message)
  }
}
