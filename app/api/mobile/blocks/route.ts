import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import {
  blockUser,
  listBlockedProfiles,
  unblockUser,
} from "@/lib/social-safety"

export const runtime = "nodejs"

const blockSchema = z.object({
  userId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
})

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json({
    ok: true,
    blocked: await listBlockedProfiles(session.id),
  })
}

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:blocks:user",
      subject: session.id,
      options: mutationRateLimits.socialWriteUser,
    },
    {
      bucket: "mobile:blocks:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.socialWriteUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = blockSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose an account to block." },
      { status: 400 },
    )
  }

  try {
    await blockUser({
      blockerId: session.id,
      blockedId: parsed.data.userId,
      reason: parsed.data.reason,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not block account.",
      },
      { status: 400 },
    )
  }
}

export async function DELETE(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = blockSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose an account to unblock." },
      { status: 400 },
    )
  }

  await unblockUser({
    blockerId: session.id,
    blockedId: parsed.data.userId,
  })

  return NextResponse.json({ ok: true })
}
