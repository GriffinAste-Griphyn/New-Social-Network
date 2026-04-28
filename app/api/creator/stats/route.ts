import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"

export const runtime = "nodejs"

export async function GET() {
  const session = await requireSession()

  if (session.creatorStatus !== "active") {
    return NextResponse.json(
      { error: "Creator stats are available after creator tools are active." },
      { status: 403 },
    )
  }

  const stats = await getCreatorStats(session.id)

  return NextResponse.json({
    ok: true,
    stats,
  })
}
