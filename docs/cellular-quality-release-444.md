# Cellular playback quality — 1.0.12 (444)

## Fix

Cellular marked the app's shared resource mode as constrained. Playback reused that resource classification to select lower-resolution startup/preparation limits and disallow lifting them. Separately, quality recovery stopped after eight seconds, so a slow initial connection could leave the startup ceiling in place even after reception recovered.

Visible picture quality now uses a separate policy: cellular and Low Power Mode keep the smaller speculative-work budget but can use the standard video quality settings. Low Data Mode, serious/critical thermal conditions, and recent memory pressure still restrict quality. Actual throughput still influences startup selection, and AVPlayer retains adaptive bitrate control.

The quality monitor remains active for the visible playback session: 250 ms observations for the first eight seconds, then once per second. It requires two healthy, playing samples before releasing initial bitrate/resolution preferences. Pauses and interruptions cannot satisfy this guard. Changes into Low Data Mode or critical resource pressure reapply limits; recovery requires fresh healthy samples. Confirmed stalls retain the existing recovery path. The monitor cancels when hidden/replaced and holds its controller weakly across waits. HD telemetry remains deduplicated and can record a later successful upgrade.

The immediately upcoming cellular video gets a four-second preferred buffer instead of two, with the existing one-player speculative limit and stall suspension. On becoming visible, a prepared player moves to the eight-second active buffer preference. Restricted paths use two seconds for preparation and four seconds for active playback. These are AVPlayer preferences, not guarantees that the full amount has downloaded before a tap.

## Scope

This is an iOS-only fix. Existing backend configuration, telemetry schema, and streaming manifests already support it; no backend redeployment or database migration is required. Production remains on deployment `dpl_2xuxCgXd6V67txz8bntFqd83riDw` from release 443.

No minimum bitrate is forced. Sustained weak bandwidth can still require lower quality or buffering. Physical-device cellular performance at the user's location is not reproduced by simulator policy tests.

## Validation and release

- Complete iOS suite: **252 passed, zero failed, three optional fixture tests skipped**. New cases cover the cellular/Low Power Mode classification, recovery after prolonged weak service, mid-story restrictions, fresh-buffer requirements after pause/interruption, and separate prepared/active buffer budgets. Existing playback, upload, image-quality, and source-protection tests also passed.
- Result bundle: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T19-53-40-862Z_pid2475_0bb083e4.xcresult`.
- Production video health returned `ok: true`, including signed playback and provider checks. No backend files or schema changed for this release.
- Native sources frozen at `/tmp/ubeye-444-release/apps/ios`; hash manifest `/tmp/ubeye-444-native-manifest.json`.

- Signed Release archive succeeded at `/tmp/ubeye-testflight-444/UBEYE.xcarchive`. Verified bundle `com.griffinaste.ubeye`, version `1.0.12`, build `444`; strict deep signature verification passed. All 89 frozen native source hashes matched after archiving.
- **TestFlight upload blocked:** App Store Connect rejected build 444 on September 14, 2026 with “Upload limit reached. The upload limit for your application has been reached. Please wait 1 day and try again.” Validation ID: `e96f5740-4762-4cc6-828b-fb0c90856dbd`. This build was not accepted into TestFlight. Upload log: `/tmp/ubeye-testflight-444-upload.log`.
- The signed archive remains ready for retry after Apple permits another upload. No retry automation was created. The native working tree still matches the archived sources.
- Local App Store package export succeeded: `/tmp/ubeye-testflight-444/ready-to-upload/UBEYE.ipa`. This is a saved upload artifact, not proof of TestFlight availability.

## Direct remote installation — September 14, 2026

- Re-exported the same archive using Xcode's `release-testing` method and automatic signing. The resulting ad hoc provisioning profile includes the user's registered iPhone (one device), has `get-task-allow = false` and production push entitlements, and expires September 14, 2027 at 20:03:13 UTC. Strict deep signature verification passed. Version and build remain `1.0.12 (444)`.
- Published a separate Next.js 16.2.6 installation site on Vercel: project `ubeye-device-install` (`prj_qVk2IbCXsQvW61B4UGHJvAj3PZx0`), deployment `dpl_DgvAb9ASGj1DLSAa3fsSAcHAcr4L`, status READY. The main application deployment was unchanged.
- Installation page and package use an unlisted random link. They are anonymously accessible so iOS can fetch the manifest and IPA; device eligibility is enforced by Apple's ad hoc provisioning. Robots indexing is disabled. Invalid installation tokens return HTTP 404.
- Verified the rendered page's `itms-services` link, HTTPS manifest, bundle metadata, both icons, and anonymous IPA download without redirects or authentication. Downloaded IPA SHA-256 matches the local signed export: `cdc1ec0c60550a8da5c52e5e465fd8910041b9731d5077437c3a976480c2839f`. Manifest and IPA have the expected XML and octet-stream content types.
- Persistent source and release package: `/Users/griffinaste/Library/Developer/UBEYE-Releases/444/`. The private installation URL is saved in `hosting.json` there, outside the repository.
- Actual installation on the remote iPhone still requires the user to open the link in Safari and confirm Install. TestFlight remains blocked for build 444; this direct distribution does not resolve or retry that upload.
