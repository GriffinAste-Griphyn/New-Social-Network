import { createHash, randomBytes, randomUUID } from "node:crypto"

import { cookies } from "next/headers"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { and, eq, gt, isNull } from "drizzle-orm"

import { env } from "@/lib/env"
import type { AuthUser } from "@/lib/user-store"
import { getDb } from "@/lib/db"
import { authSessions, users } from "@/lib/db/schema"

const sessionSchema = z.object({
  id: z.string(),
  email: z.email(),
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  onboardingIntent: z.enum(["explore", "create", "both"]).default("explore"),
  creatorStatus: z
    .enum(["inactive", "active", "suspended"])
    .default("inactive"),
})

export type AuthSession = z.infer<typeof sessionSchema>
export type CompleteAuthSession = AuthSession & {
  handle: string
  displayName: string
}

const sessionCookieName = "ubeye_session"
const legacySessionCookieName = "nsn_session"
const webSessionMaxAgeSeconds = 60 * 60 * 24 * 30
const mobileSessionMaxAgeSeconds = 60 * 60 * 24 * 30
const sessionLastSeenWriteIntervalMs = 5 * 60 * 1000

function hashToken(token: string) {
  return createHash("sha256")
    .update(`${env.AUTH_SECRET}:${token}`)
    .digest("hex")
}

function createOpaqueToken(sessionId: string) {
  const secret = randomBytes(32).toString("base64url")

  return `${sessionId}.${secret}`
}

function parseOpaqueToken(token: string) {
  const [sessionId, secret] = token.split(".")

  if (!sessionId || !secret) {
    return null
  }

  return {
    sessionId,
    tokenHash: hashToken(token),
  }
}

function toAuthSession(user: {
  id: string
  email: string
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
  onboardingIntent: "explore" | "create" | "both"
  creatorStatus: "inactive" | "active" | "suspended"
}) {
  return sessionSchema.parse(user)
}

function getRequestIp(headerList: Headers) {
  return (
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip") ||
    null
  )
}

async function getWebRequestMetadata() {
  const headerList = await headers()

  return {
    userAgent: headerList.get("user-agent"),
    ipAddress: getRequestIp(headerList),
  }
}

function getRequestMetadata(request: Request) {
  return {
    userAgent: request.headers.get("user-agent"),
    ipAddress: getRequestIp(request.headers),
  }
}

async function createStoredSession(input: {
  user: AuthUser
  kind: "web" | "mobile"
  maxAgeSeconds: number
  userAgent?: string | null
  ipAddress?: string | null
}) {
  const db = getDb()
  const sessionId = `auth-session-${randomUUID()}`
  const token = createOpaqueToken(sessionId)
  const expiresAt = new Date(Date.now() + input.maxAgeSeconds * 1000)

  await db.insert(authSessions).values({
    id: sessionId,
    userId: input.user.id,
    kind: input.kind,
    tokenHash: hashToken(token),
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
    expiresAt,
  })

  return token
}

async function getSessionFromToken(token: string, kind: "web" | "mobile") {
  const parsed = parseOpaqueToken(token)

  if (!parsed) {
    return null
  }

  const db = getDb()
  const [record] = await db
    .select({
      sessionId: authSessions.id,
      lastSeenAt: authSessions.lastSeenAt,
      id: users.id,
      email: users.email,
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      onboardingIntent: users.onboardingIntent,
      creatorStatus: users.creatorStatus,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.id, parsed.sessionId),
        eq(authSessions.kind, kind),
        eq(authSessions.tokenHash, parsed.tokenHash),
        gt(authSessions.expiresAt, new Date()),
        isNull(authSessions.revokedAt),
      ),
    )
    .limit(1)

  if (!record) {
    return null
  }

  if (
    Date.now() - record.lastSeenAt.getTime() >
    sessionLastSeenWriteIntervalMs
  ) {
    await db
      .update(authSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(authSessions.id, record.sessionId))
  }

  return toAuthSession(record)
}

async function revokeSessionToken(token: string) {
  const parsed = parseOpaqueToken(token)

  if (!parsed) {
    return
  }

  await getDb()
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessions.id, parsed.sessionId),
        eq(authSessions.tokenHash, parsed.tokenHash),
        isNull(authSessions.revokedAt),
      ),
    )
}

export function getMobileBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  const [scheme, token] = authorization.split(" ")

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null
  }

  return token
}

export async function getMobileSession(request: Request) {
  const token = getMobileBearerToken(request)

  return token ? getSessionFromToken(token, "mobile") : null
}

export async function getCompleteMobileSession(request: Request) {
  const session = await getMobileSession(request)

  return isProfileComplete(session) ? session : null
}

export function resolveNextPath(
  value: FormDataEntryValue | string | null | undefined,
  fallback = "/",
) {
  if (typeof value !== "string") {
    return fallback
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback
  }

  return value
}

export function buildAuthErrorUrl(
  pathname: "/login" | "/signup" | "/onboarding/profile",
  message: string,
  nextPath = "/",
) {
  const params = new URLSearchParams({
    error: message,
  })

  if (nextPath !== "/") {
    params.set("next", nextPath)
  }

  return `${pathname}?${params.toString()}`
}

export function buildAuthMessageUrl(
  pathname: "/login" | "/signup" | "/onboarding/profile",
  message: string,
  nextPath = "/",
) {
  const params = new URLSearchParams({
    message,
  })

  if (nextPath !== "/") {
    params.set("next", nextPath)
  }

  return `${pathname}?${params.toString()}`
}

export function isProfileComplete(
  session: AuthSession | null,
): session is CompleteAuthSession {
  return Boolean(session?.handle && session.displayName)
}

export async function getSession() {
  const cookieStore = await cookies()
  const cookieValue =
    cookieStore.get(sessionCookieName)?.value ??
    cookieStore.get(legacySessionCookieName)?.value

  if (!cookieValue) {
    return null
  }

  return getSessionFromToken(cookieValue, "web")
}

export async function getCompleteSession() {
  const session = await getSession()

  return isProfileComplete(session) ? session : null
}

export async function createSession(user: AuthUser) {
  const cookieStore = await cookies()
  const metadata = await getWebRequestMetadata()
  const sessionValue = await createStoredSession({
    user,
    kind: "web",
    maxAgeSeconds: webSessionMaxAgeSeconds,
    ...metadata,
  })

  cookieStore.set(sessionCookieName, sessionValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: webSessionMaxAgeSeconds,
  })
  cookieStore.set(legacySessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
}

export async function createMobileSessionToken(
  user: AuthUser,
  request?: Request,
) {
  return createStoredSession({
    user,
    kind: "mobile",
    maxAgeSeconds: mobileSessionMaxAgeSeconds,
    ...(request ? getRequestMetadata(request) : {}),
  })
}

export async function clearSession() {
  const cookieStore = await cookies()
  const cookieValue =
    cookieStore.get(sessionCookieName)?.value ??
    cookieStore.get(legacySessionCookieName)?.value

  if (cookieValue) {
    await revokeSessionToken(cookieValue)
  }

  cookieStore.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
  cookieStore.set(legacySessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
}

export async function revokeAllUserSessions(userId: string) {
  await getDb()
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
}

export async function requireSession(
  nextPath = "/feed",
): Promise<CompleteAuthSession> {
  const session = await getSession()
  const safeNextPath = resolveNextPath(nextPath, "/feed")

  if (!session) {
    redirect(`/login?next=${encodeURIComponent(safeNextPath)}`)
  }

  if (!isProfileComplete(session)) {
    redirect(`/onboarding/profile?next=${encodeURIComponent(safeNextPath)}`)
  }

  return session
}
