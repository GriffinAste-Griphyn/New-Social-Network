# Media upload release 431

## Changes

- Fresh Cloudflare TUS sessions carry a server hint only when the newly allocated session won the idempotent reservation. Reused/concurrent reservations do not carry it. iOS consumes it once to omit the first HEAD; retries and resumes still query the actual offset. A bounded process-local hint set prevents reuse of a stale response from restarting at zero.
- Fresh measured upload histories seed the first chunk with the same eight-second work target as the ongoing adaptive controller, retaining provider alignment, configured limits and conservative unknown-path defaults.
- Initial offset, per-chunk file staging and background-task first-body-send timings are recorded separately. These identify protocol and scheduling costs without treating progress callbacks or resumed offsets as sent bytes. Chunk phase byte cohorts describe chunk size, while total upload phases describe source size.
- An optional, presentation-local **Upload while editing** toggle starts private transfers after a selected video has finished local preparation. It defaults off and displays **Private until you post · Wi-Fi only**. Media requests disallow cellular, expensive and constrained connections, including subsequent background PATCHes and Blob multipart parts. Live recording segmentation is not introduced.
- Speculative video transfers share the existing single global video transfer permit. Completed private originals, checksums and multipart receipts can be adopted into the atomic pending-upload manifest. Adoption preserves the final Post caption/overlays and source ownership. Post revalidates the lease; reuse requires the same session and an unchanged file fingerprint. Expired/replaced leases fall back to normal transfer and all server validation remains required.
- Deselection, toggle-off and composer dismissal cancel speculative work. Cleanup is scoped to the same account and API origin. Server cancellation expires only prepared, owner/client-bound story video sessions. Provider deletion failures retain an expired row for the existing cleanup cron. Completion rechecks expiration in the atomic claim to fence cancellation races. Crashes recover remote drafts through the existing 24-hour expiry cleanup.
- Draft story reservations use the durable Post timestamp rather than time spent recording/editing. The server bounds it between lease creation and server time; old clients retain existing reservation behavior, and completion remains idempotent.
- Approved, live, unexpired publication sends a best-effort silent readiness hint to the creator's enabled APNs devices. This uses background push type/priority, no alert or sound. A client hint wakes the active readiness wait and rechecks authenticated status; it cannot publish media itself. Polling remains the fallback for missing/throttled pushes. Readiness hint failures do not block or duplicate follower notifications. APNs requests have bounded timeouts.
- Existing 1080p capture bitrates and HEVC preference remain intact. A 4K configuration gets its appropriate larger pixel budget, avoiding starvation by the 1080p bitrate. Existing passthrough/remux and visual quality gates remain intact.

## Evidence and conditional decisions

Read-only production queue inspection found no queued/running non-ready video or image work; it found three existing video jobs marked error. Worker capacity remains two initial-video, two initial-image and one enhancement slot. More workers would not improve phone transfer bandwidth.

The paired iPhone is unavailable. No physical-device before/after upload speed or camera-encoder quality comparison is claimed. Lower capture bitrates and a separate foreground transport remain conditional on device evidence; arbitrary quality reductions or unverified transport handoff changes were not introduced. The editing upload option provides early private transfer without requiring a new segmented ingestion architecture. No hosting migration, database migration or environment/key changes are required.

For a device comparison, use the same clips, phone and network on builds 430/431. Compare matched source-size cohorts for tap-to-first-bytes, local preparation, transfer, completion and accepted-to-ready; inspect p50/p95 and failures/retries. Distinguish initial-offset/staging/background scheduling from network bandwidth. Check motion, fine detail, skin tones, dark scenes, audio and HDR independently of upload speed. Silent push arrival is not guaranteed or equivalent to viewer first frame.

## Validation

- 78 focused simulator tests passed with zero failures/skips, including existing TUS/background continuation, Blob multipart recovery, source durability, visual quality, sequential batch progress and six new fast-path/draft/readiness regressions.
- All six fast-path regressions passed again after the final account/API-origin cleanup guard change.
- 320 backend tests passed across 73 files; cancellation fencing, fresh/reused/concurrent reservations, provider-cleanup failure recovery, timestamp bounds and silent APNs payloads are covered.
- TypeScript, targeted ESLint and `git diff --check` passed. Next route types were generated using the local development environment label without loading production credentials.
- An initial compile caught actor isolation in deinit cleanup, and test compilation caught mismatched fixture field types. Both were corrected before passing tests. A later build hit disk exhaustion; 38 rebuildable simulator test-product copies were removed, preserving result bundles, logs and release archives, and the follow-up passed.

## Delivery

Build: **1.0.12 (431)**. Source freeze: `/tmp/ubeye-431-source-freeze.json` (58 app/resource/configuration inputs).

Broad simulator result: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T02-58-39-952Z_pid70024_e84f53d9.xcresult`.
Final fast-path result: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T03-00-59-799Z_pid70024_3d74c162.xcresult`.

Production deployment **dpl_CMxCMwLa4vbFXLBPmvJ4hDQ7SKtA** is READY, targets production, and is aliased to `www.ubeye.ai`, `ubeye.ai` and `new-social-network-nine.vercel.app`. Deployment URL: `new-social-network-buhhmkifq-griffin-astes-projects.vercel.app`.

General, video and image health probes returned HTTP 200 with `ok: true`. Admin media remains protected (307), mobile media configuration and the new unauthenticated draft DELETE remain protected (401), and public queue routes return 404. Deployment-scoped error/fatal log checks found no entries before or after the probes. Health evidence: `/tmp/ubeye-431-production-health.json`; deployment log: `/tmp/ubeye-431-deploy.log`.

The signed **1.0.12 (431)** archive passed strict code-signature verification and version checks. All 58 frozen app/configuration inputs remained unchanged after archive and upload. Archive: `/tmp/ubeye-testflight-431/UBEYE.xcarchive`; archive log: `/tmp/ubeye-testflight-431-archive.log`.

App Store Connect accepted the upload at **2026-09-14 03:04:41 UTC**, reporting **Uploaded package is processing**, **Upload succeeded**, and **EXPORT SUCCEEDED**. Upload log: `/tmp/ubeye-testflight-431-upload.log`. Tester availability depends on Apple completing processing; availability has not been separately confirmed.
