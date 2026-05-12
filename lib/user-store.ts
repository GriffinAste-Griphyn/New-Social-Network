import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto"

import { and, eq, inArray, isNull, or } from "drizzle-orm"

import { getSession, isProfileComplete, revokeAllUserSessions } from "@/lib/auth"
import type {
  LoginInput,
  PasswordResetInput,
  PasswordResetRequestInput,
  ProfileSetupInput,
  SignupInput,
} from "@/lib/auth-validators"
import { getDb } from "@/lib/db"
import {
  advertiserAccounts,
  advertiserMembers,
  advertiserPaymentMethods,
  authSessions,
  brandFundingProfiles,
  creatorNotificationPreferences,
  creatorProfiles,
  emailVerificationTokens,
  feedImpressions,
  follows,
  mediaAssets,
  mediaAuditEvents,
  mobilePushTokens,
  passwordResetTokens,
  safetyReports,
  stories,
  storyElements,
  storyInteractions,
  storyMentions,
  users,
  userBlocks,
} from "@/lib/db/schema"
import { sendPasswordResetEmail } from "@/lib/email"
import { env } from "@/lib/env"
import {
  clearRateLimit,
  consumeRateLimit,
  rateLimitKey,
  type RateLimitOptions,
} from "@/lib/rate-limit"

export type AuthUser = {
  id: string
  email: string
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
  onboardingIntent: "explore" | "create" | "both"
  creatorStatus: "inactive" | "active" | "suspended"
}

type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: "email_unverified"; message: string; user: AuthUser }
  | { ok: false; reason: "locked"; message: string }
  | { ok: false; reason: "rate_limited"; message: string }
  | { ok: false; message: string }

type GenericAuthResult = { ok: true; message: string } | { ok: false; message: string }

const loginRateLimit = {
  limit: 10,
  windowMs: 15 * 60 * 1000,
  message: "Too many attempts. Wait a bit before trying again.",
} satisfies RateLimitOptions
const signupRateLimit = {
  limit: 5,
  windowMs: 60 * 60 * 1000,
  message: "Too many attempts. Wait a bit before trying again.",
} satisfies RateLimitOptions
const resetRateLimit = {
  limit: 3,
  windowMs: 60 * 60 * 1000,
  message: "Too many attempts. Wait a bit before trying again.",
} satisfies RateLimitOptions
const maxFailedLoginAttempts = 5
const accountLockoutMs = 15 * 60 * 1000
const passwordResetTokenTtlMs = 60 * 60 * 1000

export function toAuthUser(user: typeof users.$inferSelect): AuthUser {
  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    onboardingIntent: user.onboardingIntent,
    creatorStatus: user.creatorStatus,
  }
}

function hashPassword(password: string) {
  const salt = randomUUID()
  const digest = scryptSync(password, salt, 64).toString("hex")

  return `${salt}:${digest}`
}

function hashResetToken(token: string) {
  return createHash("sha256")
    .update(`${env.AUTH_SECRET}:password-reset:${token}`)
    .digest("hex")
}

function buildPasswordResetUrl(token: string) {
  const url = new URL("/reset-password", env.NEXT_PUBLIC_APP_URL)

  url.searchParams.set("token", token)

  return url.toString()
}

