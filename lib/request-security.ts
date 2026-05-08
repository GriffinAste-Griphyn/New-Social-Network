import { headers } from "next/headers"
import { NextResponse } from "next/server"

import {
  consumeRateLimits,
  rateLimitKey,
  rateLimitWindows,
  type RateLimitOptions,
  type RateLimitResult,
} from "@/lib/rate-limit"

const forbiddenOriginMessage = "Invalid request origin."

export const mutationRateLimits = {
  authLoginIp: { limit: 30, windowMs: 15 * rateLimitWindows.minute },
  authSignupIp: { limit: 10, windowMs: rateLimitWindows.hour },
  authResetIp: { limit: 10, windowMs: rateLimitWindows.hour },
  profileWriteUser: { limit: 30, windowMs: rateLimitWindows.hour },
  socialWriteUser: { limit: 120, windowMs: 15 * rateLimitWindows.minute },
  storyUploadUser: { limit: 12, windowMs: rateLimitWindows.hour },
  storyUploadIp: { limit: 30, windowMs: rateLimitWindows.hour },
  storyWriteUser: { limit: 80, windowMs: 15 * rateLimitWindows.minute },
  storyInteractionUser: { limit: 120, windowMs: 15 * rateLimitWindows.minute },
  storyImpressionUser: { limit: 600, windowMs: 15 * rateLimitWindows.minute },
  reportUser: { limit: 20, windowMs: rateLimitWindows.hour },
  advertiserWriteUser: { limit: 40, windowMs: 15 * rateLimitWindows.minute },
  stripeWriteUser: { limit: 10, windowMs: 15 * rateLimitWindows.minute },
  pushTokenUser: { limit: 20, windowMs: rateLimitWindows.hour },
} as const satisfies Record<string, RateLimitOptions>

function parseOrigin(value: string | null) {
  if (!value) {
    return null
  }

  try {
    return new URL(value).origin.toLowerCase()
  } catch {
    return null
  }
}

function getForwardedOrigin(headerList: Headers) {
  const host =
    headerList.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    headerList.get("host")

  if (!host) {
    return null
  }

  const defaultProto = process.env.NODE_ENV === "production" ? "https" : "http"
  const proto =
    headerList.get("x-forwarded-proto")?.split(",")[0]?.trim() || defaultProto

  return parseOrigin(`${proto}://${host}`)
}

function getAllowedOrigins(request: Request | null, headerList: Headers) {
  return new Set(
    [
      request ? parseOrigin(request.url) : null,
      getForwardedOrigin(headerList),
      parseOrigin(process.env.NEXT_PUBLIC_APP_URL ?? null),
    ].filter((origin): origin is string => Boolean(origin)),
  )
}

function getSourceOrigin(headerList: Headers) {
  return (
    parseOrigin(headerList.get("origin")) ||
    parseOrigin(headerList.get("referer"))
  )
}

export function getRequestIpFromHeaders(headerList: Headers) {
  return (
    headerList.get("cf-connecting-ip") ||
    headerList.get("x-real-ip") ||
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  )
}

export function enforceSameOriginRequest(request: Request) {
  const sourceOrigin = getSourceOrigin(request.headers)
  const allowedOrigins = getAllowedOrigins(request, request.headers)

  if (sourceOrigin && allowedOrigins.has(sourceOrigin)) {
    return null
  }

  return NextResponse.json(
    { error: forbiddenOriginMessage },
    { status: 403 },
  )
}

export async function assertSameOriginAction() {
  const headerList = await headers()
  const sourceOrigin = getSourceOrigin(headerList)
  const allowedOrigins = getAllowedOrigins(null, headerList)

  if (!sourceOrigin || !allowedOrigins.has(sourceOrigin)) {
    throw new Error(forbiddenOriginMessage)
  }
}

function rateLimitHeaders(result: Extract<RateLimitResult, { ok: false }>) {
  return {
    "Retry-After": String(result.retryAfterSeconds),
  }
}

export async function enforceRequestRateLimits(
  request: Request,
  checks: Array<{
    bucket: string
    subject: string | null | undefined
    options: RateLimitOptions
  }>,
  responseOptions?: { redirectTo?: string | URL },
) {
  const result = await consumeRateLimits(
    checks.map((check) => ({
      key: rateLimitKey(check.bucket, check.subject),
      options: check.options,
    })),
  )

  if (result.ok) {
    return null
  }

  if (responseOptions?.redirectTo) {
    const url = new URL(responseOptions.redirectTo, request.url)
    url.searchParams.set("error", result.message)
    return NextResponse.redirect(url, {
      status: 303,
      headers: rateLimitHeaders(result),
    })
  }

  return NextResponse.json(
    { error: result.message },
    { status: 429, headers: rateLimitHeaders(result) },
  )
}

export function requestIpSubject(request: Request) {
  return getRequestIpFromHeaders(request.headers) || "unknown"
}

export async function enforceActionRateLimits(
  checks: Array<{
    bucket: string
    subject: string | null | undefined
    options: RateLimitOptions
  }>,
) {
  const result = await consumeRateLimits(
    checks.map((check) => ({
      key: rateLimitKey(check.bucket, check.subject),
      options: check.options,
    })),
  )

  if (!result.ok) {
    throw new Error(result.message)
  }
}

export async function getActionIpSubject() {
  const headerList = await headers()

  return getRequestIpFromHeaders(headerList) || "unknown"
}
