import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import { DailyError, recordDailyClick } from "@/lib/daily"

export const runtime = "nodejs"

const clickSchema = z.object({
  sessionId: z.string().min(1),
  position: z.number().int().min(0).max(4),
  positionMs: z.number().int().min(0),
})

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = clickSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Daily click." }, { status: 400 })
  }

  try {
    return NextResponse.json(
      await recordDailyClick({
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
