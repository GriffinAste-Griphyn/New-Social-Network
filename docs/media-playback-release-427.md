# Media playback polish release 427

Version 1.0.12, build 427. Media config version `2026-09-13.7`.

## Implemented behavior

Story-open preparation now has a stored cancellable task and generation checks after both cache awaits. Opening another story, entering or leaving the viewer, clearing caches, and engine destruction invalidate obsolete work. Coalesced opens no longer restart adjacent-stack preparation. Late disk restoration cannot overwrite an active viewer's newer preparation intent.

Feed prediction restores cached metadata immediately. Repeated identical intent is coalesced for 250 ms; scrolling at four or more items/second waits 100 ms before speculative decoder/network work. Every asynchronous stage checks cancellation, viewer visibility, and the current power/upload resource budget. Existing directional feed prediction remains in use.

Explicit backward navigation reverses the bounded image and video preparation order: active, previous three, then the opposite-direction fallback. Constrained mode prepares the active item and one item in the intended direction; critical mode considers only the active item. Forward navigation still includes the next creators near the end of a stack, ahead of the previous-item fallback. Persistent player surfaces, stable mounted item identity, hidden mute/pause behavior, completed-only hidden checkout, and active player ownership are preserved.

Confirmed visible stalls reserve active playback bandwidth for a three-second cooldown. Up to three stalls in a rolling 60-second history raise the contiguous buffer required before speculative preparation resumes from two to four seconds. Confirmed stalls request three to five seconds of forward buffer on the active item only; prepared neighbors retain their existing two/four-second budgets. Network changes clear recovery and throughput history. Local playback bypasses the network recovery reserve; remaining stream duration caps the requirement so short clips and the end of a video do not need an impossible buffer. Current visible readiness, likely-to-keep-up status, and lack of an active stall remain mandatory. Cross-stack downloads stop under active buffering or upload pressure.

The app opts into the supported iPhone ProMotion refresh range through `CADisableMinimumFrameDurationOnPhone`. Photo progress requests the device's supported maximum in standard resource mode and prefers 60 Hz under resource pressure. Its display-link target weakly references the timer, and timer destruction invalidates the link. Existing gesture axis locking, dismissal velocity/distance rules, boundary feedback, interruptible animations, keyboard coordination, and pause/resume rules were retained and regression checked. [Apple ProMotion documentation](https://developer.apple.com/documentation/bundleresources/information-property-list/cadisableminimumframedurationonphone).

The existing interaction monitor now emits at most one aggregate per 60 active callback seconds or surface boundary. It separates resource/network changes, recognizes refresh-rate changes, explicitly interrupts sampling on background transitions, and counts long foreground freezes. Summaries contain callback count, delayed callbacks, cumulative excess delay, largest gap, surface and mode. This diagnostic measures main-thread callback cadence; it is not GPU frame delivery or proof of a sustained rendered frame rate. Existing bounded telemetry reporting controls apply.

The authenticated admin media page shows these summaries by build, network, device model, surface and resource mode, with weighted callback/time percentages and a preliminary label below 20 summaries. Backend casts validate bounded numeric metadata before aggregation. Migration 0058 adds the telemetry enum value and is registered in the production migration journal. Existing snapshots accept the optional new JSON field without a table change.

## Verification

- All 289 backend tests across 64 files passed. TypeScript, targeted ESLint, migration consistency and diff checks passed.
- A broader simulator pass completed 184 media, geometry, upload and gesture tests. After the final direction/image-preheat, timer cleanup and short-video adjustment, 139 affected tests passed. After the final foreground-freeze correction, all nine new playback-polish tests passed again.
- The new stress test executes 100 alternating-direction preparation/handoff/cleanup cycles. It verifies discarded player items are detached while pool cleanup preserves the checked-out active item. Exhaustive warm-order checks cover empty stacks, boundaries, reversal and all resource modes. Recovery tests cover repeated stalls, cooldown, expiry, local playback and short remaining duration. Cadence tests cover 60/120 Hz, refresh changes, background interruption and a 1.2-second foreground freeze.
- The new rollup query executed successfully against production, and production confirms the new enum value and migration hash. Numeric metadata remains bounded and invalid records are excluded.
- Existing actual encoder quality audits from build 426 were not repeated because encoding and quality validation code did not change. The previously slow simulator aspect-fit fixture was excluded from repeated runs; persistent-surface ownership, staged/completed handoff, hidden playback and geometry regressions were included.

## Physical-device evidence still needed

The registered iPhone was unavailable through `devicectl`, so this release does not claim physical-device frame pacing, camera quality, peak memory, thermal stability, or measured battery improvements. No private camera-roll footage was used. On the TestFlight build, the remaining device matrix is: repeated cold/warm story opens; fast photo/video/video/back switches; interactive dismiss and reply with the keyboard; those gestures during a large upload; a Wi-Fi/cellular change and poor-network stall recovery; a sustained 15-minute viewing session; and real indoor/outdoor, motion, HDR, 4K/60 fps and audio footage. Check 60 Hz and ProMotion hardware, Low Power Mode and rising thermal state. Capture Instruments frame/CPU/memory/energy profiles alongside the new admin summaries; compare like-for-like device/network cohorts.

## Delivery

Final production deployment `dpl_GPBFo4rArbadoJLVMNmHquocCbYL` is READY and serves https://www.ubeye.ai (deployment hostname `new-social-network-mvv98jj6o-griffin-astes-projects.vercel.app`). Health checks at 2026-09-14 00:34:03 UTC returned 200/ok for app, video and image endpoints, including signed playback 200. Anonymous admin access redirects to login (307); media config and cron endpoints return 401. The final deployment's initial error/fatal runtime-log query reported no entries.

The final signed archive succeeded at 2026-09-14 00:33 UTC and verifies version **1.0.12, build 427**, ProMotion opt-in, and strict/deep code signature. Source hashes were frozen before the final archive and verified before and after upload. App Store Connect accepted the upload at **2026-09-14 00:34:41 UTC**, reporting `Uploaded package is processing`, `Upload succeeded`, and `EXPORT SUCCEEDED`. Apple processing and availability to testers are not yet confirmed.

Archive: `/tmp/ubeye-testflight-427/UBEYE.xcarchive`. Final archive/upload logs: `/tmp/ubeye-testflight-427-archive-final.log` and `/tmp/ubeye-testflight-427-upload.log`. Deployment and sanitized health logs: `/tmp/ubeye-427-deploy-final.log` and `/tmp/ubeye-427-health-final.json`. The preliminary archive was preserved separately and was never uploaded. Database verification also exercised inline valid/malformed/oversized telemetry fixtures without inserting synthetic events; only the valid summary aggregated.
