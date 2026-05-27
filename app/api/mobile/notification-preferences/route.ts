import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  getUserNotificationPreferences,
  setUserNotificationPreferences,
  userNotificationPreferenceTypes,
} from "@/lib/user-notification-preferences"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const notificationPreferenceSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: z.enum(userNotificationPreferenceTypes),
        enabled: z.boolean(),
      }),
    )
    .min(1),
})

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const preferences = await getUserNotificationPreferences(session.id)

  return NextResponse.json({ ok: true, preferences })
}

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:notification-preferences:user",
      subject: session.id,
      options: mutationRateLimits.socialWriteUser,
    },
    {
      bucket: "mobile:notification-preferences:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.socialWriteUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = notificationPreferenceSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Could not update notification preferences." },
      { status: 400 },
    )
  }

  const preferences = await setUserNotificationPreferences({
    userId: session.id,
    preferences: parsed.data.preferences,
  })

  return NextResponse.json({ ok: true, preferences })
}
