import { createHash } from "crypto"

import { eq } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { authRateLimits } from "@/lib/db/schema"

export type RateLimitOptions = {
  limit: number
  windowMs: number
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; message: string; retryAfterSeconds: number }

export const rateLimitWindows = {
  minute: 60 * 1000,
  fifteenMinutes: 15 * 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
} as const

export function rateLimitKey(bucket: string, subject: string | null | undefined) {
  const normalizedSubject = subject?.trim() || "anonymous"
  const digest = createHash("sha256")
    .update(normalizedSubject)
    .digest("hex")
    .slice(0, 32)

  return `${bucket}:${digest}`
}

export async function consumeRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const db = getDb()
  const now = new Date()
  const resetAt = new Date(now.getTime() + options.windowMs)
  const [record] = await db
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.key, key))
    .limit(1)

  if (!record || record.resetAt.getTime() <= now.getTime()) {
    await db
      .insert(authRateLimits)
      .values({
        key,
        count: 1,
        resetAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: authRateLimits.key,
        set: {
          count: 1,
          resetAt,
          updatedAt: now,
        },
      })

    return { ok: true }
  }

  if (record.count >= options.limit) {
    return {
      ok: false,
      message: "Too many requests. Wait a bit before trying again.",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((record.resetAt.getTime() - now.getTime()) / 1000),
      ),
    }
  }

  await db
    .update(authRateLimits)
    .set({
      count: record.count + 1,
      updatedAt: now,
    })
    .where(eq(authRateLimits.key, key))

  return { ok: true }
}

export async function consumeRateLimits(
  checks: Array<{ key: string; options: RateLimitOptions }>,
): Promise<RateLimitResult> {
  for (const check of checks) {
    const result = await consumeRateLimit(check.key, check.options)

    if (!result.ok) {
      return result
    }
  }

  return { ok: true }
}
