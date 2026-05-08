import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import { registerMobilePushToken } from "@/lib/creator-notifications"

export const runtime = "nodejs"

const pushTokenSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.string().min(1).max(32).nullable().optional(),
})

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = pushTokenSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Could not register this device for notifications." },
      { status: 400 },
    )
  }

  try {
    await registerMobilePushToken({
      userId: session.id,
      expoPushToken: parsed.data.expoPushToken,
      platform: parsed.data.platform ?? null,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not register this device for notifications.",
      },
      { status: 400 },
    )
  }
}
