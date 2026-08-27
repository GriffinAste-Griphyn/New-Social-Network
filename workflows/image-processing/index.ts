import { createHook, getWorkflowMetadata } from "workflow"

import {
  claimImageProcessingStep,
  completeImageProcessingStep,
  failImageProcessingStep,
  processImageAssetStep,
} from "./steps"

export async function processImageWorkflow(jobId: string) {
  "use workflow"

  using processingClaim = createHook({ token: `image-processing:${jobId}` })
  const conflict = await processingClaim.getConflict()
  if (conflict) {
    return { status: "deduplicated" as const, runId: conflict.runId }
  }

  const { workflowRunId } = getWorkflowMetadata()
  const claimed = await claimImageProcessingStep(jobId, workflowRunId)
  if (!claimed) return { status: "deduplicated" as const }

  try {
    const output = await processImageAssetStep(jobId)
    return completeImageProcessingStep(jobId, output)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failImageProcessingStep(jobId, message)
    throw error
  }
}
