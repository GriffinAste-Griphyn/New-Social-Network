import { randomUUID } from "node:crypto"

import { and, eq, gt } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { storyVideoUploads } from "@/lib/db/schema"

export type StoryVideoUploadSurface = "web" | "mobile"
export type StoryVideoUploadProtocol = "tus" | "form"

const storyVideoUploadTtlMs = 30 * 60 * 1000

export type ClaimedStoryVideoUpload = {
  id: string
  ownerUserId: string
  uid: string
  maxSizeBytes: number
  maxDurationSeconds: number
}

export async function registerStoryVideoUpload(input: {
  ownerUserId: string
  uid: string
  surface: StoryVideoUploadSurface
  uploadProtocol: StoryVideoUploadProtocol
  maxSizeBytes: number
  maxDurationSeconds: number
}) {
  const now = new Date()
  const [upload] = await getDb()
    .insert(storyVideoUploads)
    .values({
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      uid: input.uid,
      surface: input.surface,
      uploadProtocol: input.uploadProtocol,
      maxSizeBytes: input.maxSizeBytes,
      maxDurationSeconds: input.maxDurationSeconds,
      status: "pending",
      expiresAt: new Date(now.getTime() + storyVideoUploadTtlMs),
      createdAt: now,
      updatedAt: now,
    })
    .returning({
      id: storyVideoUploads.id,
      uid: storyVideoUploads.uid,
    })

  return upload
}

export async function claimStoryVideoUpload(input: {
  ownerUserId: string
  uid: string
  surface: StoryVideoUploadSurface
}): Promise<ClaimedStoryVideoUpload | null> {
  const now = new Date()
  const [upload] = await getDb()
    .update(storyVideoUploads)
    .set({
      status: "completing",
      claimedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(storyVideoUploads.ownerUserId, input.ownerUserId),
        eq(storyVideoUploads.uid, input.uid),
        eq(storyVideoUploads.surface, input.surface),
        eq(storyVideoUploads.status, "pending"),
        gt(storyVideoUploads.expiresAt, now),
      ),
    )
    .returning({
      id: storyVideoUploads.id,
      ownerUserId: storyVideoUploads.ownerUserId,
      uid: storyVideoUploads.uid,
      maxSizeBytes: storyVideoUploads.maxSizeBytes,
      maxDurationSeconds: storyVideoUploads.maxDurationSeconds,
    })

  return upload ?? null
}

export async function completeStoryVideoUpload(input: {
  id: string
  storyId: string
}) {
  const now = new Date()

  await getDb()
    .update(storyVideoUploads)
    .set({
      status: "completed",
      storyId: input.storyId,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(storyVideoUploads.id, input.id))
}

export async function releaseStoryVideoUploadClaim(uploadId: string) {
  const now = new Date()

  await getDb()
    .update(storyVideoUploads)
    .set({
      status: "pending",
      claimedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(storyVideoUploads.id, uploadId),
        eq(storyVideoUploads.status, "completing"),
      ),
    )
}

export async function failStoryVideoUpload(uploadId: string) {
  const now = new Date()

  await getDb()
    .update(storyVideoUploads)
    .set({
      status: "failed",
      failedAt: now,
      updatedAt: now,
    })
    .where(eq(storyVideoUploads.id, uploadId))
}
