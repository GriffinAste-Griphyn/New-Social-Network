# UX reliability — build 449

## Implemented

- **Account-scoped offline actions:** hashed account/origin ownership survives token rotation. Queue completion removes only the attempted operation, preserving newer/coalesced intent and other accounts. Authentication, transport, and rate-limit failures remain retryable; reconnect synchronization notifies the relevant screens.
- **Conversation state:** Replies groups interactions once per person and direction, sorts deterministically, and renders lazy rows. The inbox and open conversation observe one store. Optimistic deletion hides the affected item; a failed request restores only that item, preserving concurrent deletions and newly received replies. A refresh cannot overwrite a newer mutation.
- **Useful thread actions:** replaced the inactive chat composer with a working quote action for received replies. Removed unconditional delayed scroll-to-bottom calls, enlarged quote/delete controls, and kept the reply overlay within compact card bounds.
- **Scoped composer autosave:** draft persistence owns a cancellable, 300 ms debounce and skips identical snapshots. Only draft fields schedule writes. Editing completion, tab exit, backgrounding, and account changes flush the current draft. Preferences injection now applies to both reading and writing.
- **Tab lifecycle:** visited tabs retain navigation/content while refresh invalidations are combined and held while inactive. Home/Following prefetch entry points check visibility. Discover has one cancellable search task, cancels hidden searches, and handles cancellation without showing an error. Search/editor focus follows mounted-view lifecycle instead of fixed delays. Tab reselect scrolling respects Reduce Motion.
- **Focused components:** separated composer media preparation, draft persistence, posting store, and editing controls; separated playback policies, controller, and UIKit surfaces; separated story viewer interaction state and sheets; separated reply thread presentation from the inbox.

## Compatibility and data handling

Unscoped legacy queue/draft bytes remain on disk for recovery. They are not automatically assigned to whichever account signs in next. Version 2 records always include or derive account ownership. The current public App Store submission is not replaced by this TestFlight upload.

No backend source, API contract, database migration, or production configuration changed in this release. Backend redeployment is unnecessary.

## Verification

- Implementation commit `7c11c59` and visual follow-up `ac84065` were pushed to `origin/codex/branded-ios-skeleton-loading`.
- Full native regression suite: **284 executed, 280 passed, four optional media-fixture skips, zero failures**. Eleven new reliability cases cover account ownership, in-flight queue edits, rate limits/restart, scoped drafts, autosave coalescing, hidden refreshes, callback release, grouping, and independent deletion rollback.
- An older cancellation test initially failed because it guessed cleanup timing with a sleep. It now waits for the cancelled import task to finish; the full suite passed afterward.
- Feed decode gate passed: 50 samples, 22,286-byte/50-creator fixture, p95 **0.89 ms** against a 50 ms ceiling.
- The simulator check caught a clipped quote footer. The final layout moves the quote action into the visible thread header and adds bottom clearance to conversation content. That layout-only follow-up was rebuilt and visually checked after the full regression run.
- Simulator checks passed for populated feed launch; grouped Replies; opening/back navigation; quoting into the composer; returning across tabs; immediate Discover search input/filtering; and selected-photo overlay focus/editing. Temporary search/editing input and the local image fixture were cleared without posting. Camera/microphone capture was not exercised.
- Production service, image, and video health endpoints returned HTTP 200 with `ok: true`. No redeployment was needed.

Simulator timings are regression evidence, not claims about physical-device smoothness or battery use.

## Release completed — September 15, 2026

- Signed Release archive succeeded from native source commit `ac84065`.
- Code-signature verification passed. The archive contains `com.griffinaste.ubeye`, version **1.0.12**, build **449**.
- All **106 tracked native files** matched the SHA-256 source manifest after archiving.
- App Store Connect accepted the upload at **08:52:45 America/Denver**. Xcode reported `Uploaded package is processing.`, `Upload succeeded.`, and `EXPORT SUCCEEDED`.
- Apple processing and tester availability have not yet been verified. The existing public App Store submission was not changed.
- Release artifacts are preserved at `/Users/griffinaste/Library/Developer/UBEYE-Releases/449/`: signed archive, upload log, source manifest, test summary/log, benchmark report, production health responses, and simulator screenshot.
