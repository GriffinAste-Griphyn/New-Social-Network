import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"
import {
  InvalidStoryViewerCursorError,
  listStoryViewers,
  StoryViewersUnavailableError,
} from "@/lib/story-viewers"

export const runtime = "nodejs"

const querySchema = z.object({
  cursor: z.string().trim().min(1).max(1_024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  )

  if (!query.success) {
    return NextResponse.json(
      { error: "Check the viewer list request and try again." },
      { status: 400 },
    )
  }

  const { id } = await context.params

  try {
    const page = await listStoryViewers({
      creatorId: session.id,
      storyId: id,
      cursor: query.data.cursor,
      limit: query.data.limit,
    })

    return NextResponse.json(
      {
        ok: true,
        ...page,
        viewers: page.viewers.map((viewer) => ({
          ...viewer,
          imageUrl: publicProfileAvatarUrl(viewer.imageUrl, request),
        })),
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    )
  } catch (error) {
    if (error instanceof InvalidStoryViewerCursorError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (error instanceof StoryViewersUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    throw error
  }
}
