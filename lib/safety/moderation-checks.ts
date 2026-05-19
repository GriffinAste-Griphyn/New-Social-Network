import { randomUUID } from "node:crypto"

import { desc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { moderationChecks } from "@/lib/db/schema"
import type {
  ContentModerationAction,
  ContentModerationResult,
} from "@/lib/safety/policy"

export type ModerationCheckTargetKind =
  | "story"
  | "interaction"
  | "avatar"
  | "user_profile"

export type ModerationCheckRecord = {
  id: string
  targetKind: ModerationCheckTargetKind
  targetId: string
  provider: string
  action: ContentModerationAction
  reason: string | null
  categories: string
  error: string | null
  createdAt: Date
}

function serializeModerationValue(value: unknown) {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return null
  }
}

export async function recordModerationCheck(input: {
  targetKind: ModerationCheckTargetKind
  targetId: string
  actorUserId?: string | null
  mediaAssetId?: string | null
  result: ContentModerationResult
}) {
  await getDb().insert(moderationChecks).values({
    id: `moderation-check-${randomUUID()}`,
    targetKind: input.targetKind,
    targetId: input.targetId,
    actorUserId: input.actorUserId ?? null,
    mediaAssetId: input.mediaAssetId ?? null,
    provider: input.result.provider,
    action: input.result.action,
    reason: input.result.reason,
    categories: serializeModerationValue(input.result.categories) ?? "[]",
    rawResult: serializeModerationValue(input.result.rawResult),
    error: input.result.error ?? null,
  })
}

export async function listLatestModerationChecksForTargets(input: {
  targetKind: ModerationCheckTargetKind
  targetIds: string[]
}) {
  if (input.targetIds.length === 0) {
    return new Map<string, ModerationCheckRecord>()
  }

  const rows = await getDb()
    .select({
      id: moderationChecks.id,
      targetKind: moderationChecks.targetKind,
      targetId: moderationChecks.targetId,
      provider: moderationChecks.provider,
      action: moderationChecks.action,
      reason: moderationChecks.reason,
      categories: moderationChecks.categories,
      error: moderationChecks.error,
      createdAt: moderationChecks.createdAt,
    })
    .from(moderationChecks)
    .where(
      inArray(moderationChecks.targetId, input.targetIds),
    )
    .orderBy(desc(moderationChecks.createdAt))

  const latestByTarget = new Map<string, ModerationCheckRecord>()

  rows.forEach((row) => {
    if (row.targetKind !== input.targetKind || latestByTarget.has(row.targetId)) {
      return
    }

    latestByTarget.set(row.targetId, row)
  })

  return latestByTarget
}

export async function listModerationChecksForTarget(input: {
  targetKind: ModerationCheckTargetKind
  targetId: string
}) {
  return getDb()
    .select()
    .from(moderationChecks)
    .where(eq(moderationChecks.targetId, input.targetId))
    .orderBy(desc(moderationChecks.createdAt))
}
