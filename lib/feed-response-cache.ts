import { createHash } from "node:crypto"
import type { FeedData } from "@/lib/story-store"

/** Scoped validator over the unsigned snapshot. A short time bucket refreshes
 * signed media URLs and relative labels even when no publication invalidates it.
 */
export function feedResponseEtag(feed: FeedData, request: Request, viewer: { id: string; displayName: string; handle: string }, limit: number) {
  return `W/"${createHash("sha256").update(JSON.stringify([
    "feed-v3", viewer.id, viewer.displayName, viewer.handle,
    new URL(request.url).origin, limit,
    request.headers.get("x-device-id"), request.headers.get("x-ubeye-app-build"),
    request.headers.get("x-ubeye-media-pipeline"), Math.floor(Date.now() / 30_000), feed,
  ])).digest("base64url")}"`
}

export function matchesFeedEtag(request: Request, etag: string) {
  if (request.method !== "GET") return false
  return request.headers.get("if-none-match")?.split(",").some(value => value.trim().replace(/^W\//, "") === etag.replace(/^W\//, "")) ?? false
}

export function feedResponseHeaders(etag?: string) {
  return new Headers({
    "Cache-Control": "private, no-cache",
    "CDN-Cache-Control": "no-store",
    "Content-Type": "application/json",
    Vary: "Authorization, X-Device-Id, X-UBEYE-App-Build, X-UBEYE-Media-Pipeline",
    ...(etag ? { ETag: etag } : {}),
  })
}
