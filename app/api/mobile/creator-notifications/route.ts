import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  getCreatorNotificationPreference,
  setCreatorNotificationPreference,
} from "@/lib/creator-notifications"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const notificationPreferenceSchema = z.object({
  creatorId: z.string().min(1),
  enabled: z.boolean(),
})

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const creatorId = new URL(request.url).searchParams.get("creatorId")

  if (!creatorId) {
    return NextResponse.json(
      { error: "Choose a creator first." },
      { status: 400 },
    )
  }

  const enabled = await getCreatorNotificationPreference({
    subscriberId: session.id,
    creatorId,
  })

  return NextResponse.json({ ok: true, enabled })
}

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:creator-notifications:user",
      subject: session.id,
      options: mutationRateLimits.socialWriteUser,
    },
    {
      bucket: "mobile:creator-notifications:ip",
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
      { error: "Could not update story notifications." },
      { status: 400 },
    )
  }

  try {
    await setCreatorNotificationPreference({
      subscriberId: session.id,
      creatorId: parsed.data.creatorId,
      enabled: parsed.data.enabled,
    })

    return NextResponse.json({ ok: true, enabled: parsed.data.enabled })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update story notifications.",
      },
      { status: 400 },
    )
  }
}
