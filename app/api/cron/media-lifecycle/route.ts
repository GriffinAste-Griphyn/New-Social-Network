import { NextResponse } from "next/server"

import { env } from "@/lib/env"
import { runMediaLifecycleMaintenance } from "@/lib/media-assets"

export const runtime = "nodejs"

function isAuthorized(request: Request) {
  const secret = env.CRON_SECRET

  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`)
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runMediaLifecycleMaintenance()

  return NextResponse.json({ ok: true, result })
}
