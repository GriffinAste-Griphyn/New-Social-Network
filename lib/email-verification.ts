import { createHash, randomBytes, randomUUID } from "node:crypto"

import { and, eq, isNull } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { emailVerificationTokens, users } from "@/lib/db/schema"
import { sendVerificationEmail } from "@/lib/email"
import { env } from "@/lib/env"
import { toAuthUser } from "@/lib/user-store"

const tokenTtlMs = 24 * 60 * 60 * 1000

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function buildVerificationUrl(token: string, nextPath?: string) {
  const url = new URL("/api/auth/verify-email", env.NEXT_PUBLIC_APP_URL)

  url.searchParams.set("token", token)
  if (nextPath) {
    url.searchParams.set("next", nextPath)
  }

  return url.toString()
}

export async function sendUserVerificationEmail(user: {
  id: string
  email: string
  displayName: string | null
  nextPath?: string
}) {
  const db = getDb()
  const token = randomBytes(32).toString("base64url")
  const now = new Date()

  await db
    .update(emailVerificationTokens)
    .set({
      usedAt: now,
    })
    .where(
      and(
        eq(emailVerificationTokens.userId, user.id),
        isNull(emailVerificationTokens.usedAt),
      ),
    )

  await db.insert(emailVerificationTokens).values({
    id: randomUUID(),
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + tokenTtlMs),
  })

  await sendVerificationEmail({
    displayName: user.displayName ?? "there",
    email: user.email,
    verificationUrl: buildVerificationUrl(token, user.nextPath),
  })
}

export async function verifyEmailToken(token: string) {
  if (!token) {
    return {
      ok: false,
      message: "Verification link is missing a token.",
    }
  }

  const db = getDb()
  const [record] = await db
    .select({
      id: emailVerificationTokens.id,
      userId: emailVerificationTokens.userId,
      expiresAt: emailVerificationTokens.expiresAt,
      usedAt: emailVerificationTokens.usedAt,
    })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, hashToken(token)))
    .limit(1)

  if (!record || record.usedAt) {
    return {
      ok: false,
      message: "Verification link is invalid or has already been used.",
    }
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      message: "Verification link has expired. Sign in to request a new one.",
    }
  }

  const now = new Date()

  await db
    .update(emailVerificationTokens)
    .set({
      usedAt: now,
    })
    .where(eq(emailVerificationTokens.id, record.id))

  const [user] = await db
    .update(users)
    .set({
      emailVerifiedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, record.userId))
    .returning()

  return {
    ok: true,
    user: user ? toAuthUser(user) : null,
    message: "Email verified. You can now sign in.",
  }
}
