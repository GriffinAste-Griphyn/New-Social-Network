import { NextResponse } from "next/server"

import { getCompleteMobileSession } from "@/lib/auth"
import { enqueueMediaProcessing } from "@/lib/media-pipeline/jobs"
import { scheduleMediaProcessing } from "@/lib/media-pipeline/schedule"
import { userFacingModerationReason } from "@/lib/safety/user-facing"
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

  const { mediaAssetId, storageProvider, ...publicStoryStatus } = storyStatus
  if (
    storageProvider === "vercel-blob" &&
    (publicStoryStatus.processingStatus !== "ready" ||
      !publicStoryStatus.fullQualityReady)
  ) {
    await enqueueMediaProcessing(mediaAssetId)
      .then((dispatch) => {
        if (dispatch.dispatchRecommended) {
          scheduleMediaProcessing(dispatch.jobId, "story_status_poll")
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
