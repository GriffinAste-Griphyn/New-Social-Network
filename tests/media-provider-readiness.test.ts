import { describe, expect, it } from "vitest"
import { providerReadinessObservations } from "@/lib/media-provider-readiness"
import { cloudflareReadinessPollDelay } from "@/lib/story-readiness-polling"

describe("provider readiness observations", () => {
  const initial = new Date("2026-09-14T03:00:00Z")
  const later = new Date(initial.getTime() + 10_000)
  it("separates first playable from full quality and preserves observations on stale events", () => {
    expect(providerReadinessObservations({ previous: null, playable: false, fullQuality: false, now: initial })).toEqual({})
    const playable = providerReadinessObservations({ previous: null, playable: true, fullQuality: false, now: initial })
    expect(playable).toEqual({ firstPlayableObservedAt: initial.toISOString() })
    const ready = providerReadinessObservations({ previous: playable, playable: true, fullQuality: true, now: later })
    expect(ready).toEqual({ firstPlayableObservedAt: initial.toISOString(), fullQualityObservedAt: later.toISOString() })
    expect(providerReadinessObservations({ previous: ready, playable: false, fullQuality: false, now: later })).toEqual(ready)
  })
  it("does not invent an earlier transition when the first observation is fully ready", () => {
    expect(providerReadinessObservations({ previous: {}, playable: true, fullQuality: true, now: initial }))
      .toEqual({ firstPlayableObservedAt: initial.toISOString(), fullQualityObservedAt: initial.toISOString() })
  })
  it("discards malformed and future observation timestamps", () => {
    expect(providerReadinessObservations({ previous: { firstPlayableObservedAt: "invalid", fullQualityObservedAt: later.toISOString() },
      playable: false, fullQuality: false, now: initial })).toEqual({})
  })
  it("backs off after the short-clip window and handles missing timestamps conservatively", () => {
    expect(cloudflareReadinessPollDelay({ createdAt: initial, now: later })).toBe(750)
    expect(cloudflareReadinessPollDelay({ createdAt: initial, now: new Date(initial.getTime() + 20_000) })).toBe(1_500)
    expect(cloudflareReadinessPollDelay({ createdAt: initial, now: new Date(initial.getTime() + 60_000) })).toBe(3_000)
    expect(cloudflareReadinessPollDelay({ now: initial })).toBe(3_000)
    expect(cloudflareReadinessPollDelay({ createdAt: later, now: initial })).toBe(3_000)
  })
})
