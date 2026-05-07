import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth"
import { getCreatorStats } from "@/lib/creator-stats"

export const runtime = "nodejs"

function parseStatsRange(request: Request) {
  const url = new URL(request.url)
  const fromValue = url.searchParams.get("from")
  const toValue = url.searchParams.get("to")
  const from = fromValue ? new Date(fromValue) : undefined
  const to = toValue ? new Date(toValue) : undefined

  return {
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined,
  }
}

export async function GET(request: Request) {
  const session = await requireSession()

  if (session.creatorStatus !== "active") {
    return NextResponse.json(
      { error: "Creator stats are available after creator tools are active." },
      { status: 403 },
    )
  }

  const stats = await getCreatorStats(session.id, parseStatsRange(request))

  return NextResponse.json({
    ok: true,
    stats,
  })
}
