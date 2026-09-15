# Media selection repair — 1.0.12 (435)

## Problem and changes

Library selection previously presented no newly selected media until the entire ordered batch finished importing. Single-item downloads had no loading indication. Unmanaged picker tasks could continue after dismissal/discard or newer selection, then overwrite the current preview or clear the newer picker request. Image imports only supported file representations; a provider's supported image bytes were not tried after a file import failed.

The new request-scoped library loader publishes each successful import in order, displays the first valid item immediately, preserves the partial selection, and prevents older or cancelled requests from updating presentation. A late imported video from a cancelled request is removed from its owned temporary copy. The picker binding is cleared when that request is submitted, rather than by deferred cleanup from a potentially stale task.

While a library download is pending, the composer displays loading status instead of showing a misleading camera/previous selection. Discard and dismissal cancel pending presentation. Post and photo reframing stay disabled until the whole current batch is ready. Camera capture cannot compete with library import. Actual file copying and image decoding/preparation run off the main actor. If the image file transfer is unavailable or invalid, the composer also tries image bytes using the existing normalizer.

Video import still copies Photos' temporary file before returning from the transfer representation. Upload preparation and private early upload remain independent of selection display.

## Verification and delivery

- Final simulator suite: **52 passed, 0 failed, 0 skipped**, covering StoryLibrarySelectionTests, StoryUploadFastPathTests, StorySubmittedUploadTests, PlaybackPolishTests and UXPolishTests.
- Six new selection checks cover immediate first preview before a slow batch completes, ordering/partial failures, stale uncancellable imports, discard/late-file cleanup, real photo import surviving provider-file removal and actual on-screen video playback from an imported owned copy after the provider file disappears.
- Final result: /Users/griffinaste/Library/Developer/XcodeBuildMCP/workspaces/New-Social-Network-3e4c80c0b109/result-bundles/test_sim_2026-09-14T04-31-25-320Z_pid38335_19bac088.xcresult.
- All **59 native inputs** are frozen in /tmp/ubeye-435-source-freeze.json; the new regression test is frozen separately. Relative to release 434, only the composer, new selection loader and generated build configuration change. All 228 backend/shared/configuration inputs match release 434; no server redeployment is needed.
- Signed archive **1.0.12 (435)** succeeded and passed embedded-version and strict deep code-signature verification. Archive: /tmp/ubeye-testflight-435/UBEYE.xcarchive. Log: /tmp/ubeye-testflight-435-archive.log. The only archive warning is the existing skipped App Intents metadata extraction because the app does not depend on AppIntents.framework.
- App Store Connect accepted **1.0.12 (435)** at **2026-09-14 04:34:44 UTC**, reporting **Uploaded package is processing**, **Upload succeeded** and **EXPORT SUCCEEDED**, with exit code 0. Upload log: /tmp/ubeye-testflight-435-upload.log. Tester availability has not been separately confirmed and depends on Apple processing.
- All 59 native inputs, 228 backend inputs and the new regression test remained unchanged after upload. `git diff --check` passed. Existing working-tree changes were preserved; no Git commit or push was made.
- The user's specific Photos item/device failure has not been directly reproduced; fixture checks establish supported image/video import and presentation behavior. Photos/iCloud may still require time to download an item before it can be shown.
