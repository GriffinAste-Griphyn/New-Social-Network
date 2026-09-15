# Continuous media dismissal — build 439

The viewer follows the downward drag at its original size, then continues offscreen in one 240 ms velocity-aware animation. A geometry group resolves the movement once for the entire media-and-controls surface. The presentation is removed without a second system slide when that animation completes. The one-haptic-per-gesture behavior from 438 is retained.

Gesture recognition uses the fixed viewport. Media taps, pause, and swipe are composed simultaneously; header and bottom controls are excluded from media tap actions. Story changes suppress their own animation without suppressing the parent dismissal. Video playback pauses during the exit.

## Verification and release status

The final Debug application and test products compiled successfully. The app installed and launched on the iPhone 16 Pro simulator. A downward 79-point drag dismissed a playing video; logs show the exit beginning at 17:26:49.374 UTC and completing at 17:26:49.674 UTC. Native recording: `/tmp/ubeye-439-video-gesture.mp4`; inspected release frames: `/tmp/ubeye-439-native-release.jpg`. The 40-second native recording contains 2,077 frames. This verifies simulator behavior, not physical haptic feel or a device frame-rate guarantee.

The final UXPolishTests and PlaybackPolishTests run passed: **30 tests, 0 failures** (19 UX, 11 playback). Xcode reported TEST EXECUTE SUCCEEDED at 17:30 UTC. Result bundle: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T17-21-08-056Z_pid61748_6093dc77.xcresult`.

The first archive attempt failed with no space left on device. Old temporary archives and inactive build caches were removed. The retry succeeded using two compiler jobs and `CURRENT_PROJECT_VERSION=439`, preserving the concurrent project's build 440 configuration. The archive contains **1.0.12 (439)** and passed strict, deep code-signature verification. All frozen native implementation files still match the validated source; only concurrent build-number configuration changed. Archive log: `/tmp/ubeye-testflight-439-archive-final.log`. **App Store Connect accepted 1.0.12 (439) at 2026-09-14 17:38:09 UTC.** It reported Uploaded package is processing, Upload succeeded, and EXPORT SUCCEEDED (exit code 0). Availability to testers awaits Apple processing. Upload log: `/tmp/ubeye-testflight-439-upload.log`.

This change requires no backend deployment. Concurrent media-pipeline work is tracked in its own release. Existing source changes are preserved; no Git commit or push has been made.

The shared motion uses [SwiftUI geometry grouping](https://developer.apple.com/documentation/swiftui/view/geometrygroup()), so child media animation policies cannot resolve the parent slide independently.

Final `git diff --check` passed. The tested StoryStackViewer.swift SHA-256 is `5baf445fe50fcdf40156763e61bba3ab38ff9a2ccf1d26f29fe9ee83e44018b0`.
