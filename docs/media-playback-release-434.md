# Media navigation repair — 1.0.12 (434)

## Diagnosis

Read-only build 433 telemetry recorded 17 visible transitions averaging 76 ms, with a 337 ms forward video transition. Eight recorded video first frames averaged 35 ms; the slow first frame was a fresh player requiring 264 ms. These samples do not capture every hitch or establish a universal root cause.

A deterministic simulator regression reproduced a destination's staged player being destroyed between visible commit and checkout. The pool used permission to begin an active preparation as permission to retain an existing active preparation. During buffering, a budget observer could prune the destination and force a cold request. The original regression test failed both player-retention and handoff assertions.

Rapid return within the 180 ms deferred rewind window also cancelled the rewind and resumed the previous position. Cancelled seek/preroll operations could be mistaken for playback failures, causing recovery against the retained current player.

## Changes

- Publish destination intent synchronously before changing the visible index; defer expensive media preparation until after the visible commit as before.
- Retain an existing staged/completed/in-progress destination independently of permission to start new preparation. Preserve buffering, upload and resource limits on speculative work.
- Mark a retained player as needing rewind when it becomes hidden. Rewind before reporting readiness when it is revisited immediately; retain deferred rewinding for ordinary navigation.
- Install current callbacks and cancel deferred work before activating the player. Cancelled positioning, preroll and same-item recovery operations return without initiating failure recovery or clearing newer work.

## Validation and delivery

- Final simulator run: **145 passed, 0 failed, 0 skipped** across MediaPerformanceTests, PlaybackPolishTests and UXPolishTests. The optional source-quality exporter audit was excluded because encoding code is unchanged.
- Both new regressions pass. The rapid-return test uses a real on-screen AVPlayer and generated motion fixture, advances playback beyond 0.9 seconds, returns immediately and verifies the retained player rewinds to zero before a new ready callback. A detached-layer seek in the first test harness never completed; the final harness uses an attached player and real advancing playback, with bounded waits.
- Final result: /Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T04-17-17-668Z_pid38335_df4a2af8.xcresult.
- All 58 native inputs are frozen in /tmp/ubeye-434-source-freeze.json. Relative to release 433, only MediaEngine.swift, StoryStackViewer.swift and build configuration changed. All 228 backend/shared/configuration inputs match release 433; no server redeployment is required.
- Signed archive **1.0.12 (434)** succeeded and passed strict deep code-signature and embedded-version verification. Archive: /tmp/ubeye-testflight-434/UBEYE.xcarchive. Log: /tmp/ubeye-testflight-434-archive.log. The only archive warning is the existing skipped App Intents metadata extraction because the app does not depend on AppIntents.framework.
- App Store Connect accepted **1.0.12 (434)** at **2026-09-14 04:20:41 UTC**, reporting **Uploaded package is processing**, **Upload succeeded** and **EXPORT SUCCEEDED**, with exit code 0. Upload log: /tmp/ubeye-testflight-434-upload.log. Tester availability has not been separately confirmed and depends on Apple processing.
- All 58 native and 228 backend frozen inputs remained unchanged after upload. `git diff --check` passed. Existing working-tree changes were preserved; no Git commit or push was made.
- Production playback improvement has not yet been measured on the user's device.
