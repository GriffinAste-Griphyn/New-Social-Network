import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  createStoryInteraction,
  listStoryInteractionsForCreator,
} from "@/lib/story-interactions"
import {
  publicStoryMediaUrl,
  removeStoryAsset,
  saveStoryAsset,
  StoryUploadError,
} from "@/lib/story-storage"

export const runtime = "nodejs"

const interactionSchema = z.object({
  kind: z.enum(["reply", "comment", "reaction"]).default("reply"),
  body: z.string().trim().max(1_000).optional(),
  reaction: z.string().trim().max(24).optional(),
})

function getStringFormValue(formData: FormData, key: string) {
  const value = formData.get(key)

  return typeof value === "string" ? value : undefined
}

export async function GET(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const interactions = await listStoryInteractionsForCreator({
    creatorId: session.id,
    kinds: ["reply", "comment"],
    limit: 100,
  })

  return NextResponse.json({
    ok: true,
    interactions: interactions.map((interaction) => ({
      ...interaction,
      mediaUrl:
        publicStoryMediaUrl(interaction.mediaUrl, request, { signed: true }) ??
        interaction.mediaUrl,
      mediaThumbnailUrl: publicStoryMediaUrl(
        interaction.mediaThumbnailUrl,
        request,
        { signed: true },
      ),
    })),
  })
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/mobile/stories/[id]/interactions">,
) {
  let storedAsset: Awaited<ReturnType<typeof saveStoryAsset>> | undefined

  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params
  const contentType = request.headers.get("content-type") ?? ""
  const formData = contentType.includes("multipart/form-data")
    ? await request.formData().catch(() => null)
    : null
  const mediaEntry = formData?.get("media")
  const payload = formData
    ? {
        kind: getStringFormValue(formData, "kind"),
        body: getStringFormValue(formData, "body"),
        reaction: getStringFormValue(formData, "reaction"),
      }
    : await request.json().catch(() => null)

  if (!payload) {
    return NextResponse.json(
      { error: "Could not read the reply upload. Try again." },
      { status: 400 },
    )
  }

  const parsed = interactionSchema.safeParse(payload)

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Check the story interaction."

    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    if (mediaEntry instanceof File) {
      storedAsset = await saveStoryAsset(mediaEntry)
    }

    await createStoryInteraction({
      storyId: id,
      actorId: session.id,
      kind: parsed.data.kind,
      body: parsed.data.body,
      reaction: parsed.data.reaction,
      storedAsset,
    })

    return NextResponse.json({
      ok: true,
      asset: storedAsset
        ? {
            assetKind: storedAsset.assetKind,
            mediaUrl:
              publicStoryMediaUrl(storedAsset.mediaUrl, request, {
                signed: true,
              }) ?? storedAsset.mediaUrl,
            thumbnailUrl: publicStoryMediaUrl(storedAsset.thumbnailUrl, request, {
              signed: true,
            }),
          }
        : null,
    })
  } catch (error) {
    if (storedAsset) {
      await removeStoryAsset(storedAsset.mediaUrl)
    }

    return NextResponse.json(
      {
        error:
          error instanceof StoryUploadError || error instanceof Error
            ? error.message
            : "Could not send your reply.",
      },
      { status: 400 },
    )
  }
}
