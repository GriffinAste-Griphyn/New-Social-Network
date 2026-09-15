import { after } from "next/server"

import { isWorkflowDispatchEnabled } from "@/lib/media-pipeline/features"

// Database outbox rows and leases remain the source of truth. A Workflow
// transport outage must not turn an already accepted upload into a dead end.
export async function dispatchMediaTask<T>(input: {
  label: string
  identity: string
  startDurable: () => Promise<T>
  runDirect: () => Promise<unknown>
  startQueue?: () => Promise<boolean>
}): Promise<T | null> {
  if (input.startQueue) {
    try {
      if (await input.startQueue()) return null
    } catch (error) {
      console.error("media_queue_dispatch_fallback", {
        task: input.label, identity: input.identity, error,
      })
    }
  }
  if (isWorkflowDispatchEnabled()) {
    try {
      return await input.startDurable()
    } catch (error) {
      console.error("media_workflow_dispatch_fallback", {
        task: input.label,
        identity: input.identity,
        error: error instanceof Error ? error.message : "Workflow dispatch failed",
      })
    }
  }
  after(async () => {
    try {
      await input.runDirect()
    } catch (error) {
      console.error("media_direct_task_failed", { task: input.label, identity: input.identity, error })
    }
  })
  return null
}
