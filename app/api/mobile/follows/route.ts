import { NextResponse } from "next/server"
import { z } from "zod"
import { and, eq, inArray } from "drizzle-orm"

import { getCompleteMobileSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { stories, users } from "@/lib/db/schema"
import {
  followUser,
  listFollowingProfiles,
  unfollowUser,
} from "@/lib/follow-store"

export const runtime = "nodejs"

const followMutationSchema = z.object({
  creatorId: z.string().min(1),
})

async function resolveFolloweeId(value: string) {
  const db = getDb()
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, value))
    .limit(1)

  if (user) {
    return user.id
  }

  const [story] = await db
    .select({ creatorId: stories.creatorId })
    .from(stories)
    .where(eq(stories.id, value))
    .limit(1)

  return story?.creatorId ?? value
}

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const profiles = await listFollowingProfiles(session.id)
  const db = getDb()
  const followedUserIds = profiles.map((profile) => profile.id)
  const followedStoryRows =
    followedUserIds.length > 0
      ? await db
          .select({ id: stories.id })
          .from(stories)
          .where(
            and(
              inArray(stories.creatorId, followedUserIds),
              eq(stories.status, "live"),
              eq(stories.moderationStatus, "approved"),
            ),
          )
      : []

  return NextResponse.json({
    ok: true,
    followedCreatorIds: [
      ...followedUserIds,
      ...followedStoryRows.map((story) => story.id),
    ].filter((id, index, ids) => ids.indexOf(id) === index),
  })
}

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = followMutationSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a creator to follow." },
      { status: 400 },
    )
  }

  try {
    const followeeId = await resolveFolloweeId(parsed.data.creatorId)

    await followUser({
      followerId: session.id,
      followeeId,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not follow creator.",
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

  const parsed = followMutationSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a creator to remove." },
      { status: 400 },
    )
  }

  const followeeId = await resolveFolloweeId(parsed.data.creatorId)

  await unfollowUser({
    followerId: session.id,
    followeeId,
  })

  return NextResponse.json({ ok: true })
}
