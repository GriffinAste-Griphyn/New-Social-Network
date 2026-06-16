import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getDailyStatusForUser } from "@/lib/daily"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json(await getDailyStatusForUser(session.id))
}
