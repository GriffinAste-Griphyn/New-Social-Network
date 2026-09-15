# Upload counter fix — 1.0.12 (429)

The upload banner previously calculated completed stories as the selected total minus the currently pending stories. Release 428 starts transfers while later stories are still being prepared, so that calculation mistakenly credited unstaged stories as completed. Adding those stories to the queue made the counter and progress fall backward. Renumbering after preparation could also change positions and totals after a transfer had started.

The app now starts a batch with a fixed selected total and records each successful completion explicitly. Adding pending stories, preparation failures, removal and retries do not count as completions. The banner stays available between early completions and the next staged story. Preparation uses a separate unnumbered label, and finishing preparation preserves original positions and the selected total. Batch progress holds its highest measured value through retries.

Batch completion records and progress are saved atomically alongside pending uploads, preserving them across app restarts. Existing array manifests remain readable; because those older manifests have no completion records, missing entries are not guessed to be successful. Interrupted preparation and unavailable items are reported without manufacturing completions.

Preparation still overlaps serial transfers, and navigation callbacks still wait until the selected batch has been staged. Media quality, worker capacity and backend deployments are unchanged.

## Validation

49 simulator upload tests passed, with zero failures or skips. Nine new regression tests cover a growing queue, sequential and duplicate completion callbacks, retries, failed preparation, removal, missing files, recovery, legacy manifest migration and an entirely unprepared batch. Existing transfer ordering, deferred registration, upload recovery, video quality and resumable transfer tests passed.

The first test build failed with linker errno 28 because the Mac had only approximately 145 MiB free. Rebuildable project output was cleared, preserving source files, release archives and release logs, and the test run then passed.

## Delivery

No Vercel redeploy is needed for this iOS-only fix.

TestFlight 1.0.12 (429) was uploaded successfully. App Store Connect reported the uploaded package is processing on September 14, 2026 at 01:48:00 UTC. Tester availability remains subject to Apple completing processing.

The release archive passed strict code signature verification, and its embedded version/build were verified as 1.0.12 / 429. All 40 frozen app source/configuration files matched the archived inputs.

Archive: `/tmp/ubeye-testflight-429/UBEYE.xcarchive`.
Archive log: `/tmp/ubeye-testflight-429-archive.log`.
Upload log: `/tmp/ubeye-testflight-429-upload.log` (`Upload succeeded` and `EXPORT SUCCEEDED`).
Source snapshot: `/tmp/ubeye-429-source-freeze.json`.
Simulator result: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T01-44-51-355Z_pid70024_b83e5990.xcresult`.

Real-device testing of the counter has not been performed during this release.
