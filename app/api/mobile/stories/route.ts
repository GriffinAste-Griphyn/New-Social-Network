import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST() {
  return NextResponse.json(
    { error: "Update UBEYE to post stories with the current media pipeline." },
    { status: 426, headers: { Upgrade: "UBEYE/285" } },
  )
}
