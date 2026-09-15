export type MediaQoeSegment = {
  build: string
  network: string
  device: string
  delivery: string
  profile: string
  deviceModel?: string
  startupState?: string
  hd720Reached?: number
  hd720P95Ms?: number | null
  hdSamples?: number
  hdReached?: number
  hdP50Ms?: number | null
  hdP95Ms?: number | null
  sessions: number
  stalledSessions: number
  failedSessions: number
  firstFrames: number
  firstFrameP50Ms: number | null
  firstFrameP95Ms: number | null
  uploadsSucceeded: number
  uploadsFailed: number
  downloadedBytes: number
  watchedMs: number
}

export type MediaUploadCohort = {
  build: string; network: string; model: string; experiment: string; size: string
  succeeded: number; failed: number; samples: number
  p50Ms: number | null; p95Ms: number | null; mbpsP50: number | null
}

export type MediaPipelineHealth = {
  deliveryObservations?: import("./media-delivery-observations").MediaDeliveryObservation[]
  failedBackgroundJobs?: number
  staleBackgroundJobs?: number
  processing: number
  staleProcessing: number
  oldestProcessingMs: number | null
  exhaustedVideoJobs: number
  exhaustedImageJobs: number
  failedPublications: number
  pendingModeration: number
  publishP95Ms: number | null
  frameCadence?: { build: string; network: string; model: string; surface: string; mode: string; samples: number; frames: number; hitches: number; hitchMs: number; elapsedMs: number; maxGapMs: number }[]
  uploadCohorts?: MediaUploadCohort[]
  uploadPhases?: { kind: string; phase: string; build?: string; network?: string; model?: string; size?: string; samples: number; p50Ms: number | null; p95Ms: number | null }[]
}

export type MediaSloAlert = { key: string; message: string; severity: "warning" | "critical" }

export function mediaSegmentKey(segment: MediaQoeSegment) {
  return JSON.stringify([segment.build, segment.network, segment.device, segment.delivery, segment.profile, segment.deviceModel ?? "unknown", segment.startupState ?? "unknown"])
}

export function mediaRate(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round(numerator / denominator * 10_000) / 100 : null
}

export function evaluateMediaSlos(
  segments: MediaQoeSegment[],
  pipeline: MediaPipelineHealth,
  previousSegments: MediaQoeSegment[] = [],
): MediaSloAlert[] {
  const alerts: MediaSloAlert[] = []
  const previous = new Map(previousSegments.map(segment => [mediaSegmentKey(segment), segment]))
  for (const segment of segments) {
    const key = mediaSegmentKey(segment)
    const label = `Build ${segment.build}, ${segment.network}, ${segment.device}, ${segment.delivery}, ${segment.profile}`
    const prior = previous.get(key)
    // Minimum samples and an independent preceding window keep tiny cohorts and
    // overlapping five-minute scans from creating misleading regressions.
    if (segment.firstFrames >= 20 && (segment.firstFrameP95Ms ?? 0) > 900 &&
        prior && prior.firstFrames >= 20 && (prior.firstFrameP95Ms ?? 0) > 900) {
      alerts.push({ key: `startup:${key}`, message: `${label}: first-frame p95 exceeded 900 ms in two windows.`, severity: "warning" })
    }
    if (segment.sessions >= 100 && (mediaRate(segment.failedSessions, segment.sessions) ?? 0) > 0.5) {
      alerts.push({ key: `playback:${key}`, message: `${label}: playback failure rate exceeded 0.5%.`, severity: "critical" })
    }
    if (segment.network === "standard" && segment.sessions >= 100 &&
        (mediaRate(segment.stalledSessions, segment.sessions) ?? 0) > 1) {
      alerts.push({ key: `rebuffer:${key}`, message: `${label}: rebuffer session rate exceeded 1%.`, severity: "warning" })
    }
    const uploads = segment.uploadsSucceeded + segment.uploadsFailed
    if (uploads >= 100 && (mediaRate(segment.uploadsFailed, uploads) ?? 0) > 1) {
      alerts.push({ key: `upload:${key}`, message: `${label}: upload failure rate exceeded 1%.`, severity: "critical" })
    }
  }
  if (pipeline.staleProcessing > 0) alerts.push({ key: "processing_age", message: `${pipeline.staleProcessing} active posts have been processing for over 10 minutes.`, severity: "warning" })
  if (pipeline.exhaustedVideoJobs + pipeline.exhaustedImageJobs > 0) alerts.push({ key: "exhausted_jobs", message: `${pipeline.exhaustedVideoJobs + pipeline.exhaustedImageJobs} active media jobs exhausted their retries.`, severity: "critical" })
  if (pipeline.failedPublications > 0) alerts.push({ key: "publication_failure", message: `${pipeline.failedPublications} active posts have failed publication jobs.`, severity: "critical" })
  if ((pipeline.failedBackgroundJobs ?? 0) > 0) alerts.push({ key: "background_failure", message: `${pipeline.failedBackgroundJobs} background delivery jobs exhausted retries.`, severity: "warning" })
  if ((pipeline.staleBackgroundJobs ?? 0) > 0) alerts.push({ key: "background_age", message: `${pipeline.staleBackgroundJobs} background delivery jobs are older than 10 minutes.`, severity: "warning" })
  return alerts
}
