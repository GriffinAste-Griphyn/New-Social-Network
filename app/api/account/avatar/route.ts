import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getSession, isProfileComplete } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { users } from "@/lib/db/schema"
import {
  createMediaAssetFromStoredProfileAvatar,
  markMediaAssetDeleted,
} from "@/lib/media-assets"
import {
  ProfileAvatarUploadError,
  removeProfileAvatar,
  saveProfileAvatar,
} from "@/lib/profile-avatar-storage"
import {
  enforceRequestRateLimits,
  enforceSameOriginRequest,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { updateUserAvatar } from "@/lib/user-store"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originResponse = enforceSameOriginRequest(request)
  if (originResponse) {
    return originResponse
  }

  const session = await getSession()
  let storedAvatar: Awaited<ReturnType<typeof saveProfileAvatar>> | undefined

  if (!session) {
    return NextResponse.json(
      { error: "Sign in before updating your profile photo." },
      { status: 401 },
    )
  }

  if (!isProfileComplete(session)) {
    return NextResponse.json(
      { error: "Finish your profile before updating your profile photo." },
      { status: 403 },
    )
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "web:avatar-upload:user",
      subject: session.id,
      options: mutationRateLimits.profileWriteUser,
    },
    {
      bucket: "web:avatar-upload:ip",
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
      .select({ avatarUrl: users.avatarUrl, avatarAssetId: users.avatarAssetId })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1)

    storedAvatar = await saveProfileAvatar(avatarEntry)
    const mediaAsset = await createMediaAssetFromStoredProfileAvatar({
      ownerUserId: session.id,
      storedAvatar,
    })

    if (
      mediaAsset.scanStatus === "flagged" ||
      mediaAsset.scanStatus === "failed"
    ) {
      await removeProfileAvatar(storedAvatar.avatarUrl)
      await markMediaAssetDeleted({
        mediaAssetId: mediaAsset.id,
        actorUserId: session.id,
        reason: mediaAsset.scanReason ?? "Avatar upload failed safety scanning.",
      })

      return NextResponse.json(
        { error: mediaAsset.scanReason ?? "Choose a different profile photo." },
        { status: 400 },
      )
    }

    const result = await updateUserAvatar(
      session.id,
      storedAvatar.avatarUrl,
      mediaAsset.id,
    )

    if (!result.ok) {
      await removeProfileAvatar(storedAvatar.avatarUrl)
      await markMediaAssetDeleted({
        mediaAssetId: mediaAsset.id,
        actorUserId: session.id,
        reason: "Avatar upload was discarded after profile update failed.",
      })
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    await removeProfileAvatar(currentUser?.avatarUrl ?? null).catch(() => undefined)
    if (currentUser?.avatarAssetId) {
      await markMediaAssetDeleted({
        mediaAssetId: currentUser.avatarAssetId,
        actorUserId: session.id,
        reason: "Avatar was replaced by a newer upload.",
      }).catch(() => undefined)
    }

    return NextResponse.json({
      ok: true,
      user: result.user,
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
