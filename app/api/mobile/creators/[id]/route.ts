import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getMobileCreatorProfile } from "@/lib/story-store"
import { publicStoryMediaUrl } from "@/lib/story-storage"

export const runtime = "nodejs"

function absoluteMediaUrl(value: string | null, request: Request) {
  if (!value) {
    return null
  }

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  return new URL(value, request.url).toString()
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/mobile/creators/[id]">,
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params
  const profile = await getMobileCreatorProfile(id, session.id)

  if (!profile) {
    return NextResponse.json({ error: "Creator not found." }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    profile: {
      ...profile,
      avatarUrl: absoluteMediaUrl(profile.avatarUrl, request),
      coverUrl:
        publicStoryMediaUrl(profile.coverUrl, request, { signed: true }) ??
        absoluteMediaUrl(profile.coverUrl, request),
    },
  })
}
