import { createHook, getWorkflowMetadata } from "workflow"

import {
  activatePlayableMediaProcessingStep,
  claimMediaProcessingWorkflowStep,
  completeMediaProcessingStep,
  encodeInitialMediaStep,
  encodeMediaRenditionBatchStep,
  failMediaProcessingStep,
  inspectMediaSourceStep,
  publishMasterPlaylistStep,
} from "./steps"

export async function processMediaWorkflow(jobId: string) {
  "use workflow"

  using processingClaim = createHook({
    token: `media-processing:${jobId}`,
  })
  const conflict = await processingClaim.getConflict()
  if (conflict) {
    return {
      status: "deduplicated" as const,
      runId: conflict.runId,
    }
  }

  const { workflowRunId } = getWorkflowMetadata()
  const claimed = await claimMediaProcessingWorkflowStep(jobId, workflowRunId)
  if (!claimed) {
    return {
      status: "deduplicated" as const,
    }
  }

  try {
    const inspection = await inspectMediaSourceStep(jobId)
    const firstProfile =
      inspection.profiles.find((profile) => profile.label === "540p") ??
      inspection.profiles[0]
    const initial = await encodeInitialMediaStep(
      jobId,
      firstProfile,
      inspection.source,
    )
    const firstRendition = initial.rendition
    const poster = initial.poster
    const initialMaster = await publishMasterPlaylistStep(jobId, [firstRendition])
    const remainingProfiles = inspection.profiles.filter(
      (profile) => profile.label !== firstProfile.label,
    )
    if (remainingProfiles.length === 0) {
      await completeMediaProcessingStep(
        jobId,
        inspection.source,
        initialMaster,
        poster,
      )
      return {
        status: "completed" as const,
        masterUrl: initialMaster.url,
        attempt: claimed.attempt,
      }
    }

    await activatePlayableMediaProcessingStep(
      jobId,
      inspection.source,
      initialMaster,
      poster,
      [firstProfile],
      35,
    )
    const remainingRenditions = await encodeMediaRenditionBatchStep(
      jobId,
      remainingProfiles,
      inspection.source,
    )
    const finalMaster = await publishMasterPlaylistStep(jobId, [
      firstRendition,
      ...remainingRenditions,
    ])
    await completeMediaProcessingStep(
      jobId,
      inspection.source,
      finalMaster,
      poster,
    )
    return {
      status: "completed" as const,
      masterUrl: finalMaster.url,
      attempt: claimed.attempt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failMediaProcessingStep(jobId, message)
    throw error
  }
}
