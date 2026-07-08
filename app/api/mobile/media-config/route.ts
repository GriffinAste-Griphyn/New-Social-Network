import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getMobileMediaConfig } from "@/lib/mobile-media-config"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Authorization, X-Device-Id",
        },
      },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      media: getMobileMediaConfig(),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Authorization, X-Device-Id",
      },
    },
  )
}
