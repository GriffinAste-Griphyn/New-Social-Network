import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { searchDiscoverProfiles } from "@/lib/follow-store"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const requestUrl = new URL(request.url)
  const query = requestUrl.searchParams.get("q") ?? ""
  const profiles = await searchDiscoverProfiles({
    viewerId: session.id,
    query,
    limit: query.trim() ? 12 : 8,
  })

  return NextResponse.json({
    ok: true,
    profiles: profiles.map((profile) => ({
      ...profile,
      imageUrl: publicProfileAvatarUrl(profile.imageUrl, request),
    })),
  })
}
