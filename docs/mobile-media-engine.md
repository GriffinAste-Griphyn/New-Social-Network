# Mobile Media Engine Refactor

## Goal

Make story open, first frame, and playback continuity feel instant and predictable under real feed usage while preserving final media quality.

The refactor must move media work off the tap path. Opening a story should bind already-known metadata, already-warmed thumbnails, and preferably an already-prepared player. Network, cache, and decoder work should be scheduled by priority instead of being triggered independently by each view.

## Non-Goals

- Replace AVFoundation.
- Rewrite the whole feed or story viewer UI.
- Remove Cloudflare Stream. Cloudflare remains the high-quality adaptive playback path.

## Performance Targets

- Feed restore from disk: immediate shell from cached JSON when available.
- Story open p50: under 150 ms from tap to viewer shell.
- Video first frame p50: under 350 ms when player or asset is warm.
- Video first frame p95: under 900 ms on good Wi-Fi/LTE with Cloudflare-ready assets.
- Startup stalls: below 1% of video opens on non-constrained networks.

These should be measured with existing `MediaPerformance` events:

- `story_open`
- `story_open_warm`
- `story_stack_display_cache_hit`
- `video_startup`
- `video_item_ready`
- `video_first_frame`
- `video_stalled`
- `video_recovered`
- `video_player_pool_hit`
- `video_disk_cache_hit`
- `video_player_pool_hit`
- `video_retry`

## Architecture

### MediaEngine

App-level `ObservableObject` that owns:

- Story player pool.
- Intent-based story warming.
- Current stack media preheating.
- Cache lifecycle hooks.

This prevents `StoryStackViewer` from being the first owner of the player pool. Home and other feed surfaces can warm the exact story before presenting the fullscreen viewer.

### MediaPriority

Use explicit priorities for preheat work:

- `active`: current story item.
- `next`: next one or two story items.
- `previous`: previous item for back taps.
- `visible`: feed thumbnails/cards currently visible.
- `background`: speculative stack refresh.

### PlayerPool

Keep a small bounded set of prepared `AVPlayer` instances:

- One active player bound to the visible layer.
- Up to the remotely configured prepared-player limit for visible/adjacent stories.
- Seed one early playable video per initially visible stack after feed restoration.
- Keep one selectively prepared player on constrained/cellular connections.
- Prepared players are keyed by canonical media URL.
- Taking a prepared player preserves a completed preroll when it is already at the
  requested position; any seek invalidates that preroll.
- A bounded handoff timeout does not destroy in-flight preparation.

The viewer promotes the exact active source when launch warming missed. A successfully
prerolled player is attached and started immediately behind the poster rather than being
prerolled a second time. Cold players continue through the conservative readiness and
preroll path.

### MediaCache

Current cache layers stay, but scheduling is centralized:

- `MediaImageCache` for decoded thumbnails/images.
- `MediaFileDiskCache` for progressive media files and images.
- `AVPlayer`/`AVURLAsset` warming for the active item and a small adjacent window.

The progressive file cache intentionally does not persist `.m3u8` playlists. Launch-time
prefetch never starts a full `AVAssetDownloadURLSession` package download: AVFoundation's
streaming cache and a bounded prepared-player pool provide the useful warm path without
competing with visible playback for bandwidth or retaining multiple stories on disk.

### Feed Manifest

The mobile feed includes a bounded `initialStoryStacks` manifest keyed by requested story ID. The app seeds the existing story-stack memory/disk cache from this manifest, so opening an initially visible story can render from already-hydrated stack data. The full stack route remains the authoritative refresh path.

### Upload Renditions

Stories and media assets carry explicit playback and optional original rendition metadata:

1. Playback rendition: the Cloudflare Stream signed HLS URL used by feed/viewer playback.
2. Original rendition: optional archive metadata; it is never selected by the viewer or
   inserted into the player/preheat pools.

Every newly composed video goes through the owner-bound Cloudflare TUS pipeline, including
small H.264 MP4/M4V files. Compatible files can skip a local re-encode, but never skip
adaptive server transcoding. The creator sees a local optimistic preview while processing;
other users see the story only after full provider readiness and moderation approval.

The mobile API exposes the same `renditions.playback` and `renditions.original` shape on feed stories, stack stories, video completion responses, and cached stack manifests. iOS always renders from playback helpers and treats the original rendition as quality/archive metadata.

## Phased Implementation

1. Add app-level `MediaEngine` and move player ownership out of `StoryStackViewer`.
2. Route Home tap warming through `MediaEngine` before presenting the viewer.
3. Centralize story stack/media preheat APIs behind intent-based methods.
4. Add first-stack media manifest fields to feed responses and iOS models.
5. Tighten video upload strategy so only playback-optimized originals skip normalization.
6. Reduce high-frequency SwiftUI invalidation in story progress updates.
7. Add dual-rendition schema/API support for playback and original media metadata.
8. Add original-rendition background attach after normalized video upload.
9. Add network-aware prefetch throttling, memory-warning cleanup, and HLS package download groundwork.
10. Validate with iOS build/tests and Next lint/build where environment permits.

## Rollback Strategy

This work lives on `codex/mobile-media-engine-refactor`. Rollback is a branch switch away until merged. Each phase should be independently revertible by keeping boundaries narrow:

- Engine wiring in `MediaEngine.swift`, `RootView.swift`, `HomeView.swift`, `StoryStackViewer.swift`.
- Feed manifest changes in API route/model files.
- Upload rendition changes in composer/upload pipeline files.
- Dual-rendition storage changes in `0035_story_original_renditions.sql`, schema, story-store, and mobile API response builders.
- HLS package download support in `Theme.swift` and playback URL resolution in the media engine/viewer.
