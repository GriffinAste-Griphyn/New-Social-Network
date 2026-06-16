import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import { DailyError, startDailySession } from "@/lib/daily"

export const runtime = "nodejs"

const startSchema = z.object({
  eligibilityAccepted: z.literal(true),
})

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = startSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Confirm Daily eligibility before starting." },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(
      await startDailySession({
        userId: session.id,
        eligibilityAccepted: parsed.data.eligibilityAccepted,
      }),
    )
  } catch (error) {
    if (error instanceof DailyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    throw error
  }
}
