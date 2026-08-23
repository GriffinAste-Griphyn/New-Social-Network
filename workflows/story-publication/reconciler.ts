import { sleep } from "workflow"

import { reconcileStoryPublications } from "@/lib/story-publication"
import { refreshProcessingCloudflareStories } from "@/lib/stories/cloudflare-status"

const reconciliationInterval = "1m"
const reconciliationsPerDay = 24 * 60

async function reconcileStoryPublicationStep() {
  "use step"

  await refreshProcessingCloudflareStories({ limit: 50 })
  return reconcileStoryPublications({ limit: 100 })
}

export async function storyPublicationReconcilerWorkflow() {
  "use workflow"

  for (let iteration = 0; iteration < reconciliationsPerDay; iteration += 1) {
    await reconcileStoryPublicationStep()

    if (iteration < reconciliationsPerDay - 1) {
      await sleep(reconciliationInterval)
    }
  }

  return { status: "completed" as const }
}
