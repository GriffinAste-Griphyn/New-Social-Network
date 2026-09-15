# Media quality corrections — 1.0.12 (445)

## Findings and implementation

Build 444 removed cellular/resource restrictions from visible quality recovery but retained an independent server-side adaptive startup default of 720 × 1280 at 4 Mbps. Build 445 receives the standard startup envelope (1080 × 1920, 8 Mbps by default) while continuing to use the full adaptive HLS master. Older builds retain their existing startup rollout. Explicit server rollback limits and Low Data Mode/resource restrictions remain supported. These are upper preferences, not a guaranteed starting rendition or minimum bitrate.

Compatible, within-limit video now takes the passthrough/remux path before any optional adaptive encode, including when an old cached configuration enables the experiment. Optional lossy upload encoding is disabled by default on the server. Incompatible or oversized media may still require normalization. This avoids an additional lossy generation; it does not eliminate the streaming provider's encode or improve already encoded stories. Removed an unconditional `qualityPreserved=true` diagnostic that could misrepresent normalization.

Historical throughput no longer adds bitrate and 540p/720p resolution ceilings to every healthy subsequent story. Recent confirmed stalls retain a temporary bitrate restriction, and AVPlayer retains its own adaptive bandwidth selection. Prepared players receive the visible startup profile when checked out for display. Short clips can release startup preferences when their remaining video is buffered, rather than requiring an impossible two-second reserve. First-frame telemetry now records actual presentation dimensions.

Online playback no longer prefers offline HLS packages, which may contain only a lower rendition and cannot upgrade. Offline packages remain available when disconnected. Existing speculative work, memory, and stall budgets remain bounded. This may increase network use on an online replay previously served by an offline package.

## Delivery quality measurement

The provider benchmark now selects exact advertised video playlists with their associated audio instead of using approximate bandwidth hints. It verifies actual delivered dimensions and measures the entire clip at a common source-sized viewport, up to 1080p. Lower renditions are upscaled to that viewport, so downscaling is no longer hidden by giving them a lower-resolution reference. Signed playlist files are temporary and removed after each download; reports contain no signed URLs. HDR/rotated sources still require a separately normalized reference.

No provider replacement or unverified codec rollout is included. A generic 1080p rendition is not evidence of visual parity with competing applications. Real camera/skin/motion scenes on the user's phone still require a controlled comparison.

## Validation

- Full iOS suite: 254 passed, zero failed, three optional fixture cases skipped. The regression proving exact compatible-source preservation with the old lossy experiment enabled passed.
- Result bundle: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T20-46-26-125Z_pid2475_1d607410.xcresult`.
- Targeted backend/configuration/benchmark parser tests: 18 passed. TypeScript and targeted ESLint passed.
- Frozen native source manifest: `/tmp/ubeye-445-native-manifest.json` (89 files).

Deployment, provider benchmark and installation outcomes are recorded below after verification.

## Deployment and device package

- Vercel production deployment `dpl_e4PzGyUmvqLoEPtp6RYEvSQAkxfi` (`new-social-network-4qzf71xsj-griffin-astes-projects.vercel.app`) built successfully with 386 backend tests passed; nine database integration cases were deliberately skipped by the credential-isolated release runner. The corrected provider benchmark also completed successfully.
- Staged video/image health checks passed before promotion, using authenticated preview access. The same deployment was promoted to `www.ubeye.ai`; production video/image checks passed afterward. No database migration was needed.
- Exact-rendition provider report: `media-delivery-benchmark-445.json`. Two-second synthetic motion clip: 1080p SSIM 0.988074 / VMAF 91.026168; 720p SSIM 0.970333 / VMAF 84.807728 at the same display size. All five advertised rendition dimensions matched the downloaded video; audio and duration were retained. Private benchmark media was deleted. These numbers do not establish competitor parity or real camera acceptance.
- Signed Release archive succeeded. Strict deep signature checks passed for both the archive and ad hoc package. All 89 native source hashes matched. Ad hoc provisioning includes the registered iPhone; bundle `com.griffinaste.ubeye`, version `1.0.12`, build `445`.
- Direct-install IPA SHA-256: `69480e5087c0aaeec73b130d9d1444d2d6892109bbfbc24f33d882fae20bbd93`. Anonymous HTTPS download exactly matched the local package. Verified the installation page, manifest metadata, icons, and existing build-444 installation page.
- Persistent artifacts: `/Users/griffinaste/Library/Developer/UBEYE-Releases/445/`; private installation URL in `hosting.json`. Installation requires the user to open that link in iPhone Safari and confirm Install. Actual installation and comparative visual acceptance are not yet confirmed.
- Build 445 was distributed directly, not uploaded to TestFlight. The earlier Apple upload-limit rejection was not retried during this release, and no scheduled retry was created.

## TestFlight upload retry — September 14, 2026

At the user's request, retried App Store Connect submission from the existing signed archive using App Store distribution signing. Apple accepted version **1.0.12 (445)** at **15:07:13 MDT**: “Uploaded package is processing”, “Upload succeeded”, and `EXPORT SUCCEEDED`. The earlier upload-limit block did not recur on this attempt. Apple processing and tester availability are not yet confirmed.

Upload log preserved at `/Users/griffinaste/Library/Developer/UBEYE-Releases/445/testflight-upload.log`. No source rebuild or backend redeployment was needed.
