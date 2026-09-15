# Media upload release — 1.0.12 (428)

## Changes

- Batch preparation and transfer overlap. Each prepared item is persisted before its transfer starts; video exports and large-file transfers remain serial. Draft fields are captured once for the batch, the ten-item limit is enforced, and failures remain independent.
- Completion callbacks wait until batch staging finishes. Root's callback switches tabs, so delivering it early could cancel preparation of remaining stories. Queued registrations flush once, in transfer order, after the pending-batch callback.
- Submitted video authorization overlaps local fast-start verification. Transfer still requires successful verification, and every attempt obtains fresh authorization for its existing client upload identity. Selection preparation continues to run locally.
- A verified client poster eliminates the redundant Cloudflare default-thumbnail configuration request. Legacy uploads retain the provider-thumbnail fallback. Ownership, checksum, provider status, moderation, and completion-claim checks remain required.
- Independent profile/element-validation work and post-insert audit/mention/element writes run concurrently. Completion awaits all required writes before dispatching publication.
- Vercel Queues dispatch existing durable image/video jobs through separate first-playable and enhancement topics. Worker leases reserve two initial-video slots, two image slots, and one enhancement slot. Token-fenced release and expiry recover ownership; capacity waits do not claim jobs or spend their error retry budget.
- Initial custom HLS work yields after its first playable publication. Remaining quality variants continue in the enhancement lane. Planned budget/priority yields preserve the error retry budget. Reconciliation selects initial work before enhancement, and database claims prevent duplicate encoding.
- Queue/Workflow dispatch failures retain the existing direct worker and durable database reconciliation paths. Consumers continue draining accepted messages independently of the producer flag.
- The authenticated operations cron checks production queue delivery with completed-job replays, throttled to prevent duplicate readiness traffic. Queue wait, processing time, retry reasons, and readiness dispatch results are logged.
- iOS `video_upload_encoding` and `video_upload_chunk` events are registered in both the API and PostgreSQL enum. A cross-platform telemetry contract test guards against future registration drift.

## Verification

- Backend: **313 tests across 71 files passed**; TypeScript, affected-file lint, and migration checks passed.
- iOS: **40 upload tests passed**, including overlap/order, deferred registration, failure continuation, durable recovery, quality guards, private upload contracts, and exact sequential TUS source ranges.
- Signed Release archive: `/tmp/ubeye-testflight-428/UBEYE-final.xcarchive`; version **1.0.12**, build **428**, bundle `com.griffinaste.ubeye`. Strict signature verification passed. All 45 frozen iOS source/config files match the archive inputs.
- Additive migrations **0059** and **0060** applied to production and registered with their SHA-256 hashes. Production lease checks verified exclusion of a second owner and rejection of an incorrect release token.
- Next production validation caught the Queue SDK's broad callback argument type. Explicit `POST(request: Request)` wrappers resolve it; a compile-time route contract now protects all consumers.

## Delivery

- Production **READY**: `dpl_9wKufDbMfx21FGcey46WZ39QLPSR`, aliased to `www.ubeye.ai`, `ubeye.ai`, and `new-social-network-nine.vercel.app`. App, video, and image health return **200 / ok:true**. Admin and authenticated API checks retain their expected **307/401** responses; all Queue consumer URLs return **404** to public requests.
- Queue producer flag: `MEDIA_PRIORITY_QUEUES_ENABLED=true`; media config version `2026-09-13.8`.
- Production cron verification **2026-09-14 01:24 UTC**: all three completed-job replays accepted, processed, and acknowledged with HTTP **200**, zero failed/skipped lanes, released worker slots, and no error/fatal logs. Replayed jobs remain ready with unchanged attempt counts and timestamps. Developer-token probes were excluded from this verification because their OIDC environment is development.
- TestFlight **1.0.12 (428) uploaded successfully**. App Store Connect accepted the package at **2026-09-14 01:25:21 UTC** and reported that it is processing. Tester availability awaits Apple processing. Upload log: `/tmp/ubeye-testflight-428-upload.log`.

## Measurement limits

Encoding quality settings and source preservation remain unchanged. Completed-job replays verify routing and ownership recovery, not real-upload throughput. Wi-Fi/cellular batch timing, device memory/energy, and burst-load measurements are still needed before increasing transfer or worker concurrency. No percentage improvement is claimed.
