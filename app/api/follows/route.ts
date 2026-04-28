import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getSession, isProfileComplete, resolveNextPath } from "@/lib/auth"
import {
  followUser,
  listFollowerProfiles,
  listFollowingProfiles,
  unfollowUser,
} from "@/lib/follow-store"

export const runtime = "nodejs"

const followActionSchema = z.object({
  action: z.enum(["follow", "unfollow"]).default("follow"),
  targetUserId: z.string().trim().min(1),
  next: z.string().optional(),
})

function redirectToPath(request: Request, nextPath?: string, error?: string) {
  const url = new URL(resolveNextPath(nextPath, "/feed"), request.url)

  if (error) {
    url.searchParams.set("error", error)
  }

  return NextResponse.redirect(url, { status: 303 })
}

async function parseFollowActionRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    const parsed = followActionSchema.safeParse(await request.json())

    return {
      kind: "json" as const,
      parsed,
    }
  }

  const formData = await request.formData()
  const parsed = followActionSchema.safeParse({
    action: formData.get("action"),
    targetUserId: formData.get("targetUserId"),
    next: formData.get("next"),
  })

  return {
    kind: "form" as const,
    parsed,
  }
}

export async function GET(request: Request) {
  const session = await getSession()

  if (!session) {
    const acceptsJson = request.headers.get("accept")?.includes("application/json")
    if (acceptsJson) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.redirect(new URL("/login?next=%2Ffeed", request.url), {
      status: 303,
    })
  }

  if (!isProfileComplete(session)) {
    const acceptsJson = request.headers.get("accept")?.includes("application/json")
    if (acceptsJson) {
      return NextResponse.json(
        { error: "Profile setup required." },
        { status: 403 },
      )
    }

    return NextResponse.redirect(
      new URL("/onboarding/profile?next=%2Ffeed", request.url),
      {
        status: 303,
      },
    )
  }

  const [following, followers] = await Promise.all([
    listFollowingProfiles(session.id),
    listFollowerProfiles(session.id),
  ])

  return NextResponse.json({ following, followers })
}

export async function POST(request: Request) {
  const session = await getSession()
  const { kind, parsed } = await parseFollowActionRequest(request)

  if (!session) {
    if (kind === "json") {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.redirect(new URL("/login?next=%2Ffeed", request.url), {
      status: 303,
    })
  }

  if (!isProfileComplete(session)) {
    if (kind === "json") {
      return NextResponse.json(
        { error: "Profile setup required." },
        { status: 403 },
      )
    }

    return NextResponse.redirect(
      new URL("/onboarding/profile?next=%2Ffeed", request.url),
      {
        status: 303,
      },
    )
  }

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid follow request."

    if (kind === "json") {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return redirectToPath(request, "/feed", message)
  }

  try {
    if (parsed.data.action === "unfollow") {
      await unfollowUser({
        followerId: session.id,
        followeeId: parsed.data.targetUserId,
      })
    } else {
      await followUser({
        followerId: session.id,
        followeeId: parsed.data.targetUserId,
      })
    }

    revalidatePath("/feed")

    if (kind === "json") {
      const [following, followers] = await Promise.all([
        listFollowingProfiles(session.id),
        listFollowerProfiles(session.id),
      ])

      return NextResponse.json({
        action: parsed.data.action,
        following,
        followers,
      })
    }

    return redirectToPath(request, parsed.data.next)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update your following list."

    if (kind === "json") {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return redirectToPath(request, parsed.data.next, message)
  }
}
