import { createHook } from "workflow"

import {
  completeMediaProcessingStep,
  encodeMediaRenditionStep,
  failMediaProcessingStep,
  generateMediaPosterStep,
  inspectMediaSourceStep,
  publishMasterPlaylistStep,
} from "./steps"

export async function processMediaWorkflow(jobId: string, attempt: number) {
  "use workflow"

  using processingClaim = createHook({
    token: `media-processing:${jobId}`,
  })
  const conflict = await processingClaim.getConflict()
  if (conflict) {
    return {
      status: "deduplicated" as const,
      runId: conflict.runId,
      attempt,
    }
  }

  try {
    const inspection = await inspectMediaSourceStep(jobId)
    const [renditions, poster] = await Promise.all([
      Promise.all(
        inspection.profiles.map((profile) =>
          encodeMediaRenditionStep(jobId, profile, inspection.source),
        ),
      ),
      generateMediaPosterStep(jobId),
    ])
    const master = await publishMasterPlaylistStep(jobId, renditions)
    await completeMediaProcessingStep(jobId, inspection.source, master, poster)
    return {
      status: "completed" as const,
      masterUrl: master.url,
      attempt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failMediaProcessingStep(jobId, message)
    throw error
  }
}
