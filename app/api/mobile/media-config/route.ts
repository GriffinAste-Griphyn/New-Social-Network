import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getMobileMediaConfig } from "@/lib/mobile-media-config"

export const runtime = "nodejs"

function clientBuild(request: Request) {
  const parsed = Number.parseInt(
    request.headers.get("X-UBEYE-App-Build")?.trim() ?? "",
    10,
  )

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Authorization, X-Device-Id, X-UBEYE-App-Build",
        },
      },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      media: getMobileMediaConfig({ clientBuild: clientBuild(request) }),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Authorization, X-Device-Id, X-UBEYE-App-Build",
      },
    },
  )
}
