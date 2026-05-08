import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { users } from "@/lib/db/schema"
import {
  ProfileAvatarUploadError,
  removeProfileAvatar,
  saveProfileAvatar,
} from "@/lib/profile-avatar-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { updateUserAvatar } from "@/lib/user-store"

export const runtime = "nodejs"

function absoluteMediaUrl(value: string | null, request: Request) {
  if (!value) {
    return null
  }

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  return new URL(value, request.url).toString()
}

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)
  let storedAvatar: Awaited<ReturnType<typeof saveProfileAvatar>> | undefined

  if (!session) {
    return NextResponse.json(
      { error: "Sign in before updating your profile photo." },
      { status: 401 },
    )
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:avatar-upload:user",
      subject: session.id,
      options: mutationRateLimits.profileWriteUser,
    },
    {
      bucket: "mobile:avatar-upload:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.profileWriteUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  try {
    const formData = await request.formData()
    const avatarEntry = formData.get("avatar")

    if (!(avatarEntry instanceof File)) {
      return NextResponse.json(
        { error: "Choose a profile photo first." },
        { status: 400 },
      )
    }

    const [currentUser] = await getDb()
      .select({ avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1)

    storedAvatar = await saveProfileAvatar(avatarEntry)

    const result = await updateUserAvatar(session.id, storedAvatar.avatarUrl)

    if (!result.ok) {
      await removeProfileAvatar(storedAvatar.avatarUrl)
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    await removeProfileAvatar(currentUser?.avatarUrl ?? null).catch(() => undefined)

    return NextResponse.json({
      ok: true,
      user: {
        ...result.user,
        avatarUrl: absoluteMediaUrl(result.user.avatarUrl, request),
      },
    })
  } catch (error) {
    if (storedAvatar) {
      await removeProfileAvatar(storedAvatar.avatarUrl).catch(() => undefined)
    }

    const message =
      error instanceof ProfileAvatarUploadError || error instanceof Error
        ? error.message
        : "Profile photo upload failed."

    return NextResponse.json({ error: message }, { status: 400 })
  }
}
