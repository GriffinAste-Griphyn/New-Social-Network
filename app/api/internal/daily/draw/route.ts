import { NextResponse } from "next/server"
import { z } from "zod"

import { drawDailyPool, DailyError } from "@/lib/daily"
import { env } from "@/lib/env"

export const runtime = "nodejs"

const drawSchema = z.object({
  poolDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")

  if (!env.DAILY_DRAW_SECRET || token !== env.DAILY_DRAW_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = drawSchema.safeParse(await request.json().catch(() => ({})))

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Daily draw request." }, { status: 400 })
  }

  try {
    return NextResponse.json(await drawDailyPool(parsed.data))
  } catch (error) {
    if (error instanceof DailyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    throw error
  }
}
