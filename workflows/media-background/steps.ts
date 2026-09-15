import type { BackgroundMediaKind } from "@/lib/media-background-dispatch"

export async function runBackgroundMediaStep(id: string, kind: BackgroundMediaKind) {
  "use step"
  // Resolve the processor inside the step, not while loading the dispatcher.
  const { runBackgroundMediaJob } = await import("@/lib/media-background-jobs")
  await runBackgroundMediaJob(id, kind)
}
