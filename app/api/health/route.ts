import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "new-social-network",
    now: new Date().toISOString(),
  })
}
