import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { settleCreatorPayouts } from "@/lib/creator-earnings"
import { getCreatorStats } from "@/lib/creator-stats"
import {
  getCreatorStripeStatus,
  syncCreatorStripeAccount,
} from "@/lib/stripe-connect"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const shouldSync = url.searchParams.get("sync") === "1"
  const status = shouldSync
    ? await syncCreatorStripeAccount(session.id).catch(() =>
        getCreatorStripeStatus(session.id),
      )
    : await getCreatorStripeStatus(session.id)

  if (shouldSync) {
    await settleCreatorPayouts(session.id)
  }

  const stats = await getCreatorStats(session.id)

  return NextResponse.json({
    ok: true,
    status,
    earnings: stats.earnings,
  })
}
