import { reconcileMediaProcessingJobs } from "@/lib/media-pipeline/jobs"

export async function mediaProcessingReconcilerWorkflow() {
  "use workflow"

  return reconcileMediaProcessingJobsStep()
}

async function reconcileMediaProcessingJobsStep() {
  "use step"

  return reconcileMediaProcessingJobs({ limit: 25 })
}

