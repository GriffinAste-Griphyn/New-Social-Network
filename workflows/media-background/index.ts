import { runBackgroundMediaStep } from "./steps"
import type { BackgroundMediaKind } from "@/lib/media-background-dispatch"

export async function processMediaBackgroundWorkflow(id: string, kind: BackgroundMediaKind) {
  "use workflow"
  return runBackgroundMediaStep(id, kind)
}
