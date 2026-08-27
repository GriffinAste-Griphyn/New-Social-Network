import { after } from "next/server"
import { start } from "workflow/api"

import { areDurableMediaWorkersEnabled } from "@/lib/media-pipeline/features"
import { processMediaWorkflow } from "@/workflows/media-processing"
import { processMediaJobRun } from "./direct-processing"

type MediaProcessingDispatch = {
  jobId: string
  source: string
  attempt?: number
}

export async function dispatchMediaProcessing(
  payload: MediaProcessingDispatch,
) {
  if (!areDurableMediaWorkersEnabled()) {
    return processMediaJobRun(payload.jobId)
  }

  const run = await start(processMediaWorkflow, [payload.jobId])
  return { runId: run.runId, jobId: payload.jobId }
}

export async function scheduleMediaProcessing(jobId: string, source: string) {
  if (!areDurableMediaWorkersEnabled()) {
    after(async () => {
      try {
        const result = await dispatchMediaProcessing({ jobId, source })
        console.info("media_processing_direct_finished", {
          jobId,
          source,
          result,
        })
      } catch (error) {
        console.error("media_processing_direct_failed", {
          jobId,
          source,
          error,
        })
      }
    })
    return { jobId, runId: null }
  }

  const result = await dispatchMediaProcessing({ jobId, source })
  console.info("media_processing_workflow_started", {
    jobId,
    source,
    runId: "runId" in result ? result.runId : null,
  })
  return result
}

export async function scheduleMediaProcessingSlice(
  payload: MediaProcessingDispatch,
) {
  return scheduleMediaProcessing(payload.jobId, payload.source)
}
