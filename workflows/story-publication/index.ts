import { createHook } from "workflow"

import {
  completeStoryPublicationStep,
  failStoryPublicationStep,
  fanoutStoryPublicationStep,
  invalidateStoryPublicationSnapshotsStep,
  notifyStoryPublicationStep,
  processStoryPublicationEarningsStep,
  validateStoryPublicationStep,
} from "./steps"

export async function publishStoryWorkflow(storyId: string) {
  "use workflow"

  using publicationClaim = createHook({
    token: `story-publication:${storyId}`,
  })
  const conflict = await publicationClaim.getConflict()

  if (conflict) {
    return { status: "deduplicated" as const, runId: conflict.runId }
  }

  const publication = await validateStoryPublicationStep(storyId)

  if (!publication) {
    return { status: "skipped" as const }
  }

  try {
    await Promise.all([
      processStoryPublicationEarningsStep(storyId),
      fanoutStoryPublicationStep(storyId),
      notifyStoryPublicationStep(storyId),
      invalidateStoryPublicationSnapshotsStep(storyId),
    ])
    await completeStoryPublicationStep(storyId)

    return { status: "completed" as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failStoryPublicationStep(storyId, message)
    throw error
  }
}
