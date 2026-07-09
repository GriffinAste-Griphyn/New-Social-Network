import { randomUUID } from "node:crypto"

import { and, eq, gt, isNull, lte, or } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { mediaUploadSessions, stories } from "@/lib/db/schema"

export type CloudflareStreamProviderDetails = {
  readyToStream: boolean
  state: string | null
  pctComplete: number | null
  errorReason: string | null
  byteSize: number | null
  durationMs: number | null
  width: number | null
  height: number | null
}

export class MediaUploadSessionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = "MediaUploadSessionError"
  }
}

const uploadSessionLifetimeMs = 24 * 60 * 60 * 1_000
const completionClaimRecoveryMs = 15 * 60 * 1_000

type MediaUploadSession = typeof mediaUploadSessions.$inferSelect

function matchesExpectedUpload(
  session: MediaUploadSession,
  input: {
    expectedContentType?: string | null
    expectedByteSize?: number | null
    maxDurationSeconds?: number | null
  },
) {
  return (
    (session.expectedContentType ?? null) ===
      (input.expectedContentType ?? null) &&
    (session.expectedByteSize ?? null) === (input.expectedByteSize ?? null) &&
    (session.maxDurationSeconds ?? null) ===
      (input.maxDurationSeconds ?? null)
  )
}

export function isCloudflareStreamFullyReady(
  details: Pick<
    CloudflareStreamProviderDetails,
    "readyToStream" | "state" | "pctComplete"
  >,
) {
  return (
    details.readyToStream &&
    ((details.pctComplete ?? 0) >= 100 ||
      (details.pctComplete === null && details.state === "ready"))
  )
}

