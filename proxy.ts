import { NextResponse, type NextRequest } from "next/server"

const consumerAppPaths = [
  "/feed",
  "/stories",
  "/stats",
  "/payouts",
  "/blocked-users",
]

function isConsumerAppPath(pathname: string) {
  return consumerAppPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
}

function isMobileWebRequest(request: NextRequest) {
  const clientHintMobile = request.headers.get("sec-ch-ua-mobile")

  if (clientHintMobile === "?1") {
    return true
  }

  const userAgent = request.headers.get("user-agent") ?? ""

  return /\b(Android|iPhone|iPad|iPod|Mobile|Windows Phone|BlackBerry)\b/i.test(
    userAgent,
  )
}

function consumerNextPath(request: NextRequest) {
  const nextPath = request.nextUrl.searchParams.get("next") ?? "/feed"

  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return null
  }

  return isConsumerAppPath(nextPath) ? nextPath : null
}

function redirectToMobileOnly(request: NextRequest, nextPath: string) {
  const url = request.nextUrl.clone()
  url.pathname = "/mobile-only"
  url.search = ""
  url.searchParams.set("next", nextPath)

  return NextResponse.redirect(url)
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const protectedConsumerPath = isConsumerAppPath(pathname)
  const authConsumerPath =
    ["/login", "/signup", "/onboarding/profile"].includes(pathname) &&
    consumerNextPath(request)
  const blockedNextPath = protectedConsumerPath
    ? pathname
    : authConsumerPath || null

  if (blockedNextPath && !isMobileWebRequest(request)) {
    return redirectToMobileOnly(request, blockedNextPath)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/feed",
    "/stories/:path*",
    "/stats",
    "/payouts",
    "/blocked-users",
    "/login",
    "/signup",
    "/onboarding/profile",
  ],
}
