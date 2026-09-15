# Media operations release — September 13, 2026

The app and APIs remain on Next.js and Vercel. Cloudflare Stream remains the production video processor; Cloudflare R2 remains the image and avatar store. The Vercel Pro upgrade enables the schedules below. It does not by itself improve video quality or playback latency.

## Recovery and monitoring

Video, image, moderation, publication, and monitoring reconciliation run every five minutes, staggered across minutes 0–4. Upload cleanup and creator feed-score aggregation run hourly. The expensive seven-day feed-score query is separate from the frequent monitoring query.

Workflow dispatch is enabled in production. Database outboxes and worker claims remain authoritative. If Workflow startup fails, accepted media tasks fall back to processing after the HTTP response; reconciliation can recover a task if that execution is interrupted. Video, image, and publication dispatch use the same fallback. Exhausted stale image leases become explicit errors, and late failures cannot downgrade ready images or replace a newer owner's result.

The authenticated `/admin/media` page shows 15-minute QoE windows refreshed every five minutes. Snapshots are retained for 30 days. It segments build, network, device, delivery, and startup experiment; displays first-frame p50/p95, stalled and failed session rates, upload outcomes, sampled transferred bytes, pending moderation, processing age, failed publication, and publish p95. Empty samples display an unavailable rate, rather than a misleading zero.

Thresholds: startup p95 over 900 ms requires at least 20 frames in each of two independent adjacent windows. Playback failure above 0.5%, standard-network stalled sessions above 1%, and upload failures above 1% require at least 100 observations. Processing older than 10 minutes, exhausted jobs, and failed publication are also surfaced. Structured `media_slo_breach` and `media_slo_recovered` events report transitions; the admin page retains the current state. These are dashboard/log alerts; this release does not configure external email or paging.

## Playback experiment

Builds 422 and newer use a deterministic user/device cohort. `MOBILE_ADAPTIVE_START_CANARY_PERCENT=20` selects the first 20 buckets out of 100. Set it to `0` to disable the experiment without an App Store release. Older builds and clients without a cohort retain the baseline behavior.

The canary requests the adaptive manifest without a fixed Cloudflare bandwidth hint. Cold-start AVPlayer hints use 4 Mbps / 720p on standard networks and 1.6 Mbps / 540p on constrained networks, then use the existing healthy-buffer quality ramp. Full-quality prepared playback settings remain available. Adjacent prepared players and stack warming are bounded at two, persistent speculative downloads at one on standard networks and zero on constrained networks, and speculative offline HLS downloads are disabled for the canary.

Canary limits use environment names ending in `_CANARY`, so baseline overrides cannot accidentally overwrite the experiment. QoE events carry `startup_profile`; session identifiers and byte/watch counters take priority under the 20-field metadata budget. Access-log byte totals include all bitrate transitions, rather than only the last log event. Sampled access-log data is not an estimate of total production bandwidth.

Do not expand the cohort until both profiles have sufficient samples in comparable build/network/device cohorts. Compare startup, terminal failures, stalls, data use, and quality ramp behavior. A faster first frame alone is insufficient evidence to expand.

## Visual and audio benchmark

Run `npm run media:benchmark -- --input /absolute/path/to/clips --output /absolute/path/to/results`. Without `--input`, it generates a four-second synthetic motion/audio smoke fixture. The script uses the application's real rendition encoder and reports encoding duration, bytes, SSIM, VMAF when the analysis binary supports it, integrated loudness, true peak, and loudness range. Set `MEDIA_ANALYSIS_FFMPEG_PATH` to a VMAF-enabled analysis binary if needed. HDR and rotated sources require a normalized matching reference before objective scoring; the report explicitly skips those scores.

Smoke results: synthetic 360p SSIM 0.9887 / VMAF 94.25; 540p SSIM 0.9933 / VMAF 96.50. These validate tooling, not camera-image quality. Maintain a consented fixture set with faces/skin, text, fast motion, foliage, low light, HDR, landscape, rotation, speech, music, silence, and loud audio. Review on actual phones for skin tone, gradients, detail, framing, sync, clipping, and quality switches. Use human review alongside metrics.

Custom FFmpeg audio has an opt-in `MEDIA_AUDIO_LOUDNESS_NORMALIZATION_ENABLED=true` path targeting -16 LUFS / -1.5 dBTP / 11 LU loudness range. It preserves channel count and the 48 kHz / 160 kbps AAC profile. Benchmark it separately using that flag and a separate output directory. It remains disabled by default until real speech/music fixtures are reviewed. This flag does not affect production Cloudflare Stream encoding. Original uploads remain intact.

Migration `0057_media_operations_snapshots.sql` adds only the metrics table. The preceding `0056_image_upload_diagnostics` migration is tracked with its existing hash before this migration. No provider migration or custom encoding service is required for this release.

## Deployment and verification

Production deployment: `dpl_CGh3j1HzXheGBfhcqqcD7DAYFXYP`, aliased to `www.ubeye.ai`. Cloudflare signed video playback and R2 bucket probes returned HTTP 200. The metrics page redirects unauthenticated requests to admin login; cron requests without the secret return 401. The first scheduled monitoring snapshot was collected at `2026-09-13T20:09:13.194Z`, with two cohorts and no backlog alerts. All seven Pro cron definitions are enabled on the production deployment.

Verification: 270 backend tests passed; TypeScript, targeted ESLint, Drizzle consistency, production build, and diff checks passed. The 100 iOS media tests passed, with the two startup-profile tests repeated after adding protection against taking a fixed-rendition prepared player into the adaptive cohort. Actual deployed config requests verified adaptive mode for build 422 / bucket 7, baseline mode for build 422 / bucket 97, and baseline mode for build 421 / bucket 7. An isolated database branch verified that duplicate UI upload-error reports are excluded and a recovered attempt counts as one success, not an additional failure.

TestFlight: version `1.0.12`, build `422`, signed archive and upload succeeded. Apple accepted the upload and began processing at `2026-09-13T20:07:34Z`. Post-upload processing and tester availability were not confirmed through App Store Connect.

The stronger moderation implementation is still pending the user's choice to reuse the existing production OpenAI credential. This release changes scheduling cadence and enables the existing moderation workflow transport; it does not change scanner policy or add sampled-frame moderation. Real-camera quality review is also required before enabling audio normalization or expanding the playback cohort.

The isolated validation branch `codex-media-pro-422` (`br-small-unit-an9fdov2`) remains available for review, with five-minute compute autosuspend. Benchmark smoke reports are saved in `docs/media-quality-benchmark-smoke.json`.
