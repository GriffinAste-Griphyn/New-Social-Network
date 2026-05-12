import { NextResponse } from "next/server"
import { z } from "zod"

import { getSession, isProfileComplete } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
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

async function requireCompleteWebSession() {
  const session = await getSession()

  if (!session) {
    return {
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    }
  }

  if (!isProfileComplete(session)) {
    return {
      response: NextResponse.json(
        { error: "Profile setup required." },
        { status: 403 },
      ),
    }
  }

  return { session }
}

export async function GET() {
  const auth = await requireCompleteWebSession()

  if ("response" in auth) {
    return auth.response
  }

  return NextResponse.json({
    ok: true,
    blocked: await listBlockedProfiles(auth.session.id),
  })
}

export async function POST(request: Request) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const auth = await requireCompleteWebSession()

  if ("response" in auth) {
    return auth.response
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:blocks:user",
      subject: auth.session.id,
      options: mutationRateLimits.socialWriteUser,
    },
    {
      bucket: "web:blocks:ip",
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
      blockerId: auth.session.id,
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
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const auth = await requireCompleteWebSession()

  if ("response" in auth) {
    return auth.response
  }

  const parsed = blockSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose an account to unblock." },
      { status: 400 },
    )
  }

  await unblockUser({
    blockerId: auth.session.id,
    blockedId: parsed.data.userId,
  })

  return NextResponse.json({ ok: true })
}
