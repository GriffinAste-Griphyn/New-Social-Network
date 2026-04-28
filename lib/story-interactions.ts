import { randomUUID } from "node:crypto"

import { and, desc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { stories, storyInteractions, users } from "@/lib/db/schema"

export type StoryInteractionKind = "reply" | "comment" | "reaction"

export type StoryInteractionEvent = {
  id: string
  storyId: string
  creatorId: string
  actor: {
    id: string
    name: string
    handle: string
    imageUrl: string | null
  }
  kind: StoryInteractionKind
  body: string | null
  reaction: string | null
  createdAt: string
}

function mapEvent(row: {
  id: string
  storyId: string
  creatorId: string
  actorId: string
  displayName: string | null
  handle: string | null
  avatarUrl: string | null
  kind: StoryInteractionKind
  body: string | null
  reaction: string | null
  createdAt: Date
}): StoryInteractionEvent | null {
  if (!row.displayName || !row.handle) {
    return null
  }

  return {
    id: row.id,
    storyId: row.storyId,
    creatorId: row.creatorId,
    actor: {
      id: row.actorId,
      name: row.displayName,
      handle: row.handle,
      imageUrl: row.avatarUrl,
    },
    kind: row.kind,
    body: row.body,
    reaction: row.reaction,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function createStoryInteraction(input: {
  storyId: string
  actorId: string
  kind: StoryInteractionKind
  body?: string | null
  reaction?: string | null
}) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      status: stories.status,
    })
    .from(stories)
    .where(eq(stories.id, input.storyId))
    .limit(1)

  if (!story) {
    throw new Error("That story is no longer available.")
  }

  if (story.status === "removed") {
    throw new Error("That story is no longer available.")
  }

  if (story.creatorId === input.actorId) {
    throw new Error("You cannot reply to your own story.")
  }

  const body = input.body?.trim() || null
  const reaction = input.reaction?.trim() || null

  if ((input.kind === "reply" || input.kind === "comment") && !body) {
    throw new Error("Enter a message before sending.")
  }

  if (input.kind === "reaction" && !reaction) {
    throw new Error("Choose a reaction before sending.")
  }

  const [event] = await db
    .insert(storyInteractions)
    .values({
      id: `story-interaction-${randomUUID()}`,
      storyId: story.id,
      creatorId: story.creatorId,
      actorId: input.actorId,
      kind: input.kind,
      body,
      reaction,
    })
    .returning()

  return event
}

export async function listStoryInteractionsForCreator(input: {
  creatorId: string
  kinds?: StoryInteractionKind[]
  limit?: number
}): Promise<StoryInteractionEvent[]> {
  const db = getDb()
  const kinds = input.kinds?.length ? input.kinds : undefined
  const filters = [
    eq(storyInteractions.creatorId, input.creatorId),
    kinds ? inArray(storyInteractions.kind, kinds) : undefined,
  ].filter(Boolean)

  const rows = await db
    .select({
      id: storyInteractions.id,
      storyId: storyInteractions.storyId,
      creatorId: storyInteractions.creatorId,
      actorId: storyInteractions.actorId,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
      kind: storyInteractions.kind,
      body: storyInteractions.body,
      reaction: storyInteractions.reaction,
      createdAt: storyInteractions.createdAt,
    })
    .from(storyInteractions)
    .innerJoin(users, eq(users.id, storyInteractions.actorId))
    .where(and(...filters))
    .orderBy(desc(storyInteractions.createdAt))
    .limit(input.limit ?? 50)

  return rows.flatMap((row) => {
    const event = mapEvent(row)

    return event ? [event] : []
  })
}
