# Media pipeline release — 1.0.12 (443)

## Implementation

- Split media configuration, telemetry, audio ownership, resource policy, image caching, upload transport, response caching, story navigation/store/progress, and video playback out of the large shared files. SwiftUI view state and rendering remain in the viewer; transport and persistence have independent ownership.
- Upload manifest snapshots write off the main actor in causal order. Initial staging, source replacement, draft adoption, and prepared upload leases await durable writes. Operations revalidate ownership after suspension. Recovery receipts use a serial actor. A state-transition policy rejects late progress that would resurrect a completing, paused, or failed upload.
- Background TUS tasks persist a versioned identity containing their attempt, exact signed upload URL, and staged body file. Restored identifiable iOS-owned PATCH requests finish before the durable queue reconciles the server offset. Existing unidentifiable legacy tasks retain cancellation/reconciliation behavior. User removal cancels matching transfers. This resumes the current background request; it does not promise that iOS will run arbitrary Swift code after a force quit.
- One resource budget governs adjacent players, images, story stacks, persistent video prefetch, and offline HLS downloads. Budget changes cancel the affected speculative work while preserving the visible player. Healthy measured playback can retain the existing one-player upload allowance; stalls, disconnection, and resource constraints reduce work.
- New accepted, ready, feed-visible, and first-frame events correlate stories across different accounts and random installation IDs. The admin media dashboard separates device-local durations from server receipt intervals. Receipt intervals include viewer wait time and telemetry batching and are not upload latency. Migration 0062 registers the events; 0063 adds a partial story/name/time lookup index. Both are additive.
- A repeatable local regression runner creates ten synthetic scene types and exercises the native encoder, source inspection, player/persistence tests, and offline delivery experiments. H.264/HEVC candidate selection requires measured byte savings, bounded encoding time, matched-reference SSIM/VMAF, dimensions, and duration checks. Production codec defaults remain unchanged; the experiment is a prerequisite for a later codec rollout.

## Validation

- Initial complete native regression: 243 passed, zero failed, six optional fixture tests skipped.
- Fixture-enabled full run: 246 passed; one test incorrectly required the encoder to finish within its production deadline on a loaded simulator. The app correctly fell back to the intact source. The test now verifies both valid outcomes and source integrity.
- Final expanded quality suite: 16 passed, zero failed, one historical external-fixture test skipped. Includes synthetic PQ HDR, 60 fps, landscape, fine text, gradients, slowed motion, dark detail, and palette scenes. HDR and high-frame-rate inputs remain excluded from unsafe adaptive compression.
- Final affected native suites after resource cancellation changes: 141 passed, zero failed, one optional fixture test skipped. Includes a 40-upload persistence/removal burst and player ownership/navigation regression coverage.
- Backend unit/API suite: 381 passed. Nine database tests are deliberately excluded from the credential-isolated runner. The new delivery observation integration test passed separately on an isolated Neon branch, including account/device separation and exact timing values. The prior eight background-job database tests were unchanged.
- TypeScript, targeted ESLint, Drizzle migration checks, and regression shell syntax passed.
- Offline report: `media-encoding-experiments-443.json`. Nine SDR fixtures were measured with SSIM and VMAF; the HDR fixture explicitly requires a separately approved normalized reference. Five SDR clips qualified for the experimental efficient H.264 profile. None selected HEVC. These synthetic, shared-host measurements do not establish production percentiles or device energy performance.

## Repeatable local run

```sh
MEDIA_TEST_DESTINATION='platform=iOS Simulator,id=YOUR_SIMULATOR_ID' \
MEDIA_TEST_OUTPUT=/tmp/ubeye-media-regression \
npm run media:regression
```

The macOS runner uses the system SFNS Mono font for the fine-text fixture. `MEDIA_FIXTURE_FONT` can select another available font. Fixtures have a manifest, so generated candidate files never become reference inputs on a rerun. Existing XCTest quality suites receive `MEDIA_FIXTURE_DIRECTORY` explicitly. Reports and result bundles stay in the output directory.

## Physical-device acceptance still required

Use two test accounts on different devices, both running 443 or later. Measure cold and warm story opens during a large upload; tap forward/back repeatedly; switch Wi-Fi/cellular; lose and regain connectivity; lock/unlock and background/relaunch. Confirm no duplicate story or restarted source transfer, no stuck progress, and stable player/memory counts. Repeat at Low Power Mode and under thermal pressure, capturing Instruments energy/memory traces.

Use consented real faces, moving foliage/hair, camera HDR, camera slow motion, dark scenes, and synchronized speech/clap references. Compare source and output on the same display. Synthetic palettes are not a face/skin quality benchmark. iOS force-quit behavior and an actual two-device upload-to-playback journey cannot be proven by simulator unit tests.

Do not enable an experimental codec based on these synthetic results alone. Preserve the original, verify the delivery on supported physical devices and weak connections, then canary against startup, rebuffering, quality, energy, and byte-use measurements.

## Release artifacts

Native sources frozen at `/tmp/ubeye-443-release/apps/ios`; hash manifest at `/tmp/ubeye-443-native-manifest.json`. Archive target: `/tmp/ubeye-testflight-443/UBEYE.xcarchive`. Deployment and App Store Connect outcomes are recorded below after verification.


App Store Connect accepted **1.0.12 (443)** on September 14, 2026 at **13:19:52 MDT**: “Uploaded package is processing”, “Upload succeeded”, and “EXPORT SUCCEEDED”. Apple processing/tester availability is not yet confirmed. Upload log: `/tmp/ubeye-testflight-443-upload.log`. Strict deep code-signature verification passed and all 89 frozen native source hashes matched after archiving.

Final production deployment: `dpl_2xuxCgXd6V67txz8bntFqd83riDw` (`new-social-network-emh6ifr9c-griffin-astes-projects.vercel.app`). The remote build passed 381 tests, TypeScript, and the optimized Next.js build. Image and video health checks passed before promotion. Promoted successfully; `www.ubeye.ai` resolves to this READY deployment and both live media health endpoints returned `ok: true`, including provider access and signed HLS playback. Production enum values and the partial lookup index were verified. The read-only delivery report query also succeeded; no build-443 cross-device samples were available yet.

The archived native sources still match the working tree. Temporary database credential files and superseded local test products were removed; result bundles, logs, source hashes, and the signed archive remain available.
