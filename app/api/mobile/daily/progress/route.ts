import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import { DailyError, recordDailyProgress } from "@/lib/daily"

export const runtime = "nodejs"

const progressSchema = z.object({
  sessionId: z.string().min(1),
  position: z.number().int().min(0).max(4),
  positionMs: z.number().int().min(0),
  durationMs: z.number().int().min(1).nullable().optional(),
  event: z.enum(["started", "heartbeat", "completed", "exited"]),
})

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = progressSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Daily progress." }, { status: 400 })
  }

  try {
    return NextResponse.json(
      await recordDailyProgress({
        userId: session.id,
        ...parsed.data,
      }),
    )
  } catch (error) {
    if (error instanceof DailyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    throw error
  }
}
