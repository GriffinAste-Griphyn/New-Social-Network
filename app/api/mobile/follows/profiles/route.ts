import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  listFollowerProfiles,
  listFollowingProfiles,
} from "@/lib/follow-store"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [followers, following] = await Promise.all([
    listFollowerProfiles(session.id),
    listFollowingProfiles(session.id),
  ])

  return NextResponse.json({
    ok: true,
    followers,
    following,
  })
}
