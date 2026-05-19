import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json(
    { error: "Manage payout setup on ubeye.ai/creator/payouts." },
    { status: 403 },
  )
}
