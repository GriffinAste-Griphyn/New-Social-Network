import { createHook } from "workflow"

import { moderatePendingStory } from "@/lib/story-moderation-core"

async function moderatePendingStoryStep(storyId: string) {
  "use step"
  return moderatePendingStory(storyId)
}

moderatePendingStoryStep.maxRetries = 5

export async function moderateStoryWorkflow(storyId: string) {
  "use workflow"

  using claim = createHook({ token: `story-moderation:${storyId}` })
  const conflict = await claim.getConflict()
  if (conflict) {
    return { status: "deduplicated" as const, runId: conflict.runId }
  }

  return moderatePendingStoryStep(storyId)
}
