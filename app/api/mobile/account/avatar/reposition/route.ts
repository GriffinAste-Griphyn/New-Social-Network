import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { users } from "@/lib/db/schema"
import {
  applyMediaModerationResult,
  createMediaAssetFromStoredProfileAvatar,
  markMediaAssetDeleted,
} from "@/lib/media-assets"
import { moderateUserContent } from "@/lib/safety/moderate-content"
import { recordModerationCheck } from "@/lib/safety/moderation-checks"
import {
  ProfileAvatarUploadError,
  publicProfileAvatarUrl,
  removeProfileAvatar,
  saveRepositionedProfileAvatar,
} from "@/lib/profile-avatar-storage"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"
import { updateUserAvatar } from "@/lib/user-store"

export const runtime = "nodejs"

const avatarRepositionSchema = z.object({
  crop: z.object({
    originX: z.number().min(0),
    originY: z.number().min(0),
    width: z.number().min(1),
    height: z.number().min(1),
  }),
})

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)
  let storedAvatar: Awaited<ReturnType<typeof saveRepositionedProfileAvatar>> | undefined

  if (!session) {
    return NextResponse.json(
      { error: "Sign in before updating your profile photo." },
      { status: 401 },
    )
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:avatar-reposition:user",
      subject: session.id,
      options: mutationRateLimits.profileWriteUser,
    },
    {
      bucket: "mobile:avatar-reposition:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.profileWriteUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = avatarRepositionSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a valid profile photo position." },
      { status: 400 },
    )
  }

  try {
    const [currentUser] = await getDb()
      .select({
        avatarUrl: users.avatarUrl,
        avatarAssetId: users.avatarAssetId,
        avatarSourceUrl: users.avatarSourceUrl,
        avatarSourceStorageKey: users.avatarSourceStorageKey,
        avatarSourceContentType: users.avatarSourceContentType,
        avatarSourceByteSize: users.avatarSourceByteSize,
      })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1)

    if (
      !currentUser?.avatarSourceUrl ||
      !currentUser.avatarSourceStorageKey ||
      !currentUser.avatarSourceContentType ||
      !currentUser.avatarSourceByteSize
    ) {
      return NextResponse.json(
        {
          error:
            "Choose the original profile photo once, then repositioning will work from then on.",
        },
        { status: 409 },
      )
    }

    storedAvatar = await saveRepositionedProfileAvatar({
      sourceUrl: currentUser.avatarSourceUrl,
      sourceStorageKey: currentUser.avatarSourceStorageKey,
      sourceContentType: currentUser.avatarSourceContentType,
      sourceByteSize: currentUser.avatarSourceByteSize,
      crop: parsed.data.crop,
    })

    const mediaAsset = await createMediaAssetFromStoredProfileAvatar({
      ownerUserId: session.id,
      storedAvatar,
    })
    const contentModeration = await moderateUserContent({
      textParts: [],
      media: {
        assetKind: "image",
        contentType: storedAvatar.contentType,
        byteSize: storedAvatar.byteSize,
        mediaUrl: publicProfileAvatarUrl(storedAvatar.avatarUrl, request),
      },
    })

    await applyMediaModerationResult({
      mediaAssetId: mediaAsset.id,
      actorUserId: session.id,
      result: contentModeration,
    }).catch(() => undefined)
    await recordModerationCheck({
      targetKind: "avatar",
      targetId: mediaAsset.id,
      actorUserId: session.id,
      mediaAssetId: mediaAsset.id,
      result: contentModeration,
    }).catch(() => undefined)

    if (
      mediaAsset.scanStatus === "flagged" ||
      mediaAsset.scanStatus === "failed" ||
      contentModeration.action !== "approve"
    ) {
      await removeProfileAvatar(storedAvatar.avatarUrl)
      await markMediaAssetDeleted({
        mediaAssetId: mediaAsset.id,
        actorUserId: session.id,
        reason:
          contentModeration.reason ??
          mediaAsset.scanReason ??
          "Avatar reposition failed safety scanning.",
      })

      return NextResponse.json(
        {
          error:
            contentModeration.reason ??
            mediaAsset.scanReason ??
            "Choose a different photo position.",
        },
        { status: 400 },
      )
    }

    const result = await updateUserAvatar(
      session.id,
      storedAvatar.avatarUrl,
      mediaAsset.id,
      {
        sourceUrl: storedAvatar.sourceUrl,
        sourceStorageKey: storedAvatar.sourceStorageKey,
        sourceContentType: storedAvatar.sourceContentType,
        sourceByteSize: storedAvatar.sourceByteSize,
      },
    )

    if (!result.ok) {
      await removeProfileAvatar(storedAvatar.avatarUrl)
      await markMediaAssetDeleted({
        mediaAssetId: mediaAsset.id,
        actorUserId: session.id,
        reason: "Avatar reposition was discarded after profile update failed.",
      })
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    await removeProfileAvatar(currentUser.avatarUrl ?? null).catch(() => undefined)
    if (currentUser.avatarAssetId) {
      await markMediaAssetDeleted({
        mediaAssetId: currentUser.avatarAssetId,
        actorUserId: session.id,
        reason: "Avatar was replaced by a repositioned crop.",
      }).catch(() => undefined)
    }

    return NextResponse.json({
      ok: true,
      user: {
        ...result.user,
        avatarUrl: publicProfileAvatarUrl(result.user.avatarUrl, request),
      },
    })
  } catch (error) {
    if (storedAvatar) {
      await removeProfileAvatar(storedAvatar.avatarUrl).catch(() => undefined)
    }

    const message =
      error instanceof ProfileAvatarUploadError || error instanceof Error
        ? error.message
        : "Profile photo reposition failed."

    return NextResponse.json({ error: message }, { status: 400 })
  }
}
