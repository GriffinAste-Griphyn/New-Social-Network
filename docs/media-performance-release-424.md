# Media preheating release 424

## Behavior

Build 424 keeps the next mounted video's first decoded frame in a persistent `AspectFitPlayerView`/`AVPlayerLayer`. The prepared player and its exact display surface travel together through staged, completed, and visible handoffs; host cleanup never detaches a surface already moved to its new host. Stable item IDs retain the mounted adjacent views across story navigation.

Only the visible video owns the active playback budget. Hidden views claim completed preparations without taking an in-progress preroll or starting a fresh playback download. They remain paused, muted, and at low network priority on iOS 26. The pool tracks checked-out players weakly to prevent duplicate preparation of a player already owned by a mounted view, and clears dead ownership records during preparation. Cleanup releases the item and surface; a late canceled builder preserves a handed-off player but disposes work it still owns.

Buffering stops new speculative work and cancels staged downloads, while completed players within the current look-ahead and retention budget survive. The standard connection policy prepares one player with unknown history, two with measured history, or three at >=8 Mbps; constrained resource/network paths remain at most one. Runtime-config limits still take precedence. At >=8 Mbps, preparation can resume after one healthy buffered second rather than two, with visible readiness, no stall, and `isPlaybackLikelyToKeepUp` still required. Slower/unknown paths retain the two-second requirement. Connection and power/thermal changes, and bandwidth threshold crossings, recompute the window.

Look-ahead prioritizes three forward items. Near the last two items of a stack it includes the first playable video of the next two predicted stacks ahead of backward preparation. Home prediction prioritizes the next two stacks before the previous stack. Cached stack metadata is reused; missing metadata is loaded through the existing authenticated API. Generation checks and cancellation prevent an obsolete request from replacing the current intent. Cross-stack preparation does not change story navigation or visibility permissions.

After item navigation, look-ahead scheduling yields to the visible state commit instead of waiting 180 ms. Expensive player construction remains asynchronous. Completed players already held by a buffered destination are not constructed again.

## Timing and rollout

`video_first_frame` is emitted for visible playback, with bounded `layer_ready_ms`, `attachment_ms`, `preroll_ms`, and `preparation_ms` metadata. The first three describe the preparation attempt; `preparation_ms` carries the original pool preparation duration. Hidden readiness is not counted as visible first-frame performance. Activation of a warmed view restarts the visible startup clock, while `story_transition_visible` continues measuring from navigation input to destination readiness. The existing admin media startup/quality cohorts remain available.

Media config version is `2026-09-13.4`. Adaptive-start cohort selection remains 20%; build 424 permits a standard preparation limit of three in that cohort, and older cohort builds retain two. Existing environment overrides can lower the limit. Quality hints, moderation, publication, storage providers, and upload encoding settings are unchanged by this release.

## Verification

122 selected iOS media/geometry/runtime tests pass, including an encoded-video fixture that verifies actual first-frame readiness survives layer reparenting, hidden playback stays paused and muted, visible activation reuses the player, and subsequent preparation does not rebuild it. Coverage also includes retained completed players versus canceled staged downloads, completed-only checkout, visible budget ownership, measured bandwidth thresholds, and cross-stack ordering under standard/constrained/critical resource modes. The simulator fixture reported a ready persistent-layer handoff in 0.23 ms and a rounded visible activation of 0 ms; these are controlled local checks, not real-device/network benchmarks or a guarantee of instant uncached playback.

280 backend tests pass. TypeScript, targeted ESLint, and diff checks pass. No new warnings were introduced; the initial clean test build retained six existing unused-upload-result warnings in upload tests. Four focused tests passed again after the final activation buffer guard and visible-only quality-monitoring guard. Activation evaluates the healthy-buffer policy before permitting additional speculative work.

Production deployment `dpl_4Uhb6bNZxGR7TmTATKWF5hMovJP3` is READY and serves https://www.ubeye.ai. App health, Cloudflare R2 image health, and signed Cloudflare Stream playback checks passed at 2026-09-13 21:29 UTC. The live admin page redirects anonymous requests to login, the media config and cron endpoints return 401 without authentication, and the preview benchmark remains unavailable (404). Initial deployment runtime checks reported no error/fatal logs. The media config version environment setting was updated to `2026-09-13.4` before deployment.

The final signed archive succeeded at 2026-09-13 21:32:58 UTC and confirms **version 1.0.12, build 424**. App Store Connect accepted the upload at **2026-09-13 21:34:07 UTC**, reporting `Uploaded package is processing`, `Upload succeeded`, and `EXPORT SUCCEEDED`. Apple processing and tester availability were not yet confirmed at delivery. The archive is `/tmp/ubeye-testflight-424/UBEYE.xcarchive`; final logs are `/tmp/ubeye-testflight-424-archive.log` and `/tmp/ubeye-testflight-424-upload.log`.
