import { NextResponse } from "next/server"

import { getMobileSession } from "@/lib/auth"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { deleteUserAccount } from "@/lib/user-store"

export const runtime = "nodejs"

export async function DELETE(request: Request) {
  const session = await getMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:account-delete:user",
      subject: session.id,
      options: mutationRateLimits.accountDeleteUser,
    },
    {
      bucket: "mobile:account-delete:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.accountDeleteUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  try {
    const result = await deleteUserAccount(session.id)

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not delete account.",
      },
      { status: 400 },
    )
  }
}
