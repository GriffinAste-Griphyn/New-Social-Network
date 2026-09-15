# Media delivery release — 1.0.12 (440)

## Changes

- Build 440 receives the full adaptive HLS manifest for all eligible stable cohorts. Older builds retain the existing canary. `MOBILE_ADAPTIVE_START_PERCENT_BUILD_440=0` rolls this back.
- Images publish a bounded WebP display and thumbnail first. A separately leased, durable AVIF job reads the verified original and promotes AVIF only when it saves at least 5% of display bytes. Moderation, expiry, deletion and ownership checks guard promotion. Immutable WebP objects remain usable by cached feeds.
- Optional iOS video compression requires an uplink measurement no older than 120 seconds. Export, metadata inspection and visual verification share a six-second preparation budget with native cancellation; otherwise upload uses the source.
- Worker slots are configurable per lane and bounded to 1–32. Defaults remain conservative: video initial 2, image initial 2, video enhancement 1, image enhancement 1, feed fanout 2. Capacity retries use short jitter.
- Follower fanout uses durable 250-follower keyset pages and bounded Redis operations. Each page invalidates its own viewers. Initial image completion and creator snapshots no longer enumerate all followers.
- Background jobs have ownership leases, retry limits, scheduled recovery and operations alerts. Migration 0061 adds the outbox and follower cursor index.

## Validation

- Both staged production builds: 378 backend tests passed each; eight database integration tests were intentionally excluded from its credential-isolated test process.
- All eight database integration tests passed separately against an isolated Neon branch, including duplicate jobs, stale ownership, moderation, deletion, source integrity, durable continuation and a 20-job concurrency burst.
- Production migration applied successfully; both new indexes were verified.
- Production build compiled and type-checked. Staged video/image health checks passed, including real signed HLS playback and provider access.
- Synthetic 12 MP image: two-thread WebP 954 ms / 1,003,916 bytes versus AVIF 3,961 ms / 905,381 bytes. This is a fixture benchmark, not a production latency percentile.
- Private Cloudflare roundtrip: two-second portrait H.264/AAC fixture; uploaded in 1,518 ms, ready in 16,744 ms. Actual delivered 1080p: 878,653 bytes, SSIM 0.988231, VMAF 91.058642; audio and duration retained. Private fixture deleted afterward.
- Five bandwidth-hint probes produced four distinct delivered resolutions. Requested and actual sizes are recorded in `media-delivery-benchmark-440.json`; bandwidth hints are not exact rendition selectors. Lower-resolution metrics use a resized reference and must not be compared as proof that downscaling improves quality.

## Operational controls

`MEDIA_IMAGE_FAST_PUBLICATION_ENABLED=false` restores synchronous AVIF encoding. `MEDIA_IMAGE_AVIF_ENHANCEMENT_ENABLED=false` defers optional enhancement. Lane overrides are `MEDIA_WORKERS_VIDEO_INITIAL`, `MEDIA_WORKERS_IMAGE_INITIAL`, `MEDIA_WORKERS_VIDEO_ENHANCEMENT`, `MEDIA_WORKERS_IMAGE_ENHANCEMENT`, and `MEDIA_WORKERS_FEED_FANOUT`.

Normal builds skip release-only probes. `MEDIA_RELEASE_VERIFY=true` runs tests with isolated dummy credentials. `MEDIA_RELEASE_BENCHMARK=true` creates, measures and removes a private provider fixture using the builder's configured credentials.

## Scope of evidence

Simulator and synthetic server benchmarks do not establish parity with TikTok, Snapchat or Instagram. Physical-device first-frame latency, scroll frame pacing, battery/thermal behavior, real camera scenes and production p95 queue/upload times still need field measurement.

## Deployment

Final production deployment: `dpl_9oiGcccv9hNeY972dvFVsAGtkuqi` (`new-social-network-4ins2fcgb-griffin-astes-projects.vercel.app`), promoted and verified through `www.ubeye.ai`. Native sources were frozen under `/tmp/ubeye-440-release/apps/ios`; the simulator build succeeded and launched to the welcome screen.

Final iOS regression: 156 passed, zero failed, four fixture-dependent tests skipped. The large optional local-fixture audit was excluded. The two suites with updated expectations also passed separately (124 tests). Final result bundle: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T17-40-59-851Z_pid68554_13fbf755.xcresult`.

Signed Release archive succeeded at `/tmp/ubeye-testflight-440/UBEYE.xcarchive`. Confirmed bundle `com.griffinaste.ubeye`, version `1.0.12`, build `440`; strict deep code-signature verification passed and frozen source hashes matched after archiving.

App Store Connect accepted the upload at 2026-09-14 11:45 MDT: `Uploaded package is processing`, `Upload succeeded`, `EXPORT SUCCEEDED`. TestFlight build **1.0.12 (440)** was uploaded successfully; Apple processing/tester availability was not yet confirmed. Upload log: `/tmp/ubeye-testflight-440-upload.log`.