export async function getReusableMediaUploadSession(input: {
  ownerUserId: string
  clientUploadId?: string | null
  storageProvider: "cloudflare-stream"
  expectedContentType?: string | null
  expectedByteSize?: number | null
  maxDurationSeconds?: number | null
}) {
  if (!input.clientUploadId) {
    return null
  }

  const [session] = await getDb()
    .select()
    .from(mediaUploadSessions)
    .where(
      and(
        eq(mediaUploadSessions.ownerUserId, input.ownerUserId),
        eq(mediaUploadSessions.clientUploadId, input.clientUploadId),
        eq(mediaUploadSessions.storageProvider, input.storageProvider),
        eq(mediaUploadSessions.status, "prepared"),
        gt(mediaUploadSessions.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (!session) {
    return null
  }

  if (!matchesExpectedUpload(session, input)) {
    throw new MediaUploadSessionError(
      "The upload retry does not match the originally prepared file.",
      409,
    )
  }

  return session
}

export async function createMediaUploadSession(input: {
  ownerUserId: string
  clientUploadId?: string | null
  purpose?: "story" | "story_reply"
  assetKind: "video"
  storageProvider: "cloudflare-stream"
  storageKey: string
  uploadUrl: string
  uploadProtocol: string
  expectedContentType?: string | null
  expectedByteSize?: number | null
  maxDurationSeconds?: number | null
}) {
  const now = new Date()
  const session = {
    id: `upload-${randomUUID()}`,
    ownerUserId: input.ownerUserId,
    clientUploadId: input.clientUploadId ?? null,
    purpose: input.purpose ?? ("story" as const),
    assetKind: input.assetKind,
    storageProvider: input.storageProvider,
    storageKey: input.storageKey,
    uploadUrl: input.uploadUrl,
    uploadProtocol: input.uploadProtocol,
    expectedContentType: input.expectedContentType ?? null,
    expectedByteSize: input.expectedByteSize ?? null,
    maxDurationSeconds: input.maxDurationSeconds ?? null,
    status: "prepared",
    expiresAt: new Date(now.getTime() + uploadSessionLifetimeMs),
    createdAt: now,
    updatedAt: now,
  }

  const [created] = await getDb()
    .insert(mediaUploadSessions)
    .values(session)
    .onConflictDoNothing()
    .returning()

  if (created) {
    return created
  }

  const reusable = await getReusableMediaUploadSession(input)

  if (reusable) {
    return reusable
  }

  throw new MediaUploadSessionError(
    "Could not reserve this provider upload. Prepare a new upload.",
    409,
  )
}

export async function retireMediaUploadSession(input: {
  ownerUserId: string
  clientUploadId: string
  uploadSessionId: string
}) {
  const db = getDb()
  const retired = await db
    .delete(mediaUploadSessions)
    .where(
      and(
        eq(mediaUploadSessions.id, input.uploadSessionId),
        eq(mediaUploadSessions.ownerUserId, input.ownerUserId),
        eq(mediaUploadSessions.clientUploadId, input.clientUploadId),
        eq(mediaUploadSessions.status, "prepared"),
      ),
    )
    .returning({ storageKey: mediaUploadSessions.storageKey })

  if (retired.length === 0) {
    const [existing] = await db
      .select({
        ownerUserId: mediaUploadSessions.ownerUserId,
        clientUploadId: mediaUploadSessions.clientUploadId,
        status: mediaUploadSessions.status,
      })
      .from(mediaUploadSessions)
      .where(eq(mediaUploadSessions.id, input.uploadSessionId))
      .limit(1)

    if (!existing) {
      return null
    }

    if (
      existing.ownerUserId !== input.ownerUserId ||
      existing.clientUploadId !== input.clientUploadId
    ) {
      throw new MediaUploadSessionError(
        "The upload session belongs to a different owner or client upload.",
        403,
      )
    }

    throw new MediaUploadSessionError(
      existing.status === "completed"
        ? "A completed upload session cannot be replaced."
        : "The upload session is currently being completed.",
      409,
    )
  }

  return retired[0]
}

export async function claimMediaUploadSessionForCompletion(input: {
  ownerUserId: string
  uploadSessionId?: string | null
  storageProvider: "cloudflare-stream"
  storageKey: string
  contentType: string
  byteSize: number
}) {
  const db = getDb()
  const [session] = await db
    .select()
    .from(mediaUploadSessions)
    .where(
      and(
        eq(mediaUploadSessions.storageProvider, input.storageProvider),
        eq(mediaUploadSessions.storageKey, input.storageKey),
      ),
    )
    .limit(1)

  if (!session) {
    throw new MediaUploadSessionError(
      "This video was not prepared by the upload service.",
      400,
    )
  }

  if (
    session.ownerUserId !== input.ownerUserId ||
    (input.uploadSessionId && session.id !== input.uploadSessionId)
  ) {
    throw new MediaUploadSessionError(
      "This video upload belongs to a different session.",
      403,
    )
  }

  if (session.completedStoryId || session.status === "completed") {
    if (!session.completedStoryId) {
      throw new MediaUploadSessionError(
        "The completed upload is missing its story reference.",
        409,
      )
    }

    return { state: "completed" as const, session }
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw new MediaUploadSessionError(
      "This video upload session expired. Prepare a new upload.",
      410,
    )
  }

  if (
    session.expectedContentType &&
    session.expectedContentType.toLowerCase() !== input.contentType.toLowerCase()
  ) {
    throw new MediaUploadSessionError(
      "The completed video type does not match the prepared upload.",
      400,
    )
  }

  if (
    session.expectedByteSize &&
    session.expectedByteSize !== input.byteSize
  ) {
    throw new MediaUploadSessionError(
      "The completed video size does not match the prepared upload.",
      400,
    )
  }

  const [claimed] = await db
    .update(mediaUploadSessions)
    .set({
      status: "completing",
      completionClaimedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mediaUploadSessions.id, session.id),
        or(
          eq(mediaUploadSessions.status, "prepared"),
          and(
            eq(mediaUploadSessions.status, "completing"),
            or(
              isNull(mediaUploadSessions.completionClaimedAt),
              lte(
                mediaUploadSessions.completionClaimedAt,
                new Date(Date.now() - completionClaimRecoveryMs),
              ),
            ),
          ),
        ),
      ),
    )
    .returning()

  if (claimed) {
    return { state: "claimed" as const, session: claimed }
  }

  const [latest] = await db
    .select()
    .from(mediaUploadSessions)
    .where(eq(mediaUploadSessions.id, session.id))
    .limit(1)

  if (latest?.completedStoryId) {
    return { state: "completed" as const, session: latest }
  }

  throw new MediaUploadSessionError(
    "This upload is already being completed. Retry shortly.",
    409,
  )
}

export async function markMediaUploadSessionCompleted(input: {
  uploadSessionId: string
  ownerUserId: string
  storyId: string
}) {
  const db = getDb()
  const [story] = await db
    .select({ mediaAssetId: stories.mediaAssetId })
    .from(stories)
    .where(eq(stories.id, input.storyId))
    .limit(1)

  if (!story) {
    throw new MediaUploadSessionError(
      "Could not find the story created for this upload session.",
      409,
    )
  }

  const now = new Date()

  const [completed] = await db
    .update(mediaUploadSessions)
    .set({
      status: "completed",
      completedMediaAssetId: story.mediaAssetId,
      completedStoryId: input.storyId,
      completionClaimedAt: null,
      consumedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaUploadSessions.id, input.uploadSessionId),
        eq(mediaUploadSessions.ownerUserId, input.ownerUserId),
      ),
    )
    .returning({ id: mediaUploadSessions.id })

  if (!completed) {
    throw new MediaUploadSessionError(
      "Could not finalize the upload session.",
      409,
    )
  }
}

export async function releaseMediaUploadSessionCompletion(input: {
  uploadSessionId: string
  ownerUserId: string
}) {
  await getDb()
    .update(mediaUploadSessions)
    .set({
      status: "prepared",
      completionClaimedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mediaUploadSessions.id, input.uploadSessionId),
        eq(mediaUploadSessions.ownerUserId, input.ownerUserId),
        eq(mediaUploadSessions.status, "completing"),
      ),
    )
}

