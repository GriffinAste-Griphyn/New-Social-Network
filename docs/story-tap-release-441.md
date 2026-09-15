# Story tap responsiveness — build 441

The viewport-wide exclusive double-tap/single-tap recognizer delayed navigation while waiting for a possible second tap. Side navigation now has independent single-tap recognizers. Only the center region arbitrates single-tap chrome toggling versus double-tap reaction. The existing 32% / 36% / 32% zones, accessibility actions, chrome exclusions, press-to-pause and viewport-level vertical swipe remain in place.

This is an iOS change. The deployed media backend is unchanged.

## Verification

The Debug application built and launched successfully on iPhone 16 Pro Simulator. Physical side-tap input advanced stories. Logs include prepared transitions completing 9–29 ms after recognition, along with one video-to-image transition taking about 380 ms after recognition. These are simulator instrumentation observations, not controlled before/after measurements or a physical-device latency guarantee. Touch-to-recognition timing includes the finger-down duration.

Runtime log: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/logs/com.griffinaste.ubeye_oslog_2026-09-14T17-52-08-752Z_helperpid88839_ownerpid87660_62ad4fff.log`.

Regression: **146 passed, zero failed, one fixture-dependent test skipped** (MediaPerformanceTests, PlaybackPolishTests, UXPolishTests). Result bundle: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T17-53-40-126Z_pid87660_6f094966.xcresult`.

## Release status

Signed archive and strict code-signature verification passed for `com.griffinaste.ubeye`, version `1.0.12`, build `441`. Native code hashes matched after archiving. Archive: `/tmp/ubeye-testflight-441/UBEYE.xcarchive`.

Apple rejected the upload on 2026-09-14 at 11:58 MDT: **Upload limit reached. The upload limit for your application has been reached. Please wait 1 day and try again.** Validation ID: `249fe269-e544-4ed1-abfe-e6936cf55391`. Build 441 is **not on TestFlight**. Build 440 remains the previously uploaded release and does not contain this fix.

Retry the existing signed archive with `/tmp/ubeye-testflight-441/ExportOptions-Upload.plist` after Apple's upload limit permits it. Upload log: `/tmp/ubeye-testflight-441-upload.log`. No backend redeploy is needed.

Local distribution export succeeded: `/tmp/ubeye-testflight-441/LocalExport/UBEYE.ipa` (5,743,046 bytes). This preserves the signed package without attempting another Apple upload.

## App Store submission attempt

At the user's request, the existing signed `1.0.12 (441)` archive was retried for App Store distribution on 2026-09-14. Strict/deep signature verification passed. Apple rejected the retry at **12:03:50 MDT** with the same daily upload limit and requested waiting one day. Validation ID: `83ef9d64-90a6-49bc-b73d-61b546107f32`. Log: `/tmp/ubeye-appstore-441-retry.log`.

Build 441 has **not been uploaded or submitted for App Review**. Retry the preserved archive after the limit clears (Apple's guidance suggests September 15 around noon MDT; the precise reset time is not confirmed), then select build 441 for version 1.0.12 and submit for review. The browser session also requires App Store Connect sign-in before submission metadata can be inspected.

## Direct device installation

On 2026-09-14 at 12:09 MDT, the existing build 441 archive was exported with development signing and installed directly on Griffin’s iPhone 17 Pro Max after pairing, Developer Mode activation, and device registration. The exported provisioning profile includes the connected phone; strict/deep code-signature verification passed. `devicectl` confirmed installed version `1.0.12 (441)` and successfully launched `com.griffinaste.ubeye`. This was an in-place installation over build 440; no uninstall was performed.

Development IPA: `/tmp/ubeye-testflight-441/DeviceExport/UBEYE.ipa`. Export log: `/tmp/ubeye-testflight-441-device-export-enabled.log`. This direct installation does not change TestFlight availability.
