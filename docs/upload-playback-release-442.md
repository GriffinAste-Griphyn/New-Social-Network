# Concurrent upload and playback — build 442

This iOS release improves browsing during uploads. No backend routes or production deployment settings changed.

## Changes

- Permit at most one adjacent video preparation during an upload, only with a visible healthy player, a fresh measured download estimate of at least 8 Mbps, no Low Data Mode, and standard resource conditions. Unknown/slow connections, buffering and resource pressure continue to suspend speculative video preparation. Full offline/video downloads remain suspended during uploads.
- Separate the player pool’s new-work budget from its retention budget: previously prepared players remain reusable, while extra in-progress preparations outside the current budget are cancelled. The visible player remains exempt from the speculative limit.
- Throttle background transfer byte-progress callbacks to five per second within each PATCH, delivering first/final progress immediately. Report first bytes once per PATCH rather than on every byte-progress callback.
- Publish all upload progress fields in one array mutation. Story viewer updates compare presentation values and are delivered after the Published value commits, excluding bookkeeping-only mutations.
- Serialize recovery manifest writes. Periodic progress checkpoints encode and write on a utility queue; infrequent durable transitions still synchronously wait for their atomic save, preserving existing ownership and failure semantics. This change does not redesign background transfer recovery after process termination.

## Validation

188 simulator regression tests passed, zero failed, five fixture-dependent tests skipped. Suites: MediaPerformanceTests, PlaybackPolishTests, UXPolishTests, StoryUploadSchedulingTests, StoryUploadBatchProgressTests, StorySubmittedUploadTests, StoryUploadPerformanceTests.

New coverage exercises the measured-headroom safety gates, a burst of 1,000 progress callbacks, final progress delivery, queued-checkpoint ordering against queue removal, failed durable writes, and presentation equality. Existing tests cover source ownership, retries, cancellation, recovery, active player handoff and sustained navigation reversals.

Result: `/Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T18-16-19-278Z_pid91070_860272a4.xcresult`.

These tests establish correctness and bounded work, not a measured device latency or upload-throughput improvement. Simultaneous real-network upload and playback still needs comparative device measurements.

## Distribution

Build 1.0.12 (442) archived successfully. Strict/deep code-signature verification passed, and the native source hashes matched the manifest after archiving. Archive: `/tmp/ubeye-testflight-442/UBEYE.xcarchive`. Source hashes: `/tmp/ubeye-testflight-442/source-manifest.json`.

Apple accepted the upload on September 14, 2026 at **12:20:12 MDT** and reported **Uploaded package is processing / Upload succeeded**. Log: `/tmp/ubeye-testflight-442-upload.log`. TestFlight processing and tester availability have not yet been independently confirmed. No backend redeploy was needed. The directly installed phone build remains 441 until updated.
