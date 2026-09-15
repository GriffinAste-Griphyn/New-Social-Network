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

Build, native regression tests, simulator interaction checks, signed archive, and TestFlight upload outcomes are appended after completion. Simulator timings are regression evidence, not claims about physical-device smoothness or battery use.
