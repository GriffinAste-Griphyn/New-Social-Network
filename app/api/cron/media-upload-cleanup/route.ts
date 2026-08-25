import { del } from "@vercel/blob"

import {
  deleteMediaUploadSessionForCleanup,
  getMediaUploadSessionsForCleanup,
  type MediaUploadSessionCleanupCandidate,
} from "@/lib/media-upload-sessions"
import {
  getExpiredStoryMediaForCleanup,
  markExpiredStoryMediaDeleted,
  removeExpiredStoryMediaFromStorage,
  type ExpiredStoryMediaCleanupCandidate,
} from "@/lib/expired-story-media"
import {
  removeCloudflareStreamVideoByUid,
  removeDirectBlobStoryVideoPoster,
} from "@/lib/story-storage"

export const runtime = "nodejs"
export const maxDuration = 60

const cleanupConcurrency = 5
const expiredMediaCleanupLimit = 50

async function cleanupCandidate(candidate: MediaUploadSessionCleanupCandidate) {
  const isAbandonedProviderUpload =
    candidate.status !== "completed" &&
    candidate.storageProvider === "cloudflare-stream"

  if (isAbandonedProviderUpload) {
    await Promise.all([
      removeCloudflareStreamVideoByUid(candidate.storageKey),
      removeDirectBlobStoryVideoPoster(candidate.storageKey),
    ])
  }

  if (
    candidate.status !== "completed" &&
    candidate.storageProvider === "vercel-blob" &&
    candidate.storageKey.startsWith("media-originals/")
  ) {
    await Promise.all([
      del(candidate.storageKey),
      removeDirectBlobStoryVideoPoster(candidate.storageKey),
    ])
  }

  return deleteMediaUploadSessionForCleanup(candidate)
}

async function cleanupExpiredMediaCandidate(
  candidate: ExpiredStoryMediaCleanupCandidate,
) {
  await removeExpiredStoryMediaFromStorage(candidate)
  return markExpiredStoryMediaDeleted(candidate)
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      {
        status: 401,
        headers: { "Cache-Control": "private, no-store" },
      },
    )
  }

  const candidates = await getMediaUploadSessionsForCleanup({ limit: 100 })
  let deleted = 0
  let failed = 0
  let skipped = 0

  for (let index = 0; index < candidates.length; index += cleanupConcurrency) {
    const batch = candidates.slice(index, index + cleanupConcurrency)
    const results = await Promise.allSettled(batch.map(cleanupCandidate))

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        deleted += 1
      } else if (result.status === "fulfilled") {
        skipped += 1
      } else if (result.status === "rejected") {
        failed += 1
        console.error("[media-upload-cleanup] candidate failed", result.reason)
      }
    }
  }

  const expiredMediaCandidates = await getExpiredStoryMediaForCleanup({
    limit: expiredMediaCleanupLimit,
  })
  let expiredMediaDeleted = 0
  let expiredMediaFailed = 0
  let expiredMediaSkipped = 0
  let expiredMediaBytesReclaimed = 0
  let expiredVideoDurationMsReclaimed = 0

  for (
    let index = 0;
    index < expiredMediaCandidates.length;
    index += cleanupConcurrency
  ) {
    const batch = expiredMediaCandidates.slice(
      index,
      index + cleanupConcurrency,
    )
    const results = await Promise.allSettled(
      batch.map(cleanupExpiredMediaCandidate),
    )

    for (const [resultIndex, result] of results.entries()) {
      if (result.status === "fulfilled" && result.value) {
        const candidate = batch[resultIndex]
        expiredMediaDeleted += 1
        expiredMediaBytesReclaimed +=
          candidate.byteSize + (candidate.originalByteSize ?? 0)
        expiredVideoDurationMsReclaimed += candidate.durationMs ?? 0
      } else if (result.status === "fulfilled") {
        expiredMediaSkipped += 1
      } else {
        expiredMediaFailed += 1
        console.error(
          "[expired-story-media-cleanup] candidate failed",
          result.reason,
        )
      }
    }
  }

  const totalFailed = failed + expiredMediaFailed

  return Response.json(
    {
      ok: totalFailed === 0,
      scanned: candidates.length,
      deleted,
      skipped,
      failed,
      expiredMedia: {
        scanned: expiredMediaCandidates.length,
        deleted: expiredMediaDeleted,
        skipped: expiredMediaSkipped,
        failed: expiredMediaFailed,
        bytesReclaimed: expiredMediaBytesReclaimed,
        videoMinutesReclaimed: Number(
          (expiredVideoDurationMsReclaimed / 60_000).toFixed(2),
        ),
      },
    },
    {
      status: totalFailed === 0 ? 200 : 500,
      headers: { "Cache-Control": "private, no-store" },
    },
  )
}
