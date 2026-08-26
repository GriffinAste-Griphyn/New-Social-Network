import { after } from "next/server"

import { processMediaJobRun } from "./direct-processing"

type MediaProcessingDispatch = {
  jobId: string
  source: string
  attempt?: number
}

export async function dispatchMediaProcessing(
  payload: MediaProcessingDispatch,
) {
  return processMediaJobRun(payload.jobId)
}

export function scheduleMediaProcessing(jobId: string, source: string) {
  after(async () => {
    try {
      const result = await dispatchMediaProcessing({ jobId, source })
      console.info("media_processing_run_finished", { jobId, source, result })
    } catch (error) {
      console.error("media_processing_dispatch_failed", {
        jobId,
        source,
        error,
      })
    }
  })
}

export function scheduleMediaProcessingSlice(
  payload: MediaProcessingDispatch,
) {
  after(async () => {
    try {
      const result = await processMediaJobRun(payload.jobId)
      console.info("media_processing_run_finished", {
        jobId: payload.jobId,
        source: payload.source,
        result,
      })
    } catch (error) {
      console.error("media_processing_run_failed", {
        jobId: payload.jobId,
        source: payload.source,
        error,
      })
    }
  })
}
