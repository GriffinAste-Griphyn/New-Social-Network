type Observations = {
  firstPlayableObservedAt?: string
  fullQualityObservedAt?: string
}

function retainedTimestamp(value: unknown, now: Date): string | undefined {
  if (typeof value !== "string") return undefined
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.getTime()) && timestamp <= now
    ? timestamp.toISOString() : undefined
}

/** Observation time is an upper bound, not the provider's exact transition time. */
export function providerReadinessObservations(input: {
  previous: unknown
  playable: boolean
  fullQuality: boolean
  now: Date
}): Observations {
  const previous = input.previous && typeof input.previous === "object"
    ? input.previous as Record<string, unknown> : {}
  const firstPlayableObservedAt = retainedTimestamp(previous.firstPlayableObservedAt, input.now)
  const fullQualityObservedAt = retainedTimestamp(previous.fullQualityObservedAt, input.now)
  return {
    ...(firstPlayableObservedAt || input.playable || input.fullQuality
      ? { firstPlayableObservedAt: firstPlayableObservedAt ?? fullQualityObservedAt ?? input.now.toISOString() } : {}),
    ...(fullQualityObservedAt || input.fullQuality
      ? { fullQualityObservedAt: fullQualityObservedAt ?? input.now.toISOString() } : {}),
  }
}