function formatLockoutMessage(lockedUntil: Date) {
  const minutes = Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - Date.now()) / (60 * 1000)),
  )

  return `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
}

function authEmailRateLimitKey(
  bucket: "login" | "signup" | "password-reset",
  email: string,
) {
  return rateLimitKey(`auth:${bucket}:email`, email.trim().toLowerCase())
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, digest] = storedHash.split(":")

  if (!salt || !digest) {
    return false
  }

  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(digest, "hex")

  return (
    candidate.length === expected.length &&
    timingSafeEqual(candidate, expected)
  )
}

export async function registerUser(input: SignupInput): Promise<AuthResult> {
  const db = getDb()
  const rateLimit = await consumeRateLimit(
    authEmailRateLimitKey("signup", input.email),
    signupRateLimit,
  )

  if (!rateLimit.ok) {
    return {
      ok: false,
      reason: "rate_limited",
      message: rateLimit.message,
    }
  }

  const [existingUser] = await db
    .select({
      email: users.email,
    })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)

  if (existingUser) {
    return {
      ok: false,
      message: "That email is already in use.",
    }
  }

  const [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      authProvider: "credentials",
      email: input.email,
      passwordHash: hashPassword(input.password),
    })
    .returning()

  return {
    ok: true,
    user: toAuthUser(user),
  }
}

export async function authenticateUser(input: LoginInput): Promise<AuthResult> {
  const db = getDb()
  const rateLimit = await consumeRateLimit(
    authEmailRateLimitKey("login", input.email),
    loginRateLimit,
  )

  if (!rateLimit.ok) {
    return {
      ok: false,
      reason: "rate_limited",
      message: rateLimit.message,
    }
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)

  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return {
      ok: false,
      reason: "locked",
      message: formatLockoutMessage(user.lockedUntil),
    }
  }

  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    if (user) {
      const failedLoginCount = user.failedLoginCount + 1
      const lockedUntil =
        failedLoginCount >= maxFailedLoginAttempts
          ? new Date(Date.now() + accountLockoutMs)
          : null

      await db
        .update(users)
        .set({
          failedLoginCount,
          lockedUntil,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))

      if (lockedUntil) {
        return {
          ok: false,
          reason: "locked",
          message: formatLockoutMessage(lockedUntil),
        }
      }
    }

    return {
      ok: false,
      message: "Invalid email or password.",
    }
  }

  if (!user.emailVerifiedAt) {
    return {
      ok: false,
      reason: "email_unverified",
      message: "Verify your email before signing in. We sent you a new link.",
      user: toAuthUser(user),
    }
  }

  await Promise.all([
    db
      .update(users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id)),
    clearRateLimit(authEmailRateLimitKey("login", input.email)),
  ])

  return {
    ok: true,
    user: toAuthUser(user),
  }
}

export async function requestPasswordReset(
  input: PasswordResetRequestInput,
): Promise<GenericAuthResult> {
  const db = getDb()
  const rateLimit = await consumeRateLimit(
    authEmailRateLimitKey("password-reset", input.email),
    resetRateLimit,
  )

  if (!rateLimit.ok) {
    return {
      ok: false,
      message: rateLimit.message,
    }
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)

  const neutralMessage =
    "If an account exists for that email, a reset link has been sent."

  if (!user) {
    return {
      ok: true,
      message: neutralMessage,
    }
  }

  const token = randomBytes(32).toString("base64url")
  const now = new Date()

  await db
    .update(passwordResetTokens)
    .set({
      usedAt: now,
    })
    .where(
      and(
        eq(passwordResetTokens.userId, user.id),
        isNull(passwordResetTokens.usedAt),
      ),
    )

  await db.insert(passwordResetTokens).values({
    id: randomUUID(),
    userId: user.id,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(now.getTime() + passwordResetTokenTtlMs),
  })

  await sendPasswordResetEmail({
    displayName: user.displayName ?? "there",
    email: user.email,
    resetUrl: buildPasswordResetUrl(token),
  })

  return {
    ok: true,
    message: neutralMessage,
  }
}

export async function resetPassword(
  input: PasswordResetInput,
): Promise<GenericAuthResult> {
  const db = getDb()
  const now = new Date()
  const [record] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashResetToken(input.token)))
    .limit(1)

  if (!record || record.usedAt) {
    return {
      ok: false,
      message: "Password reset link is invalid or has already been used.",
    }
  }

  if (record.expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      message: "Password reset link has expired. Request a new one.",
    }
  }

  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(eq(passwordResetTokens.id, record.id))

  await db
    .update(users)
    .set({
      passwordHash: hashPassword(input.password),
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(users.id, record.userId))

  await revokeAllUserSessions(record.userId)

  return {
    ok: true,
    message: "Password updated. Sign in with your new password.",
  }
}

export async function findCompleteUserByEmail(email: string) {
  const db = getDb()
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)

  if (!user || !user.displayName || !user.handle) {
    return null
  }

  return toAuthUser(user) as AuthUser & {
    displayName: string
    handle: string
  }
}

export async function completeUserProfile(
  input: ProfileSetupInput,
): Promise<AuthResult> {
  const session = await getSession()

  if (!session) {
    return {
      ok: false,
      message: "Sign in to finish your profile.",
    }
  }

  return completeUserProfileForUser(session.id, input)
}

export async function completeUserProfileForUser(
  userId: string,
  input: ProfileSetupInput,
): Promise<AuthResult> {
  const db = getDb()
  const [handleOwner] = await db
    .select({
      id: users.id,
    })
    .from(users)
    .where(eq(users.handle, input.handle))
    .limit(1)

  if (handleOwner && handleOwner.id !== userId) {
    return {
      ok: false,
      message: "That handle is already claimed.",
    }
  }

  const [user] = await db
    .update(users)
    .set({
      handle: input.handle,
      displayName: input.displayName,
      onboardingIntent: input.onboardingIntent,
      creatorStatus: "active",
      isCreatorMode: true,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning()

  if (!user) {
    return {
      ok: false,
      message: "Your session is out of sync. Sign in again.",
    }
  }

  await db
    .insert(creatorProfiles)
    .values({
      userId: user.id,
    })
    .onConflictDoNothing()

  return {
    ok: true,
    user: toAuthUser(user),
  }
}

export async function updateUserAvatar(
  userId: string,
  avatarUrl: string,
  avatarAssetId?: string,
): Promise<AuthResult> {
  const [user] = await getDb()
    .update(users)
    .set({
      avatarUrl,
      ...(avatarAssetId ? { avatarAssetId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning()

  if (!user) {
    return {
      ok: false,
      message: "Your session is out of sync. Sign in again.",
    }
  }

  return {
    ok: true,
    user: toAuthUser(user),
  }
}

export async function deleteUserAccount(
  userId: string,
): Promise<GenericAuthResult> {
  const db = getDb()
  const now = new Date()
  const deletedEmail = `deleted-${userId}@deleted.ubeye.local`
  const deletedPassword = hashPassword(randomBytes(32).toString("base64url"))

  await db.transaction(async (tx) => {
    const userStories = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.creatorId, userId))
    const storyIds = userStories.map((story) => story.id)

    await tx
      .update(authSessions)
      .set({ revokedAt: now })
      .where(
        and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)),
      )

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.userId, userId),
          isNull(passwordResetTokens.usedAt),
        ),
      )

    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailVerificationTokens.userId, userId),
          isNull(emailVerificationTokens.usedAt),
        ),
      )

    await tx
      .delete(mobilePushTokens)
      .where(eq(mobilePushTokens.userId, userId))
    await tx
      .delete(follows)
      .where(or(eq(follows.followerId, userId), eq(follows.followeeId, userId)))
    await tx.delete(userBlocks).where(
      or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)),
    )
    await tx.delete(creatorNotificationPreferences).where(
      or(
        eq(creatorNotificationPreferences.subscriberId, userId),
        eq(creatorNotificationPreferences.creatorId, userId),
      ),
    )

    await tx
      .update(safetyReports)
      .set({
        details: null,
        resolutionNote: null,
        updatedAt: now,
      })
      .where(
        or(
          eq(safetyReports.reporterId, userId),
          eq(safetyReports.targetUserId, userId),
          eq(safetyReports.reviewedByUserId, userId),
        ),
      )

    await tx
      .update(storyInteractions)
      .set({
        body: null,
        reaction: null,
        mediaUrl: null,
        mediaThumbnailUrl: null,
        mediaAssetKind: null,
        mediaAssetId: null,
      })
      .where(
        or(
          eq(storyInteractions.actorId, userId),
          eq(storyInteractions.creatorId, userId),
        ),
      )

    await tx
      .update(mediaAuditEvents)
      .set({ actorUserId: null })
      .where(eq(mediaAuditEvents.actorUserId, userId))

    if (storyIds.length > 0) {
      await tx
        .delete(storyElements)
        .where(inArray(storyElements.storyId, storyIds))
      await tx
        .delete(storyMentions)
        .where(inArray(storyMentions.storyId, storyIds))
      await tx.delete(feedImpressions).where(
        or(
          eq(feedImpressions.viewerId, userId),
          inArray(feedImpressions.storyId, storyIds),
        ),
      )
    } else {
      await tx
        .delete(feedImpressions)
        .where(eq(feedImpressions.viewerId, userId))
    }

    await tx
      .update(stories)
      .set({
        status: "removed",
        caption: null,
        moderationStatus: "removed",
        moderationReason: "Creator account deleted.",
        reviewedAt: now,
        reviewedByUserId: null,
      })
      .where(eq(stories.creatorId, userId))

    await tx
      .update(mediaAssets)
      .set({
        processingStatus: "deleted",
        scanStatus: "skipped",
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(mediaAssets.ownerUserId, userId))

    await tx
      .update(creatorProfiles)
      .set({
        category: null,
        creatorBio: null,
        isPublic: false,
        analyticsEnabled: false,
        monetizationEnabled: false,
        stripeConnectedAccountId: null,
        stripePayoutsEnabled: false,
        stripeOnboardingComplete: false,
        stripeRequirementsStatus: null,
        stripeRequirementsDue: null,
        stripeConnectedAt: null,
        stripeUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(creatorProfiles.userId, userId))

    const ownedAdvertiserAccounts = await tx
      .select({ id: advertiserAccounts.id })
      .from(advertiserAccounts)
      .where(eq(advertiserAccounts.ownerUserId, userId))
    const advertiserAccountIds = ownedAdvertiserAccounts.map(
      (account) => account.id,
    )

    if (advertiserAccountIds.length > 0) {
      await tx
        .update(advertiserAccounts)
        .set({
          name: "Deleted account",
          websiteUrl: null,
          billingEmail: deletedEmail,
          status: "paused",
          stripeCustomerId: null,
          updatedAt: now,
        })
        .where(inArray(advertiserAccounts.id, advertiserAccountIds))

      await tx
        .update(advertiserPaymentMethods)
        .set({
          brand: null,
          last4: null,
          expMonth: null,
          expYear: null,
          billingName: null,
          billingEmail: null,
          status: "deleted",
          isDefault: false,
          updatedAt: now,
        })
        .where(
          inArray(
            advertiserPaymentMethods.advertiserAccountId,
            advertiserAccountIds,
          ),
        )

      await tx
        .update(brandFundingProfiles)
        .set({
          status: "paused",
          allowedCategories: null,
          blockedCategories: null,
          notes: null,
          updatedAt: now,
        })
        .where(
          inArray(
            brandFundingProfiles.advertiserAccountId,
            advertiserAccountIds,
          ),
        )
    }

    await tx
      .delete(advertiserMembers)
      .where(eq(advertiserMembers.userId, userId))

    const [deletedUser] = await tx
      .update(users)
      .set({
        authProvider: "deleted",
        authUserId: `deleted-${userId}`,
        email: deletedEmail,
        emailVerifiedAt: null,
        passwordHash: deletedPassword,
        failedLoginCount: 0,
        lockedUntil: null,
        handle: null,
        displayName: null,
        bio: null,
        avatarUrl: null,
        avatarAssetId: null,
        onboardingIntent: "explore",
        creatorStatus: "inactive",
        isCreatorMode: false,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id })

    if (!deletedUser) {
      throw new Error("Account not found.")
    }
  })

  return {
    ok: true,
    message: "Your account has been deleted.",
  }
}

export async function activateCreatorTools(): Promise<AuthResult> {
  const session = await getSession()

  if (!session) {
    return {
      ok: false,
      message: "Sign in to turn on posting.",
    }
  }

  if (!isProfileComplete(session)) {
    return {
      ok: false,
      message: "Choose your display name and handle before posting.",
    }
  }

  const db = getDb()
  const [user] = await db
    .update(users)
    .set({
      creatorStatus: "active",
      isCreatorMode: true,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.id))
    .returning()

  if (!user) {
    return {
      ok: false,
      message: "Your session is out of sync. Sign in again.",
    }
  }

  await db
    .insert(creatorProfiles)
    .values({
      userId: user.id,
    })
    .onConflictDoNothing()

  return {
    ok: true,
    user: toAuthUser(user),
  }
}
