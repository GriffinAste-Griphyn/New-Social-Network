import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { enqueueMediaProcessing } from "@/lib/media-pipeline/jobs"
import { recoverImageProcessingForAsset } from "@/lib/image-processing-jobs"
import { scheduleMediaProcessing } from "@/lib/media-pipeline/schedule"
import { userFacingModerationReason } from "@/lib/safety/user-facing"
import { enqueueStoryModeration } from "@/lib/story-moderation"
import { getStoryUploadStatusForOwner } from "@/lib/story-store"

export const runtime = "nodejs"
export const maxDuration = 300
const noStoreHeaders = { "Cache-Control": "private, no-store" }

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    )
  }

  const { id } = await context.params
  const storyStatus = await getStoryUploadStatusForOwner(id, session.id)

  if (!storyStatus) {
    return NextResponse.json(
      { error: "Story not found." },
      { status: 404, headers: noStoreHeaders },
    )
  }

  const { mediaAssetId, storageProvider, assetKind, ...publicStoryStatus } =
    storyStatus
  if (
    assetKind === "video" &&
    storageProvider === "vercel-blob" &&
    (publicStoryStatus.processingStatus !== "ready" ||
      !publicStoryStatus.fullQualityReady)
  ) {
    await enqueueMediaProcessing(mediaAssetId)
      .then(async (dispatch) => {
        if (dispatch.dispatchRecommended) {
          await scheduleMediaProcessing(dispatch.jobId, "story_status_poll")
        }
      })
      .catch((error) => {
        console.error("media_processing_status_recovery_failed", {
          storyId: id,
          mediaAssetId,
          error,
        })
      })
  }
  if (
    assetKind === "image" &&
    publicStoryStatus.providerStatus?.startsWith("queued:") &&
    publicStoryStatus.processingStatus !== "ready"
  ) {
    await recoverImageProcessingForAsset(mediaAssetId).catch((error) => {
      console.error("image_processing_status_recovery_failed", {
        storyId: id,
        mediaAssetId,
        error,
      })
    })
  }
  if (publicStoryStatus.moderationStatus === "pending") {
    await enqueueStoryModeration(id).catch((error) => {
      console.error("story_moderation_status_recovery_failed", {
        storyId: id,
        error,
      })
    })
  }

  return NextResponse.json(
    {
      ok: true,
      story: {
        ...publicStoryStatus,
        pollAfterMs:
          publicStoryStatus.processingStatus === "ready"
            ? null
            : publicStoryStatus.providerStatus === "queued"
              ? 1_500
              : 3_000,
        moderationReason: userFacingModerationReason({
          moderationStatus: publicStoryStatus.moderationStatus,
          moderationReason: publicStoryStatus.moderationReason,
        }),
      },
    },
    { headers: noStoreHeaders },
  )
}
