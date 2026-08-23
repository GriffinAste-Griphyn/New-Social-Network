import { env } from "@/lib/env"

type AdminCandidateSession = {
  email: string
}

function getAdminEmails() {
  const configuredEmails = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  return Array.from(
    new Set(["griffin@ubeye.ai", ...configuredEmails]),
  )
}

export function isAdminSession(session: AdminCandidateSession) {
  const adminEmails = getAdminEmails()

  if (adminEmails.length === 0) {
    return process.env.NODE_ENV !== "production"
  }

  return adminEmails.includes(session.email.toLowerCase())
}
