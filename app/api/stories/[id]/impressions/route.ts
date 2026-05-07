import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth"
import { recordStoryImpression } from "@/lib/story-impressions"

export const runtime = "nodejs"

const impressionSchema = z.object({
  viewedMs: z.number().min(0).max(10 * 60 * 1000).default(0),
  completed: z.boolean().default(false),
})

export async function POST(
  request: Request,
  context: RouteContext<"/api/stories/[id]/impressions">,
) {
  const session = await requireSession()
  const { id } = await context.params
  const parsed = impressionSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Check the view event."

    return NextResponse.json({ error: message }, { status: 400 })
  }

  const result = await recordStoryImpression({
    storyId: id,
    viewerId: session.id,
    viewedMs: parsed.data.viewedMs,
    completed: parsed.data.completed,
  })

  return NextResponse.json({ ok: true, ...result })
}
