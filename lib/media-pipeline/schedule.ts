import { start } from "workflow/api"
import { dispatchMediaTask } from "@/lib/media-dispatch"

import { isWorkflowDispatchEnabled } from "@/lib/media-pipeline/features"
import { processMediaWorkflow } from "@/workflows/media-processing"
import { isMediaJobPlayable, processMediaJobRun } from "./direct-processing"
import { areMediaPriorityQueuesEnabled, sendMediaQueueJob } from "@/lib/media-priority-queue"

type MediaProcessingDispatch = {
  jobId: string
  source: string
  attempt?: number
}

export async function dispatchMediaProcessing(
  payload: MediaProcessingDispatch,
) {
  if (!isWorkflowDispatchEnabled()) {
    return processMediaJobRun(payload.jobId)
  }

  const run = await start(processMediaWorkflow, [payload.jobId])
  return { runId: run.runId, jobId: payload.jobId }
}

export async function scheduleMediaProcessing(jobId: string, source: string) {
  const result = await dispatchMediaTask({
    label: source,
    identity: jobId,
    startQueue: async () => {
      if (!areMediaPriorityQueuesEnabled()) return false
      await sendMediaQueueJob(await isMediaJobPlayable(jobId) ? "videoEnhancement" : "videoInitial", jobId)
      return true
    },
    startDurable: () => dispatchMediaProcessing({ jobId, source }),
    runDirect: () => processMediaJobRun(jobId),
  })
  if (!result) return { jobId, runId: null }
  console.info("media_processing_workflow_started", {
    jobId,
    source,
    runId: "runId" in result ? result.runId : null,
  })
  return result
}

export async function processQueuedMediaJob(jobId: string, firstPlayable: boolean) {
  const result = await processMediaJobRun(jobId, { stopAfterPlayable: firstPlayable })
  if (result.status === "yielded") {
    // Failure to send propagates to Queue retry; the pending outbox row also
    // remains discoverable by reconciliation if delivery expires.
    await sendMediaQueueJob(await isMediaJobPlayable(jobId) ? "videoEnhancement" : "videoInitial", jobId)
  }
  return result
}

export async function scheduleMediaProcessingSlice(
  payload: MediaProcessingDispatch,
) {
  return scheduleMediaProcessing(payload.jobId, payload.source)
}
