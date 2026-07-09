# Production Media Pipeline Plan

Date: July 9, 2026

## Outcome

UBEYE media should behave like a modern short-form social product: creators can post
reliably on imperfect networks, every public video is delivered as adaptive HLS, the
viewer opens from already-warmed metadata and players, and publication never exposes
an unmoderated or partially transcoded asset.

This document is the release contract for the first production hardening pass. It
also records the follow-on work required to keep improving visual quality and latency
with real QoE data.

## Release invariants

1. A video upload is owned by the authenticated user from prepare through completion.
2. The client cannot complete an unknown, expired, consumed, or differently owned
   provider upload.
3. Completion is idempotent. Retrying the same completion returns the same story and
   media asset instead of creating duplicates.
4. Cloudflare Stream is the only public playback origin for newly uploaded videos.
   Source/original files are archival metadata and never enter the hot playback path.
5. Provider processing and content moderation are independent state machines.
6. A story becomes live only when provider processing is fully ready, structural
   validation passed, and moderation approved it.
7. A webhook arriving before client completion is durable state, not a lost event.
8. Public playback uses a signed adaptive HLS URL and a provider thumbnail; it never
   downloads a large progressive original to start playback.
9. Prefetch is intent-based and bounded. The active item and a small adjacent window
   receive resources; speculative full HLS package downloads are not part of launch.
10. Playback progress follows `AVPlayer` media time. Buffering pauses progress, end of
    media advances exactly once, and a prolonged stall performs a bounded recovery.

## State model

### Upload session

An upload session is created before the provider upload starts and contains:

- authenticated owner
- purpose and asset kind
- provider and provider upload key
- expected content type and byte size
- lifecycle state and expiration
- latest provider state, progress, and error
- resulting media asset and story identifiers after completion

The provider key is unique. Completion locks or atomically claims the session, validates
the owner and expected metadata, creates the media/story records, and stores the result.
Subsequent requests read that stored result.

### Media asset

The media asset has separate concerns:

- `processingStatus`: ingest/transcode lifecycle
- `providerStatus`, `providerPctComplete`, `providerError`: provider observation
- `scanStatus`, `scanReason`: structural/content moderation lifecycle
- `readyAt`: provider readiness timestamp only

Moderation is not allowed to write provider status, provider progress, provider errors,
or provider readiness timestamps.

### Story publication

Publication is a derived transition:

```text
provider fully ready
  AND structural scan passed
  AND moderation approved
  AND story not expired/deleted
    -> story live
```

Webhook delivery, status polling, completion, and moderation approval all call the same
reconciliation rule. This makes event ordering irrelevant and repairs earlier partial
states instead of relying on one happy-path sequence.

## iOS ingest

1. Capture portrait video at 1080p/30 fps with a network-appropriate source bitrate.
   Avoid generating an 18 Mbps source when the delivery ladder cannot benefit from it.
2. Normalize only when container/codec/geometry requires it; keep passthrough exports
   when AVFoundation can produce a provider-compatible result without re-encoding.
3. Prepare the owner-bound Cloudflare upload session.
4. Upload with TUS chunks and persist enough local state to resume after a transient
   network interruption or app relaunch.
5. Keep file I/O and checksum/chunk preparation off the main actor.
6. Complete with the server session/provider key. Treat a repeated completion as success.
7. Show the creator's local file as an optimistic preview while server processing and
   moderation continue. Other users see the story only after publication reconciliation.

## iOS playback

1. Resolve only the playback rendition for viewing. The original rendition is not a
   quality override.
2. Warm metadata and the player item before presentation when user intent is known.
3. Keep one active player and a small adjacent pool keyed by canonical playback URL.
4. Never prune the requested player before acquisition.
5. Prefer short forward buffering and adaptive startup limits over full-package
   speculative downloads.
6. Observe player time, time-control status, item status, failure notifications, and
   end-of-item notifications as the playback source of truth.
7. Record first frame only after the video output/layer is visibly ready.
8. On a prolonged stall, attempt one bounded seek/play recovery, then rebuild the item
   once before presenting a retry state.

## Images and thumbnails

- Upload a display image plus bounded derivatives and placeholder metadata.
- Use decoded-memory and byte-bounded disk caches with request coalescing.
- Prefetch visible/adjacent thumbnails, not an unbounded feed window.
- Use the Stream thumbnail for video placeholders so the transition to HLS is stable.
- A later release should add server-side format negotiation and measured AVIF/WebP/JPEG
  quality ladders once production device and bandwidth distributions are available.

## QoE service levels

The production dashboards should segment these by app build, connection class, device,
media duration, warm/cold state, and provider delivery type.

| Metric | Initial target |
| --- | ---: |
| Warm story shell p50 | < 150 ms |
| Warm video first frame p50 | < 350 ms |
| Good-network video first frame p95 | < 900 ms |
| Startup failure rate | < 0.5% |
| Sessions with a rebuffer | < 1% on unconstrained networks |
| Upload completion success | > 99% excluding explicit cancellation |
| Duplicate story creation from retries | 0 |
| Public progressive-original video playback | 0 |
| Story live before full transcode + approval | 0 |

## Validation matrix

### Backend

- schema and migration consistency
- upload prepare ownership and expiration
- wrong-user and unknown-provider completion rejection
- duplicate completion idempotency
- webhook-before-completion reconciliation
- provider error propagation
- moderation-before-provider and provider-before-moderation ordering
- lint, unit/API tests, and production build

### iOS

- MP4, MOV, HEVC, and large-video ingest selection
- TUS transient failure/resume and duplicate completion
- local optimistic preview while processing
- cold and warm HLS first frame
- active/prepared player acquisition
- pause/resume and buffering progress
- end-of-item advancement exactly once
- stall recovery and terminal retry state
- constrained/cellular prefetch limits
- Debug simulator build and signed Release archive

## Deployment order

1. Run all local quality gates.
2. Create a release snapshot containing only the reviewed implementation.
3. Apply the additive database migration to production.
4. Verify schema state and existing media rows.
5. Deploy a Vercel preview from the release snapshot and run health/API smoke checks.
6. Promote the exact verified artifact to production.
7. Verify `/api/health`, `/api/health/video`, upload authorization behavior, and runtime
   logs without creating public test content.
8. Increment the iOS build number, archive with the App Store profile, export/upload to
   App Store Connect, and confirm processing acceptance.
9. Monitor error rate, upload failures, first-frame latency, and stalls by build.

## Rollback

- The database migration is additive so the preceding backend remains compatible during
  a rollback window.
- Roll back the Vercel deployment if health checks, auth behavior, or media reconciliation
  regress. Do not drop the new table/indexes during an incident.
- The iOS rollout can be held in TestFlight while the preceding build remains available.
- Runtime media limits stay server-configurable so prefetch/player pressure can be reduced
  without another App Store build.

## Follow-on phases

This release fixes correctness and the largest playback/upload latency traps. Reaching
TikTok/Instagram scale remains an iterative program:

1. Build QoE dashboards and automatic regression alerts from production events.
2. Add a durable media-job queue for multi-frame moderation, perceptual quality checks,
   and retryable provider reconciliation.
3. Add byte-budgeted cache eviction informed by device storage pressure and actual reuse.
4. Tune the Cloudflare encoding/delivery profile from VMAF/SSIM and startup measurements.
5. Add image format negotiation and quality ladders backed by visual evaluation.
6. Introduce cursor-based feed candidate generation and CDN-friendly manifests so feed
   depth does not cap discovery quality.
7. Run controlled experiments for prefetch window, startup bitrate, buffer duration, and
   thumbnail timing instead of hard-coding one global strategy.
