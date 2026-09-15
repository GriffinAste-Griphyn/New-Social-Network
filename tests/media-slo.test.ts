import { describe, expect, it } from "vitest"
import { evaluateMediaSlos, mediaRate, type MediaPipelineHealth, type MediaQoeSegment } from "@/lib/media-slo"

const healthy: MediaPipelineHealth = { processing: 0, staleProcessing: 0, oldestProcessingMs: null, exhaustedVideoJobs: 0, exhaustedImageJobs: 0, failedPublications: 0, pendingModeration: 0, publishP95Ms: null }
const segment: MediaQoeSegment = { build: "422", network: "standard", device: "modern", delivery: "cloudflare-stream", profile: "adaptive-canary", sessions: 100, stalledSessions: 0, failedSessions: 0, firstFrames: 20, firstFrameP50Ms: 300, firstFrameP95Ms: 950, uploadsSucceeded: 100, uploadsFailed: 0, downloadedBytes: 0, watchedMs: 0 }

describe("media SLO evaluation", () => {
  it("requires two independent windows for startup and keeps cohorts separate", () => {
    expect(evaluateMediaSlos([segment], healthy)).toEqual([])
    expect(evaluateMediaSlos([segment], healthy, [{ ...segment, profile: "quality-first" }])).toEqual([])
    expect(evaluateMediaSlos([segment], healthy, [segment]).map(alert => alert.key)).toEqual([expect.stringMatching(/^startup:/)])
  })
  it("suppresses sparse cohorts and distinguishes unavailable rates from zero", () => {
    expect(mediaRate(0, 0)).toBeNull()
    expect(mediaRate(0, 100)).toBe(0)
    expect(evaluateMediaSlos([{ ...segment, sessions: 1, firstFrames: 1, stalledSessions: 1, failedSessions: 1 }], healthy, [segment])).toEqual([])
  })
  it("alerts on terminal failures, stalls, and exhausted durable jobs", () => {
    const alerts = evaluateMediaSlos([{ ...segment, failedSessions: 1, stalledSessions: 2 }], { ...healthy, exhaustedImageJobs: 1 })
    expect(alerts.map(alert => alert.key)).toEqual([expect.stringMatching(/^playback:/), expect.stringMatching(/^rebuffer:/), "exhausted_jobs"])
  })
})
