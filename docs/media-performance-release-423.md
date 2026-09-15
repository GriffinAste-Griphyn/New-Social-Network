# Media performance release 423

Next.js and the app APIs remain on Vercel. Existing Cloudflare Stream video processing and R2 image delivery remain in place.

## Playback and images

Build 423 prioritizes the next two story items ahead of a previous item. Adjacent player preparation stops while the active video is starting or buffering, and resumes after visible playback has at least two healthy buffered seconds. Unknown connection history warms one player; measured standard paths warm at most two. Speculative players have low network priority on iOS 26; active playback retains high priority. Discarded staged and completed players cancel prerolls and release their items. Checked-out players retain their items.

Throughput learning uses unsampled local access-log notifications, expires after two minutes, resets on path-class changes, and reacts faster to slowdowns. Prepared playback and adaptive cold starts use 70% of the recent throughput estimate, bounded by configured limits. Resolution hints follow the bitrate envelope. The healthy-buffer ramp still allows adaptive playback to reach higher quality. The existing 20% adaptive-manifest cohort remains unchanged; no claim of measured end-user startup improvement is made before build 423 receives comparable real-device samples.

Decoded images use distinct URL/pixel-size cache entries. Full-screen decodes are limited to the device's native long edge and a 1920/2560 device-memory ceiling, thumbnails to 640 pixels, and avatars to bounded pixel buckets based on their displayed size and screen scale. Larger presentations do not reuse a smaller decoded cache entry. Compressed disk bytes remain shared by URL. Image loads retain independent consumers; cancellation of one consumer does not cancel a load still needed elsewhere. Abandoned predictive preheats are cancelled. Existing background ImageIO decoding and progressive placeholders remain.

## Uploads and quality

Compatible video originals still pass through or remux without re-encoding. Normalization uses an 8.2 Mbps total size hint, bounded by 512 MB, only when a lossy export is necessary. Exports observe cancellation and a three-minute deadline per attempt. Apple treats the envelope as a hint; measured file size can exceed the hint and is checked independently.

The actual Apple exporter was tested with synthetic 1080p motion and detail fixtures. Motion SSIM rose from 0.996598 to 0.997969; temporally noisy detail SSIM rose from 0.641472 to 0.646311. Files grew approximately 22–28%; detail export time increased. These are tooling/source-compression checks, not a claim about faces, skin tones, low-light camera footage, or final Cloudflare renditions. `testUploadQualityAuditFromLocalFixtures` accepts local `source-*.mp4` fixtures in the simulator app's Documents/MediaSourceQualityAudit directory without uploading them. Reports are in `docs/media-source-quality-audit.json`.

Cloudflare Stream delivers HDR uploads in SDR. Imported source content is preserved for provider processing; actual-phone review of HDR-to-SDR colors, gradients, speech/music, and audio sync remains a human validation step.

## Publication and operations

`MEDIA_EARLY_VIDEO_PUBLICATION_ENABLED=true` permits publication when Cloudflare reports `ready` and `readyToStream`. Required moderation and structural checks still gate visibility. Provider progress remains truthful, and `fullQualityReady` requires completion at 100%. Recovery and owner-status polling continue checking playable videos while HD encoding completes. Disabling the flag restores the full-encoding gate for unpublished stories and does not hide videos already live. Moderation scanner policy is unchanged by this release.

The protected `/admin/media` dashboard now separates device hardware model and cold/cached/prepared/prerolled startup state, displays time from playback request until 720p and 1080p, and shows completed upload-phase p50/p95. Quality timing and bytes use sampled telemetry; throughput learning does not. Short, interrupted, constrained, and low-resolution source sessions may never reach 1080p, so the reach rate is descriptive rather than a quality failure threshold. Payloads remain bounded at 32 metadata fields. Earlier snapshot JSON remains readable; no new schema migration is required.

## Pro CPU benchmark

Identical protected preview jobs in iad1 measured the real image encoder, with warmup followed by three serial jobs on a deterministic 12 MP fixture:

| Configuration | Median image encode |
| --- | ---: |
| 2 GB / 1 vCPU, one image worker | 14,360 ms |
| 4 GB / 2 vCPUs, one image worker | 14,225 ms |
| 4 GB / 2 vCPUs, two image workers | 6,724 ms |

The measured two-worker improvement is 53.2% on this workload. `MEDIA_IMAGE_PROCESSING_THREADS=2` bounds native worker concurrency; other deployments keep platform defaults. The project CPU setting applies to all Vercel functions, and is not a guarantee of faster network-bound requests. The local companion quality check measured PSNR 26.8943 dB versus 26.8812 dB against the same resized sRGB canvas, within the 0.1 dB regression guard. Both remain AVIF at the same configured quality/effort. Benchmark results are in `docs/media-image-cpu-benchmark.json` and `docs/media-image-quality-audit.json`. Run `npx tsx scripts/media-image-quality-audit.mjs` to repeat the quality check. The HTTP CPU benchmark is available only on explicitly enabled authenticated previews and always returns 404 in production.

## Verification and delivery

279 backend tests pass. The 111 iOS media/geometry tests pass, with two additional cancellation/disposal tests passing separately and the actual-exporter fixture audit passing separately (114 unique media tests). TypeScript, targeted ESLint, and diff checks pass. All three monitoring SQL queries execute against production; read-only fixture CTEs on the existing isolated branch verify hardware/cold/warm grouping, both HD timings, byte totals, interrupted quality sessions, duplicate-error exclusion, and recovered upload outcomes.

Production deployment `dpl_CBqWRiU6ayN5DZLTsgUryYNa7XTq` is READY and serves https://www.ubeye.ai. At 2026-09-13 21:00 UTC, the app, Cloudflare R2 image checks, and signed Cloudflare Stream playback probe all returned 200/healthy. Anonymous admin requests redirect to login, cron requests return 401, and the preview-only CPU benchmark returns 404 in production. The deployment reported no error/fatal runtime logs during the initial verification window.

Production uses Fluid Compute in iad1 with the project's performance configuration (4 GB / 2 vCPUs), `MEDIA_IMAGE_PROCESSING_THREADS=2`, `MEDIA_EARLY_VIDEO_PUBLICATION_ENABLED=true`, and media config version `2026-09-13.3`. The adaptive startup canary remains 20%.

The first scheduled rollup after deployment completed at **2026-09-13 21:04:13 UTC** and persisted the new `uploadPhases` array in the production snapshot. That quiet five-minute window contained no playback segments and no alerts; it confirms reporting execution, not end-user performance improvement.

Signed archive: version **1.0.12, build 423**. Xcode's App Store Connect upload completed successfully at **2026-09-13 21:01:47 UTC**, reporting `Uploaded package is processing`, `Upload succeeded`, and `EXPORT SUCCEEDED`. Apple processing and tester availability are separate from upload acceptance and were not yet confirmed at delivery. Local archive and upload logs are `/tmp/ubeye-testflight-423-archive.log` and `/tmp/ubeye-testflight-423-upload.log`.
