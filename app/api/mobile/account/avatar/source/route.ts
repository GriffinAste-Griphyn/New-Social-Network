import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [user] = await getDb()
    .select({
      avatarSourceUrl: users.avatarSourceUrl,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1)

  if (!user?.avatarSourceUrl) {
    return NextResponse.json({
      ok: true,
      sourceUrl: null,
      fallbackAvatarUrl: publicProfileAvatarUrl(user?.avatarUrl ?? null, request),
    })
  }

  return NextResponse.json({
    ok: true,
    sourceUrl: publicProfileAvatarUrl(user.avatarSourceUrl, request),
    fallbackAvatarUrl: publicProfileAvatarUrl(user.avatarUrl, request),
  })
}
