# Media swipe dismissal — 1.0.12 (437)

Downward media swipes now use a fixed viewport coordinate space while the media moves. The viewer no longer rejects short flicks through the separate 58-point end-handler gate, locks out downward intent after an initial sideways movement, or rechecks diagonal dominance after claiming the vertical gesture. Deliberate drag dismissal requires 7% of the viewport, bounded to 44–72 points, instead of 14%, bounded to 72–132 points. Movement follows the finger without the previous resistance after 62% of the viewport, and reversing a drag restores the media position.

Successful dismissal calls the presentation dismissal immediately. The separate spring fly-out and 110 ms sleep are removed. Dismissal stops story progress, clears pending completion, and records the impression asynchronously. Upward swipe behavior retains its 58-point threshold. Small accidental drags still cancel.

## Verification

- **30 passed, 0 failed, 0 skipped** across UXPolishTests and PlaybackPolishTests. Includes short flick end-handler regression, deliberate drags across phone sizes, accidental/reversed/horizontal gesture rejection, finger-following offsets, video reentry and playback pool reversal coverage. Result: /Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T16-14-23-844Z_pid54000_40b71baf.xcresult.
- Before the fix, the running build logged a 44-point, 100 ms downward gesture as unclaimed/ignored. After the fix, the same controlled gesture is claimed vertically and cancels below the distance/velocity threshold. A deliberate 79-point, 600 ms drag and a 306-point, 150 ms swipe both log dismissed and return the simulator to the feed. The viewer reopens correctly. Evidence: /tmp/ubeye-437-gesture-verification.log. Simulator: iPhone 16 Pro, iOS 26.1. No physical-device frame pacing measurements were made.
- Signed release archive succeeded and embedded version **1.0.12 (437)** and strict deep code-signature verification passed. Archive: /tmp/ubeye-testflight-437/UBEYE.xcarchive. Log: /tmp/ubeye-testflight-437-archive.log. Existing App Intents metadata extraction warning remains.
- All 59 native source/configuration inputs and 253 backend/component inputs are frozen in /tmp/ubeye-437-source-freeze.json and /tmp/ubeye-437-backend-freeze.json. Native production differences from build 436 are confined to StoryStackViewer.swift and the build number in the project configuration. UXPolishTests.swift contains the regression checks. Backend inputs match release 436, so no Vercel redeployment is required.

## Delivery

App Store Connect accepted **1.0.12 (437)** at **2026-09-14 16:18:49 UTC**, reporting **Uploaded package is processing**, **Upload succeeded** and **EXPORT SUCCEEDED**, with exit code 0. Evidence: /tmp/ubeye-testflight-437-upload.log. Tester availability depends on Apple processing and has not been separately confirmed.

All 59 native and 253 backend/component frozen inputs remained unchanged through archive and upload. `git diff --check` passed.

Existing workspace changes are preserved. No Git commit or push was made.
