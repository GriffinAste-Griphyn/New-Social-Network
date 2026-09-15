# Single swipe dismissal haptic — 1.0.12 (438)

Downward media dismissal gives one light snap haptic per gesture. Previously, crossing the dismissal distance triggered a snap and releasing triggered a second rigid boundary impact. Reversing and recrossing the distance could also repeat the snap.

The viewer now remembers whether it has played dismissal feedback until the gesture ends. It gives feedback at the first distance crossing; a flick that dismisses before reaching that distance gets the same light feedback on release. Release and repeated threshold crossings do not repeat feedback already given. The immediate dismissal and movement behavior from build 437 remain unchanged.

## Verification

- **19 passed, 0 failed, 0 skipped** in UXPolishTests, including distance, flick, phone-size, reversal and finger-following regression coverage. Result: /Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T16-37-11-719Z_pid60283_aa75d534.xcresult. These checks verify gesture behavior; the physical haptic was not felt in the simulator.
- Native and backend input hashes are frozen in /tmp/ubeye-438-source-freeze.json and /tmp/ubeye-438-backend-freeze.json. Production source differences from build 437 are confined to the dismissal haptic handling in StoryStackViewer.swift and build number configuration. All 253 backend/component inputs match release 437; no Vercel redeployment is necessary.

## Delivery

Signed archive **1.0.12 (438)** succeeded, with embedded version and strict deep code-signature checks passed. The existing skipped App Intents metadata extraction warning remains. Archive: /tmp/ubeye-testflight-438/UBEYE.xcarchive. Evidence: /tmp/ubeye-testflight-438-archive.log.

App Store Connect accepted **1.0.12 (438)** at **2026-09-14 16:39:49 UTC**, reporting **Uploaded package is processing**, **Upload succeeded** and **EXPORT SUCCEEDED**, with exit code 0. Evidence: /tmp/ubeye-testflight-438-upload.log. Tester availability depends on Apple processing and has not been separately confirmed.

All 59 native and 253 backend/component frozen inputs remained unchanged through archive and upload. `git diff --check` passed.

Existing workspace changes are preserved. No Git commit or push was made.
