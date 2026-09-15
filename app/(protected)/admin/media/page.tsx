import Link from "next/link"

import { requireAdminSession } from "@/lib/admin-store"
import { getLatestMediaOperations, getMediaEventVolume, isMediaMonitoringStale } from "@/lib/media-operations-monitor"
import { mediaRate, mediaSegmentKey } from "@/lib/media-slo"

export const dynamic = "force-dynamic"

function milliseconds(value: number | null) {
  return value == null ? "—" : `${Math.round(value).toLocaleString()} ms`
}

function rate(numerator: number, denominator: number) {
  const value = mediaRate(numerator, denominator)
  return value == null ? "—" : `${value}%`
}

export default async function MediaOperationsPage() {
  await requireAdminSession()
  const [snapshot, eventVolume] = await Promise.all([getLatestMediaOperations(), getMediaEventVolume()])
  const stale = snapshot && isMediaMonitoringStale(snapshot.collectedAt)
  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-8 text-[#111827] sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><h1 className="text-2xl font-medium">Media performance</h1><p className="mt-2 text-sm text-gray-600">{eventVolume.toLocaleString()} mobile events received in the past 24 hours.</p></div>
          <Link className="rounded-lg border bg-white px-4 py-2 text-sm" href="/admin">Back to admin</Link>
        </header>
        {!snapshot ? <p className="rounded-lg border bg-white p-6">Waiting for the first scheduled media snapshot.</p> : <>
          <p className={`text-sm ${stale ? "text-red-700" : "text-gray-600"}`}>{stale ? "Monitoring is overdue. " : ""}Window: {snapshot.windowStart.toISOString()} to {snapshot.windowEnd.toISOString()}. Refresh this page for the latest five-minute snapshot.</p>
          <section className="grid gap-4 sm:grid-cols-3">
            {[
              ["Processing", snapshot.pipeline.processing],
              ["Processing over 10 minutes", snapshot.pipeline.staleProcessing],
              ["Pending moderation", snapshot.pipeline.pendingModeration],
              ["Exhausted media jobs", snapshot.pipeline.exhaustedVideoJobs + snapshot.pipeline.exhaustedImageJobs],
              ["Failed publication jobs", snapshot.pipeline.failedPublications],
              ["Failed background jobs", snapshot.pipeline.failedBackgroundJobs ?? 0],
              ["Delayed background jobs", snapshot.pipeline.staleBackgroundJobs ?? 0],
              ["Publish p95", milliseconds(snapshot.pipeline.publishP95Ms)],
            ].map(([label, value]) => <article key={label} className="rounded-lg border bg-white p-4"><p className="text-sm text-gray-600">{label}</p><p className="mt-2 text-2xl font-medium">{value}</p></article>)}
          </section>
          <section className="rounded-lg border bg-white p-5"><h2 className="font-medium">Current alerts</h2>{snapshot.alerts.length ? <ul className="mt-3 space-y-2">{snapshot.alerts.map(alert => <li key={alert.key} className={alert.severity === "critical" ? "text-red-700" : "text-amber-700"}>{alert.message}</li>)}</ul> : <p className="mt-3 text-sm text-gray-600">No thresholds breached. Sparse cohorts do not trigger playback alerts.</p>}</section>
          <section className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <caption className="p-4 text-left text-gray-600">Cross-device delivery observations from the last 24 hours. Matched to the uploader and a different viewer installation. Receipt intervals include viewer wait time and telemetry batching; they are not processing latency. Local durations use each device’s own clock.</caption>
              <thead className="bg-gray-50"><tr>{["Story", "Uploader / viewer build", "Upload network", "Post to accepted", "Accepted to ready", "Viewer open to frame", "Receipt interval", "Feed observed"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{(snapshot.pipeline.deliveryObservations ?? []).map(row => <tr key={row.storyId} className="border-t">
                <td className="px-4 py-3">{row.storyId}</td><td className="px-4 py-3">{row.build} / {row.viewerBuild}</td><td className="px-4 py-3">{row.network}</td><td className="px-4 py-3">{milliseconds(row.tapToAcceptedMs)}</td><td className="px-4 py-3">{milliseconds(row.acceptedToReadyMs)}</td><td className="px-4 py-3">{milliseconds(row.viewerOpenToFrameMs)}</td><td className="px-4 py-3">{milliseconds(row.receiptToViewerMs)}</td><td className="px-4 py-3">{row.feedObserved ? "Yes" : "Not sampled"}</td>
              </tr>)}</tbody>
            </table>
          </section>
          <section className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <caption className="p-4 text-left text-gray-600">Playback and upload outcomes, grouped by build, network, device, delivery, and startup experiment. HD timing is measured from the playback request; interrupted, short, or lower-resolution videos may never reach HD. Quality and data use cover sampled sessions only.</caption>
              <thead className="bg-gray-50"><tr>{["Build", "Network", "Device / model", "Delivery", "Experiment", "Start", "Sessions", "First-frame p50 / p95", "720p p95", "1080p p50 / p95", "Reached 1080p", "Stalled", "Failed", "Upload failures", "Sampled MB"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{snapshot.segments.map(segment => <tr key={mediaSegmentKey(segment)} className="border-t">
                <td className="px-4 py-3">{segment.build}</td><td className="px-4 py-3">{segment.network}</td><td className="px-4 py-3">{segment.device} / {segment.deviceModel ?? "unknown"}</td><td className="px-4 py-3">{segment.delivery}</td><td className="px-4 py-3">{segment.profile}</td><td className="px-4 py-3">{segment.startupState ?? "unknown"}</td><td className="px-4 py-3">{segment.sessions}</td><td className="px-4 py-3">{milliseconds(segment.firstFrameP50Ms)} / {milliseconds(segment.firstFrameP95Ms)} ({segment.firstFrames} samples)</td><td className="px-4 py-3">{milliseconds(segment.hd720P95Ms ?? null)} ({segment.hd720Reached ?? 0} sampled)</td><td className="px-4 py-3">{milliseconds(segment.hdP50Ms ?? null)} / {milliseconds(segment.hdP95Ms ?? null)}</td><td className="px-4 py-3">{rate(segment.hdReached ?? 0, segment.hdSamples ?? 0)} ({segment.hdSamples ?? 0} sampled)</td><td className="px-4 py-3">{rate(segment.stalledSessions, segment.sessions)}</td><td className="px-4 py-3">{rate(segment.failedSessions, segment.sessions)}</td><td className="px-4 py-3">{rate(segment.uploadsFailed, segment.uploadsFailed + segment.uploadsSucceeded)}</td><td className="px-4 py-3">{(segment.downloadedBytes / 1_000_000).toFixed(1)}</td>
              </tr>)}</tbody>
            </table>
          </section>
          <section className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <caption className="p-4 text-left text-gray-600">Upload stages by build, connection, device and file size. First bytes means the first iOS body-send notification. Ready means server-confirmed readiness; playback on another device requires a separate test. Phases still in flight are excluded.</caption>
              <thead className="bg-gray-50"><tr>{["Media", "Phase", "Build", "Network", "Model", "File size", "Samples", "p50", "p95"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{(snapshot.pipeline.uploadPhases ?? []).map(phase => <tr key={JSON.stringify([phase.kind, phase.phase, phase.build, phase.network, phase.model, phase.size])} className="border-t"><td className="px-4 py-3">{phase.kind}</td><td className="px-4 py-3">{phase.phase}</td><td className="px-4 py-3">{phase.build ?? "unknown"}</td><td className="px-4 py-3">{phase.network ?? "unknown"}</td><td className="px-4 py-3">{phase.model ?? "unknown"}</td><td className="px-4 py-3">{phase.size ?? "unknown"}</td><td className="px-4 py-3">{phase.samples}</td><td className="px-4 py-3">{milliseconds(phase.p50Ms)}</td><td className="px-4 py-3">{milliseconds(phase.p95Ms)}</td></tr>)}</tbody>
            </table>
          </section>
          <section className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <caption className="p-4 text-left text-gray-600">Upload rollout comparison. Compare the same build, network, device and file-size range. Fewer than 20 completed uploads is preliminary; overlapping snapshots are not independent samples. Effective Mbps excludes attempts with retries. Resident memory, thermal state and Low Power Mode are retained in raw events; battery drain requires a device energy profile.</caption>
              <thead className="bg-gray-50"><tr>{["Build", "Network", "Model", "Upload experiment", "File size", "Completed / failed", "Total p50 / p95", "Effective Mbps", "Evidence"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{(snapshot.pipeline.uploadCohorts ?? []).map(cohort => <tr key={JSON.stringify([cohort.build, cohort.network, cohort.model, cohort.experiment, cohort.size])} className="border-t">
                <td className="px-4 py-3">{cohort.build}</td><td className="px-4 py-3">{cohort.network}</td><td className="px-4 py-3">{cohort.model}</td><td className="px-4 py-3">{cohort.experiment}</td><td className="px-4 py-3">{cohort.size}</td><td className="px-4 py-3">{cohort.succeeded} / {cohort.failed}</td><td className="px-4 py-3">{milliseconds(cohort.p50Ms)} / {milliseconds(cohort.p95Ms)}</td><td className="px-4 py-3">{cohort.mbpsP50?.toFixed(2) ?? "—"}</td><td className="px-4 py-3">{cohort.samples < 20 ? `Preliminary (${cohort.samples})` : `${cohort.samples} completed samples`}</td>
              </tr>)}</tbody>
            </table>
          </section>

          <section className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <caption className="p-4 text-left text-gray-600">Interaction callback cadence, grouped by build, network, device, surface and resource mode. This measures main-thread callback delays, not GPU frame delivery. Windows exclude background suspension and refresh-rate changes; fewer than 20 summaries is preliminary.</caption>
              <thead className="bg-gray-50"><tr>{["Build", "Network", "Model", "Surface / mode", "Summaries", "Callbacks", "Delayed callbacks", "Delay time", "Largest gap"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{(snapshot.pipeline.frameCadence ?? []).map(row => <tr key={JSON.stringify([row.build, row.network, row.model, row.surface, row.mode])} className="border-t">
                <td className="px-4 py-3">{row.build}</td><td className="px-4 py-3">{row.network}</td><td className="px-4 py-3">{row.model}</td><td className="px-4 py-3">{row.surface} / {row.mode}</td><td className="px-4 py-3">{row.samples < 20 ? `Preliminary (${row.samples})` : row.samples}</td><td className="px-4 py-3">{row.frames.toLocaleString()}</td><td className="px-4 py-3">{rate(row.hitches, row.frames)}</td><td className="px-4 py-3">{rate(row.hitchMs, row.elapsedMs)}</td><td className="px-4 py-3">{milliseconds(row.maxGapMs)}</td>
              </tr>)}</tbody>
            </table>
          </section>
        </>}
      </div>
    </main>
  )
}
