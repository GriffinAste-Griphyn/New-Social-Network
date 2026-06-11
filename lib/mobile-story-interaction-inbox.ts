import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { publicProfileAvatarUrl } from "@/lib/profile-avatar-storage"
import {
  listStoryInteractionsForActor,
  listStoryInteractionsForCreator,
} from "@/lib/story-interactions"
import { publicStoryMediaUrl } from "@/lib/story-storage"

export async function mobileStoryInteractionInboxResponse(
  request: Request,
  input: { storyId?: string } = {},
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [interactions, sentInteractions] = await Promise.all([
    listStoryInteractionsForCreator({
      creatorId: session.id,
      storyId: input.storyId,
      kinds: ["reply", "comment"],
      limit: 100,
    }),
    listStoryInteractionsForActor({
      actorId: session.id,
      storyId: input.storyId,
      kinds: ["reply", "comment"],
      limit: 100,
    }),
  ])

  const withPublicMediaUrls = <
    TInteraction extends {
      mediaUrl: string | null
      mediaThumbnailUrl: string | null
      story: {
        mediaUrl: string
        thumbnailUrl: string | null
      }
    },
  >(
    interaction: TInteraction,
  ) => ({
    ...interaction,
    story: {
      ...interaction.story,
      mediaUrl:
        publicStoryMediaUrl(interaction.story.mediaUrl, request, {
          signed: true,
        }) ?? interaction.story.mediaUrl,
      thumbnailUrl: publicStoryMediaUrl(
        interaction.story.thumbnailUrl,
        request,
        { signed: true },
      ),
    },
    mediaUrl:
      publicStoryMediaUrl(interaction.mediaUrl, request, { signed: true }) ??
      interaction.mediaUrl,
    mediaThumbnailUrl: publicStoryMediaUrl(
      interaction.mediaThumbnailUrl,
      request,
      { signed: true },
    ),
  })

  return NextResponse.json({
    ok: true,
    interactions: interactions.map((interaction) => ({
      ...withPublicMediaUrls(interaction),
      actor: {
        ...interaction.actor,
        imageUrl: publicProfileAvatarUrl(interaction.actor.imageUrl, request),
      },
    })),
    sentInteractions: sentInteractions.map((interaction) => ({
      ...withPublicMediaUrls(interaction),
      actor: {
        ...interaction.actor,
        imageUrl: publicProfileAvatarUrl(interaction.actor.imageUrl, request),
      },
      target: {
        ...interaction.target,
        imageUrl: publicProfileAvatarUrl(interaction.target.imageUrl, request),
      },
    })),
  })
}