export async function recordCloudflareStreamUploadStatus(input: {
  uid: string
  details: CloudflareStreamProviderDetails
}) {
  const db = getDb()
  const [existing] = await db
    .select()
    .from(mediaUploadSessions)
    .where(
      and(
        eq(mediaUploadSessions.storageProvider, "cloudflare-stream"),
        eq(mediaUploadSessions.storageKey, input.uid),
      ),
    )
    .limit(1)

  if (!existing) {
    return null
  }

  const previous = cloudflareDetailsFromUploadSession(existing)
  const providerPctComplete = Math.max(
    existing.providerPctComplete ?? 0,
    previous?.pctComplete ?? 0,
    input.details.pctComplete ?? 0,
  )
  const details: CloudflareStreamProviderDetails = {
    readyToStream:
      input.details.readyToStream || previous?.readyToStream === true,
    state: input.details.state ?? previous?.state ?? null,
    pctComplete:
      providerPctComplete > 0 || input.details.pctComplete !== null
        ? providerPctComplete
        : null,
    errorReason: input.details.errorReason,
    byteSize: input.details.byteSize ?? previous?.byteSize ?? null,
    durationMs: input.details.durationMs ?? previous?.durationMs ?? null,
    width: input.details.width ?? previous?.width ?? null,
    height: input.details.height ?? previous?.height ?? null,
  }
  const now = new Date()
  const [session] = await db
    .update(mediaUploadSessions)
    .set({
      providerStatus: details.state,
      providerPctComplete: details.pctComplete,
      providerError: details.errorReason,
      providerPayload: details,
      providerEventAt: now,
      updatedAt: now,
    })
    .where(eq(mediaUploadSessions.id, existing.id))
    .returning()

  return session ?? null
}

export function cloudflareDetailsFromUploadSession(
  session: MediaUploadSession,
): CloudflareStreamProviderDetails | null {
  const payload = session.providerPayload

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }

  const details = payload as Partial<CloudflareStreamProviderDetails>

  return {
    readyToStream: details.readyToStream === true,
    state: typeof details.state === "string" ? details.state : null,
    pctComplete:
      typeof details.pctComplete === "number" ? details.pctComplete : null,
    errorReason:
      typeof details.errorReason === "string" ? details.errorReason : null,
    byteSize: typeof details.byteSize === "number" ? details.byteSize : null,
    durationMs:
      typeof details.durationMs === "number" ? details.durationMs : null,
    width: typeof details.width === "number" ? details.width : null,
    height: typeof details.height === "number" ? details.height : null,
  }
}
