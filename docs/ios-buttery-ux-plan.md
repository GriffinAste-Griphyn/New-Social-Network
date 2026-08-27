# UBEYE iOS buttery UX implementation plan

## Goal

Make the native iPhone client feel immediate, predictable, resilient, and physically responsive while preserving the existing media pipeline and its performance guarantees. The deployment target remains iOS 17, so the implementation uses APIs available on iOS 17 and progressively enhances newer systems only when safe.

## Baseline confirmed before implementation

- Native SwiftUI client with one `NavigationStack` per primary surface and a custom bottom bar.
- Disk-cached feed and story-stack responses, stable media sizing, image downsampling, thumbnail preheating, adjacent-story prefetch, buffered story media, HLS caching, and playback instrumentation.
- Skeletons for the major initial-loading surfaces.
- Background-resumable uploads, optimistic pending-story cards, visible upload progress, and interrupted-upload recovery.
- Keyboard-aware story replies and composer overlays.
- Pagination for the following feed and story viewers.
- Baseline simulator suite: 93 tests passing.

## Implementation matrix

### 1. App shell and navigation continuity

- Replace destructive top-level tab switching with a persistent SwiftUI tab container so each tab keeps its view state, scroll position, navigation history, search query, and composer state.
- Persist the selected tab for scene restoration.
- Add a single tab-selection policy:
  - first tap switches tabs with restrained motion;
  - tapping the active tab emits a reselect event;
  - reselect pops that tab to its root and scrolls to its top;
  - feed tabs also refresh without blanking cached content.
- Keep story viewers as full-screen presentations so story playback is isolated from tab lifetime.

Acceptance criteria:

- Switching away from and back to Home, Following, Discover, Replies, or Post preserves the exact in-memory state.
- Reselecting a tab returns to the root/top and refreshes without showing a full-screen spinner.
- Bottom-bar targets remain at least 44 points and expose selected state to VoiceOver.

### 2. Unified physical feedback and motion

- Add branded press styles for primary, icon, media, and bottom-bar controls.
- Add centralized selection, impact, success, warning, and error haptics.
- Use quick spring or snappy motion for direct manipulation and short ease transitions for transient status.
- Respect Reduce Motion by removing scale travel and using opacity-only feedback.

Acceptance criteria:

- Important taps acknowledge immediately, before any network result.
- Frequent actions never wait for a long decorative animation.
- Reduce Motion users receive equivalent state feedback without spatial movement.

### 3. Connectivity and resilient state

- Make the existing network monitor observable and publish connected, constrained, cellular, and expensive-path changes.
- Add a non-blocking global offline banner and a short reconnection confirmation.
- Keep cached content interactive when refresh fails; surface refresh failures inline instead of replacing the screen.
- Preserve existing background media uploads and interrupted-upload recovery.
- Queue lightweight social actions that are safe to retry, then reconcile them when connectivity returns.

Acceptance criteria:

- Going offline never clears a previously rendered feed.
- Users can distinguish offline, delayed, failed, uploading, processing, and ready states.
- Retriable social actions reconcile after reconnection and failures roll back optimistic UI when appropriate.

### 4. Feed stability and scrolling

- Retain fixed media aspect/layout reservations and stable identifiers.
- Add per-tab scroll anchors and reselect-to-top behavior.
- Keep lazy containers and avoid broad animated updates on feed replacement.
- Continue preheating visible and adjacent media while respecting constrained-network limits.
- Add explicit inline next-page retry/status behavior where pagination currently fails silently.

Acceptance criteria:

- No layout jump occurs when thumbnails, avatars, upload progress, or cached/network data resolve.
- Returning from a story lands at the same feed position.
- Pagination failure does not destroy existing content and can be retried.

### 5. Story viewer interaction model

