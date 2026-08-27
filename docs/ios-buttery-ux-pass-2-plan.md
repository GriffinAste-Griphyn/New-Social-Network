# iOS Buttery UX — Pass 2

This pass turns the second-round polish ideas into measurable, iOS 17-compatible behavior. It builds on the persistent tab host, media cache/player pool, story prewarming, skeleton loading, offline queueing, press feedback, and draft persistence already in the app.

## Acceptance matrix

| # | Goal | Implementation | Acceptance signal |
|---|---|---|---|
| 1 | Predictive media preparation | Reprioritize image/story work from the user's visible direction; keep active/next/previous story media warm when resources allow. | The next intended story is prepared before navigation and obsolete queued work is discarded. |
| 2 | Interruptible animation | Central motion policy selects interactive springs or short crossfades based on Reduce Motion and device pressure. | Dismiss/reveal animations reverse cleanly without queued animation tails. |
| 3 | Gesture continuity | Story dismissal position, scale, opacity, and corner treatment are all derived from one normalized gesture progress value. | Cancelling a drag returns from its exact current state; completing continues from it. |
| 4 | 120 Hz discipline | A scoped display-link monitor records frame hitches only while interaction-heavy surfaces are active. | Story-viewer hitches are observable without a permanent polling cost. |
| 5 | Direction/velocity-aware prefetch | A pure directional intent policy predicts a small forward/backward window and varies its depth by resource mode. | Fast forward browsing prepares farther ahead; reversals reprioritize immediately. |
| 6 | Navigation memory | Keep visited tab trees alive and persist the Home feed's semantic scroll anchor per scene. | Switching tabs preserves state; reopening the scene restores a meaningful feed position. |
| 7 | Keyboard/composer feel | Match keyboard timing, retain per-story drafts, instrument focus-to-keyboard latency, and keep the composer attached to the keyboard. | No jump when the keyboard appears; unsent text survives navigation. |
| 8 | Edge-aware gesture arbitration | Classify drag axis before claiming the story gesture and require vertical dominance. | Vertical story actions do not steal horizontal/system gestures. |
| 9 | Progressive visual quality | Promote stable media through ThumbHash/placeholder → thumbnail → full-resolution stages in a fixed frame. | No blank flash or geometry shift while quality improves. |
| 10 | Haptic vocabulary | Reuse prepared generators for selection, snap/boundary, impact, success, warning, and failure. | Repeated interactions have consistent, low-latency tactile semantics. |
| 11 | Undo over destructive friction | Optimistically remove a story, show a timed Undo affordance, and commit deletion only after the window expires. | Undo restores the exact item/index; committed deletes still invalidate caches and feeds. |
| 12 | One-handed ergonomics | Keep primary story actions and reply controls in the lower thumb zone; swipe-up focuses reply. | Common reply/send/dismiss actions remain reachable without hand repositioning. |
| 13 | Adaptive behavior | Observe Low Power Mode, thermal state, memory pressure, and constrained networking to scale buffers and effects. | Critical pressure leaves only active media; normal mode restores richer preparation. |
| 14 | Perceived loading | Replace indeterminate black loading with a stable story-shaped loading shell. | Loading preserves the final hierarchy and dimensions. |
| 15 | Accessibility | Add story navigation actions, semantic labels/values, Dynamic Type-safe core controls, Reduce Motion, and Reduce Transparency behavior. | VoiceOver can navigate/react/dismiss without spatial taps; motion/transparency preferences are honored. |
| 16 | Contextual onboarding | Show a short, one-time story gesture hint, then persist dismissal. | The hint appears only when useful and never becomes recurring chrome. |
| 17 | Visual stability | Preserve media frame geometry and keep the previous/best stage visible until the next stage is decoded. | Images never collapse, resize, or flash empty during swaps. |
| 18 | Responsiveness metrics | Upload allowlisted tap-to-visible, keyboard, gesture outcome, image-stage, hitch, undo, resource, and prefetch events. | Regressions can be segmented by build/device/network and reproduced from named surfaces. |

## Verification gate

1. Unit-test gesture thresholds, adaptive modes, buffer depth, directional prediction, and deletion replacement.
2. Build the Debug simulator target and run the complete iOS unit-test bundle.
3. Exercise Home → story → reply → swipe/cancel → delete/undo on Simulator, including Reduce Motion.
4. Review SwiftUI hot paths for body-time allocation, accidental animation scope, and unbounded work.
5. Bump the build number, archive/export with App Store signing, upload to TestFlight, commit, and push.
6. Redeploy Vercel only if a server or web artifact changes; an iOS-only pass must not create an unnecessary production deployment.
