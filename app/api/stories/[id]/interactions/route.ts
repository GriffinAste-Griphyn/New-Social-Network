import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth"
import { createStoryInteraction } from "@/lib/story-interactions"

export const runtime = "nodejs"

const interactionSchema = z.object({
  kind: z.enum(["reply", "comment", "reaction"]).default("comment"),
  body: z.string().trim().max(1_000).optional(),
  reaction: z.string().trim().max(24).optional(),
})

export async function POST(
  request: Request,
  context: RouteContext<"/api/stories/[id]/interactions">,
) {
  const session = await requireSession()
  const { id } = await context.params
  const parsed = interactionSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Check the story interaction."

    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    await createStoryInteraction({
      storyId: id,
      actorId: session.id,
      kind: parsed.data.kind,
      body: parsed.data.body,
      reaction: parsed.data.reaction,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not save this comment.",
      },
      { status: 400 },
    )
  }
}
