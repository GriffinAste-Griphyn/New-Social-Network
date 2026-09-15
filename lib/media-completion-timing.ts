export type CompletionPhaseObserver = (phase: string, durationMs: number) => void

/** Observability must never change completion, moderation, or retry behavior. */
export async function timeMediaCompletion<T>(
  phase: string,
  work: () => Promise<T>,
  observe?: CompletionPhaseObserver,
): Promise<T> {
  const started = performance.now()
  try {
    return await work()
  } finally {
    try { observe?.(phase, Math.max(0, Math.round(performance.now() - started))) }
    catch { /* A trace sink failure cannot reject a valid upload. */ }
  }
}
