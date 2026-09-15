# Faster upload submission — 1.0.12 (430)

Videos now enter the durable upload store before export, poster generation or whole-file hashing. The composer can return to the feed after the original files and immutable story drafts have been saved. Background preparation, transfer and publication continue under the upload store's ownership. A ready speculative preparation is reused; unfinished speculative work is cancelled after ownership transfers.

Poster generation and checksumming run alongside the video transfer rather than delaying its start. A poster is generated only when the authorized upload target requests one. The poster still has its three-second deadline and cancellation reaches the frame generator. Source fingerprints are checked around hashing, and the checksum is cached for retries. Completion still requires the existing integrity, ownership and moderation checks.

Raw submissions persist their source type and preparation requirement. Prepared replacements enter the manifest before raw pathnames are deleted, and already prepared files are reused after a restart. Interrupted replacement output can be overwritten safely on retry. Failure to write the submission manifest is reported rather than acknowledging a non-durable upload. Composer and upload preparation share one FIFO export permit, with cancellation removing queued waiters.

Photo batches allow at most two overlapping transfers on unrestricted connections when resource mode is standard. Limited connections or reduced resource modes keep one transfer. Publication and registration stay in selection order; a video creates a batch barrier. A global transfer limit bounds photos to two and videos to one across batches. Photo transfer permits are released before waiting for ordered completion, avoiding dependency deadlocks.

Adaptive video chunks can start from a recent upload-rate estimate instead of always beginning at 5 MiB. The estimate requires at least two samples and expires after six hours. The initial target is four seconds of work and remains inside the configured provider bounds and 256 KiB alignment. Unknown measurements retain the 5 MiB start.

For first-upload encoding decisions without measured history, only files at least 64 MiB with substantial estimated savings are considered. The explicit decision assumptions are 5 Mbps for cellular/expensive paths and 20 Mbps for standard paths, and predicted savings must exceed 18 seconds. These assumptions are not represented as measured throughput. Existing HDR, color, frame-rate, resolution, audio and visual-quality gates still decide whether an encoded candidate can be retained; rejected candidates fall back to the original path.

The fixed-total, confirmed-completion batch counter from build 429 remains in place. Preparation failures, queue growth and retries are not credited as successful stories.

## Measurements

Existing accepted performance-event names are used for these new phases:

- `tap_to_staged`: submission to durable ownership.
- `local_prepare`: normalization/export under upload-store ownership.
- `prepare_lease`: authorization/session preparation.
- `tap_to_first_bytes`: the first iOS body-send notification; resumed HEAD offsets and synthetic progress do not trigger it.
- `transfer`: application-level video transfer duration, including its protocol overhead.
- `complete`: the server completion request.
- `tap_to_accepted`: submission to successful server acceptance.
- `accepted_to_ready` and `tap_to_ready`: server-confirmed readiness, including required moderation readiness.

Readiness measurements retain the upload attempt identity and persist across restarts. Repeated readiness notifications are suppressed. The protected media dashboard now separates phase p50/p95 and sample counts by media type, phase, build, network, device model and file-size range. Effective video Mbps is omitted for retried attempts.

Server readiness is not evidence that another account's device has rendered the first frame. A real-device test remains necessary to measure that full experience.

## Verification

- 62 simulator upload tests passed with zero failures or skips. This includes 13 added regression tests for raw durability, interrupted replacement, failed manifest writes, batch dismissal during preparation, quality-decision thresholds, chunk bounds, ordered photo publication, concurrency limits, cancellation, first-byte observations and durable readiness deduplication.
- Existing upload recovery, resumable chunks, adaptive visual quality, source preservation, deferred registrations and sequential batch-counter tests passed.
- 313 backend tests passed across 71 files.
- ESLint passed for the changed backend/dashboard files.
- Next.js route type generation and TypeScript checks passed. Local type generation used a development environment label because no production database/authentication credentials were loaded locally; the production deployment performs its own production build.
- The new grouped timing query executed successfully against production Postgres using read-only SQL.
- A repeat test exposed a fixture-cleanup race; the test now waits for actual published upload settlement instead of a fixed number of task yields. Counter fixtures use valid JPEGs and drain preheating before cleanup.

The paired iPhone was reported unavailable by `devicectl`; no physical-device upload-speed comparison or second-account playback test was performed. No competitor-equivalent latency or numerical speedup is claimed.

## Delivery

Production deployment `dpl_C7sDUZqH9iEq6EqbZpqx6JZWwGiL` is READY and targets production. It is aliased to `www.ubeye.ai`, `ubeye.ai` and `new-social-network-nine.vercel.app`.

Deployment URL: `new-social-network-mlkavrqv4-griffin-astes-projects.vercel.app`.

Production general, video and image health endpoints returned HTTP 200 with `ok: true`. The admin media page still requires authentication (307), the mobile media configuration requires authentication (401), and all three public queue routes returned 404 as expected. The initial scoped production error/fatal runtime-log check returned no entries.

Deployment log: `/tmp/ubeye-430-deploy.log`.
Health evidence: `/tmp/ubeye-430-production-health.json`.

TestFlight 1.0.12 (430) uploaded successfully. App Store Connect reported that the uploaded package is processing on September 14, 2026 at 02:12:29 UTC. Tester availability remains subject to Apple completing processing.

The archive's embedded version/build were verified as 1.0.12 / 430. Strict code signature verification passed and all frozen inputs matched the archived source.

Archive: `/tmp/ubeye-testflight-430/UBEYE.xcarchive`.
Archive log: `/tmp/ubeye-testflight-430-archive.log`.
Upload log: `/tmp/ubeye-testflight-430-upload.log` (`Upload succeeded` and `EXPORT SUCCEEDED`).
Final simulator results: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T02-09-01-357Z_pid70024_571ce4a1.xcresult`.

Frozen iOS inputs: 56 source/resource/configuration files in `/tmp/ubeye-430-source-freeze.json`.
