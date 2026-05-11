import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import {
  blockUser,
  listBlockedUsers,
  unblockUser,
} from "@/lib/safety-store"

export const runtime = "nodejs"

const blockSchema = z.object({
  blockedUserId: z.string().trim().min(1),
})

export async function GET() {
  const session = await requireSession()
  const blockedUsers = await listBlockedUsers(session.id)

  return NextResponse.json({ ok: true, blockedUsers })
}

export async function POST(request: Request) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await requireSession()
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:blocks:user",
      subject: session.id,
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
      { error: "Choose a user to block." },
      { status: 400 },
    )
  }

  try {
    await blockUser({
      blockerId: session.id,
      blockedUserId: parsed.data.blockedUserId,
    })

    revalidatePath("/feed")
    revalidatePath("/blocked-users")

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not block this user.",
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

  const session = await requireSession()
  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:unblocks:user",
      subject: session.id,
      options: mutationRateLimits.socialWriteUser,
    },
    {
      bucket: "web:unblocks:ip",
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
      { error: "Choose a user to unblock." },
      { status: 400 },
    )
  }

  await unblockUser({
    blockerId: session.id,
    blockedUserId: parsed.data.blockedUserId,
  })

  revalidatePath("/feed")
  revalidatePath("/blocked-users")

  return NextResponse.json({ ok: true })
}
