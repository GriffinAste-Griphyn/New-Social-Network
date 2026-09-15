# Media upload release 432

## Measured baseline

The latest build-431 upload was a 5,328,071-byte short video. Client transfer telemetry measured 7,573 ms. The production completion trace measured 4,526 ms total, including 3,613 ms awaiting synchronous moderation, 199 ms reading provider status, and 203 ms building the response. Server readiness was recorded approximately 12 seconds after completion acknowledgement; reservation-to-recorded-readiness was 24,887 ms. These measurements overlap and are not additive. Server readiness is not a measurement of playback on a second device.

Our own media queues had no pending/running work. The upload used direct Cloudflare Stream TUS, so increasing Vercel encoding worker capacity would not address its network transfer or provider transcode wait.

## Changes

- Cloudflare completion now uses the same build-gated asynchronous moderation policy as Vercel HLS completion. The existing rollback flag and legacy clients retain synchronous behavior. Receipt acknowledgement remains dependent on authentication, owner-bound upload claims, verified poster inputs, durable story writes and completion-session persistence. Viewer publication still requires approval and structural/playback readiness.
- Completion response reads retain the owner boundary but omit the immediate second provider refresh. Authenticated status polls and provider callbacks remain responsible for reconciliation. The duplicated full-quality status expression was consolidated, and readiness reconciliation no longer repeatedly configures an already-present thumbnail.
- An already-encoded private draft still reconciles publication after Post. A completion response cannot report posted solely because its media is ready; status/cron recovery includes processing stories with ready assets. Readiness for unpublished Cloudflare stories comes from provider observations rather than legacy optimistic asset defaults, while the existing live-story rollback protection remains intact.
- Adaptive TUS chunks may absorb a final tail of at most 512 KiB when the remaining short clip is at most 8 MiB and fits the existing provider/network maximum. Fixed-size operation, constrained caps and reduced retry behavior are preserved. A failure explicitly disables tail merging until a valid chunk succeeds. The representative 5.3 MB source now uses one PATCH in the protocol fixture instead of a full chunk plus a tiny final request.
- The composer option is named **Start upload early**. It remains opt-in, with the existing private/unmetered network protections. Its explicit preference survives dismissal and can be revoked; presentation dismissal cancels private transfers without overwriting the saved choice. Preparing the next selected clip no longer awaits the preceding private transfer. The existing global video transfer and preparation permits remain in force. Private checksum generation overlaps transfer.
- The telemetry reporter can wake an existing scheduled delay when completion requests an immediate flush. It never cancels an in-flight network request or bypasses minimum request spacing/retry backoff. This fixes delayed completion diagnostics, not evidence that the previous UI was broken.
- URLSession transaction metrics record connection, DNS, TLS, request-transmission and response-wait phases, without recording source URLs, tokens or media contents. These intervals may overlap and are not summed into a claimed speedup.
- Provider payloads record first observed playable readiness separately from first observed full-quality readiness. These are observation timestamps, not exact provider transition timestamps. Conditional writes re-read and merge concurrent callbacks/polls instead of overwriting newer progress, terminal errors or first-readiness observations. They require no schema migration and preserve diagnostic separation from the publication gate.
- Short Cloudflare clips poll at 750 ms during the first 20 seconds, then 1,500 ms until one minute, then 3,000 ms. Silent-push hints remain an authenticated recheck trigger; they are not proof of approval/publication. Internal processing timestamps are removed from the status response.
- Asynchronous moderation uses a per-story database lease in the existing media worker lease table, preventing completion, status recovery and cron from reviewing the same story concurrently. Acquisition, result writes and release are fenced by token and expiration. Completed leases are removed; cron reaps expired crash leftovers. Publication uses current database playback/scan state rather than a snapshot from before moderation, and concurrent deletion cannot be reversed by a late review.

## Quality and scope

The full-quality publication gate, original media, capture bitrates, HDR/audio handling, resumability and sequential counter semantics are preserved. No new service, extra worker, database migration or environment change is introduced.

An alternative foreground transport and a new source-playback/repackaging backend are not enabled in this release. The paired physical iPhone is unavailable, and changing transport handoff or publishing an unverified early rendition would lack the required device/quality evidence. The existing source passthrough and fast-remux preparation remain intact. First-playable/full-quality observation data supports the next measured decision without silently reducing visible quality.

## Validation

- 337 backend tests passed across 77 files, including asynchronous Cloudflare completion/rollback, owner-bound acknowledgement, concurrent provider writes, moderation lease deduplication/fencing and publication readiness.
- 76 focused simulator tests passed with no failures or skips. Coverage includes exact source bytes in the merged final PATCH, constrained/fixed/retry limits, TUS offset recovery, background continuation, Blob multipart recovery, durable draft adoption, preference lifecycle, telemetry wake/backoff, visual quality fixtures and sequential counters.
- TypeScript, targeted ESLint and `git diff --check` passed.
- A regression initially caught tail merging at the provider minimum after failure; the controller now explicitly disables merging after failure. The final affected suite passed.
- Final simulator result: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T03-31-57-544Z_pid29020_19dda0ef.xcresult`.
- Source freeze: `/tmp/ubeye-432-source-freeze.json` (58 native app/resource/configuration inputs) and `/tmp/ubeye-432-backend-freeze.json` (10 changed server inputs). Native changes relative to release 431 are confined to the chunk controller, telemetry reporter, composer, API transport diagnostics and generated build configuration.

## Delivery

- Production deployment **dpl_6uKNEbdMyVL3VH3fTDoLJz6frKDj** is **READY**, targets production and serves `www.ubeye.ai`, `ubeye.ai` and `new-social-network-nine.vercel.app`. Deployment URL: `new-social-network-i0nqdqzxo-griffin-astes-projects.vercel.app`. Framework: Next.js 16.2.6; remote build completed in 42 seconds. Existing working-tree changes were preserved; no Git commit/push was made.
- General, video and image health checks returned HTTP 200 with `ok: true`. Mobile configuration and unauthenticated draft cancellation remain protected (401), admin media remains protected (307), and public queue endpoints remain 404. Deployment-scoped production error/fatal log counts were empty after the checks. Evidence: `/tmp/ubeye-432-production-health.json`; deployment log: `/tmp/ubeye-432-deploy.log`.
- Signed archive **1.0.12 (432)** passed strict deep code-signature and embedded version checks. Archive: `/tmp/ubeye-testflight-432/UBEYE.xcarchive`; archive log: `/tmp/ubeye-testflight-432-archive.log` (`ARCHIVE SUCCEEDED`).
- App Store Connect accepted the upload at **2026-09-14 03:37:43 UTC**, reporting **Uploaded package is processing**, **Upload succeeded**, and **EXPORT SUCCEEDED**, with exit code 0. Upload log: `/tmp/ubeye-testflight-432-upload.log`. Tester availability has not been separately confirmed and depends on Apple processing.
- All 58 native and 10 frozen changed server inputs remained unchanged after archive, deployment and upload.