- Preserve left/right tap navigation and press-to-pause.
- Add center-tap chrome reveal/hide.
- Add double-tap heart reaction with immediate visual/haptic confirmation and background reconciliation.
- Add interactive downward drag with distance/velocity completion and spring-back cancellation.
- Preserve swipe-up-to-reply behavior.
- Add user-controlled mute with persisted preference while retaining muted preroll during frame preparation.
- Keep adjacent media buffered, images visible until decoded, and videos paused offscreen.

Acceptance criteria:

- Gestures have clear precedence and do not accidentally trigger both navigation and reaction.
- Dragging down tracks the finger, then either dismisses or returns smoothly.
- Muting persists between stories and launches; preroll never leaks audio.
- Viewer controls remain accessible without relying on gestures alone.

### 6. Optimistic social interactions

- Follow/unfollow state changes immediately and rolls back on a terminal server failure.
- Reply deletion remains optimistic and gains consistent feedback.
- Reactions acknowledge instantly and submit independently of the text-reply state.
- Destructive story/account actions continue to require confirmation.

Acceptance criteria:

- No follow, unfollow, reaction, or delete tap appears ignored.
- Duplicate requests are suppressed.
- Failed optimistic mutations restore the previous state and explain the failure inline.

### 7. Composer and keyboard resilience

- Preserve the live camera/composer instance across tab switches.
- Preserve caption, tags, overlays, links, quoted replies, and selected media during accidental navigation.
- Continue transferring uploads to the app-level upload coordinator so users can leave the composer safely.
- Add haptic capture/record/post feedback and clearer enabled/disabled pressed states.
- Keep controls above the keyboard without re-laying out the camera canvas.

Acceptance criteria:

- Leaving the Post tab and returning does not discard an unfinished story.
- Starting an upload immediately returns to Home while progress stays attached to My Story.
- Capture, recording, validation failure, upload start, and completion each have distinct feedback.

### 8. Replies and drafts

- Preserve reply-list navigation and scroll state through tab switches.
- Persist unsent story-reply drafts per story item and clear them only after a successful send.
- Keep send controls reachable above the keyboard and suppress duplicate sends.
- Add scroll-to-latest and send feedback without animating the entire thread.

Acceptance criteria:

- Dismissing and reopening a story restores its unsent reply.
- A successful send clears the correct draft; a failed send retains it.

### 9. Accessibility and ergonomics

- Normalize interactive hit areas to 44 points or larger while preserving visual sizing.
- Add selected/value traits and concise hints for tab, story, mute, reaction, retry, and upload controls.
- Respect Dynamic Type where controls can grow and retain minimum scale/line limits where full-screen chrome cannot.
- Preserve all gesture actions as visible buttons or fields.

### 10. Verification, rollout, and release

- Add deterministic policy tests for tab reselection, dismiss thresholds, optimistic rollback, draft persistence, and mute preference behavior.
- Run the full iOS simulator test suite, a Release device build, and visual simulator checks for auth shell, tab shell, composer, and story viewer fixtures.
- Run the Next.js unit suite, lint, and production build because the branch also contains backend/media-pipeline changes that will be deployed with this release.
- Deploy production to the linked Vercel project and verify health plus the mobile feed/media contract.
- Increment the iOS build number, archive with the App Store profile, validate/export, and upload to App Store Connect for TestFlight.

## Performance guardrails

- No image decoding, media normalization, or sorting is added to SwiftUI `body` evaluation.
- List identity remains domain-ID based.
- Persistent tab state must not start camera capture or redundant network tasks for inactive tabs.
- Haptics are prepared lazily and never block the main interaction.
- Animations are localized; cached/network feed replacement remains transactionally unanimated.
- Story drag transforms avoid blur and live shadow changes while the gesture is active.

## Release gates

1. All unit tests pass.
2. Debug simulator build launches and produces no new runtime errors.
3. Release device build and signed archive succeed.
4. Production web/API deployment is healthy.
5. App Store Connect accepts the uploaded build and reports it processing or ready for TestFlight.
