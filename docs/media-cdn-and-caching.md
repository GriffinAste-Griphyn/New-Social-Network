# Media CDN and caching

Date: August 23, 2026

## Request path

The mobile media path is intentionally layered:

1. `MediaImageCache` keeps decoded, downsampled `UIImage` instances in a cost-bounded `NSCache`.
2. `MediaFileDiskCache` keeps progressive images and videos in an LRU bounded by bytes and available device capacity.
3. `URLCache` and AVFoundation retain transport-level responses and bounded HLS state.
4. The custom pipeline serves opaque, immutable adaptive HLS from a public
   Vercel Blob store; a separate private Blob store retains originals.
5. The origin route authorizes private media and never exposes an unsigned original.

HLS playlists are not copied into the progressive file cache. A playlist without its
segment and key graph is not an offline asset and stale signed manifests are actively
harmful. Prepared players are the primary warm path. A separate, system-managed
`AVAssetDownloadURLSession` cache may retain at most two complete predicted VOD packages;
it never stores a standalone manifest.

## Images

`MOBILE_IMAGE_DERIVATIVE_UPLOAD_ENABLED` defaults to enabled. A post produces a display
and thumbnail derivative before completion and sends a tiny JPEG data URL as inline
placeholder metadata. The playback manifest uses the derivatives and retains the
original only as archive metadata.

Image delivery uses a stable authorized JPEG route as the canonical URL. Private-media
responses use private cache directives bounded by the access-token lifetime; they are
never marked public or immutable. Generated canvases use a darkened blurred fill instead
of baked black bars.

Current image delivery uses:

- display: maximum 1080 x 1920 and 1.5 MB;
- thumbnail: maximum 360 x 640 and 150 KB;
- placeholder: 18 x 32 JPEG data URL, capped at 16 KB;
- server JPEG fallback for old clients only.

Clients encode each derivative with a descending quality ladder and select the highest
result within its byte budget. Web story playback uses Next.js quality 85, explicitly
allowlisted in `next.config.ts` as required by Next.js 16.

The iOS decoder uses ImageIO in a detached utility task and creates a thumbnail at the render budget before publishing a `UIImage` to the main actor. AVIF is accepted by the disk cache on supported iOS versions.

The repository does not yet run a separate imgproxy service. Add it only as a Vercel-managed service or route it through the existing Vercel deployment; do not put unsigned private Blob URLs into transformation query strings. A production transform must authorize the source first, clamp width/height/quality, strip metadata, and sign the transformation URL.

## Video startup

The versioned FFmpeg workflow owns the 360p, 540p, 720p, and 1080p bitrate
ladder, omitting levels that would upscale the source. iOS applies a startup
peak bitrate and maximum resolution while the first frame is hidden, then
`MediaPlaybackQuality.relaxStreamingHints` removes both limits immediately
after `video_first_frame`.

Cold and merely staged players use the latency-safe profile: 3 Mbps / 720 x 1280 on
standard paths and 2 Mbps / 540 x 960 on constrained paths. Ready or successfully
prerolled players use 8.256 Mbps / 1080 x 1920 on strong, non-cellular,
non-expensive paths. Prepared playback falls back to 2 Mbps / 540 x 960 when the path
is constrained, cellular, or expensive. These are startup ceilings only; full adaptive
quality resumes after the first frame.

After the cached feed restores, iOS selectively prepares one early playable video from
each initially visible story stack, bounded by the runtime player limit. A successful
AVFoundation preroll is carried through pool handoff and reused by the viewer. The viewer
only uses immediate playback after that successful preroll; an unprepared video retains
the conservative cold-start path. Constrained/cellular sessions prepare at most one
speculative player.

If background preparation is still in progress, the pool publishes the player at the
staged-item boundary and transfers that exact player to the viewer. The viewer continues
readiness and preroll on the same item, avoiding the former handoff wait and duplicate
manifest/segment request. Preparation no longer loads asset duration on the startup path.

Finger-down prediction and pre-publication embedded-stack warming move exact-story work
ahead of navigation. Full HLS package downloads are limited to assets with a known
duration of 30 seconds or less, wait for a 1.2-second idle window, use a
single discretionary Wi-Fi-only task, retain at most two assets / 128 MB for 24 hours,
and are cancelled when an active story viewer appears.

Targets:

- warm first frame p50 below 350 ms;
- good-network first frame p95 below 900 ms;
- startup stalls below 1%;
- no more than the server-configured prepared player count.

Stage telemetry includes `video_player_pool_wait`, `video_player_staged`,
`video_player_prepared`, `video_preroll_reused`, and `video_prerolled`, allowing cold,
staged, pooled, and offline-package starts to be compared independently.
Sampled `video_quality_ramp` events measure elapsed time from the revealed first frame
until the presented rendition reaches at least practical Full HD (or report timeout or
interruption), including presentation dimensions and AVFoundation indicated/observed
bitrate. The same per-playback QoE sampling decision governs both quality-ramp and final
access-log upload.

Normalized upload exports always retain the 8.256 Mbps quality envelope. Network state
changes upload scheduling and preheating behavior, but never permanently lowers the
private original received by the processing workflow.

## Disk eviction

Every cache hit updates the file modification date. Writes calculate decoded/downloaded bytes, prune least-recently-used files, and check `volumeAvailableCapacityKey`. Under storage pressure the cache contracts toward half its configured byte budget and rejects a write that would leave less than 512 MiB available.

The cache is disposable. Sign-out and memory/storage lifecycle hooks may clear it without affecting correctness.

## Feed and edge cache

Authenticated feed manifests use `private, max-age=15, stale-while-revalidate=30`. They
are never shared between users. Server-side feed snapshots and timeline sorted sets live
in Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are
configured. Development without Redis skips this cache and reads database candidates.

Configure Blob host patterns in `next.config.ts`. Keep private-original
authorization at the Vercel route boundary; immutable public HLS objects use
opaque versioned paths and never vary on an `Authorization` header.
Production has no process-local snapshot fallback: missing Redis credentials fail closed.

## Required production configuration

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, or the Vercel
  Marketplace equivalents `KV_REST_API_URL` / `KV_REST_API_TOKEN`
- `MOBILE_IMAGE_DERIVATIVE_UPLOAD_ENABLED=true`
- `MOBILE_MEDIA_PREHEAT_CANARY_PERCENT=0` initially, then a measured gradual rollout
- `MOBILE_OFFLINE_HLS_PREHEAT_LIMIT_STANDARD=1` for build 320+, or `0` as the kill switch
- `MOBILE_OFFLINE_HLS_CACHE_MAX_ASSETS=2` (hard-clamped to 3)
- `MOBILE_PREPARED_STREAMING_PEAK_BITRATE_STANDARD=8256000`
- `MOBILE_PREPARED_MAX_WIDTH_STANDARD=1080`
- `MOBILE_PREPARED_MAX_HEIGHT_STANDARD=1920`
- `CRON_SECRET` for authenticated Vercel media-session cleanup
- Workflow runtime variables provisioned by the Vercel Workflow integration

Stream video loading posters are requested explicitly at `time=0s`, matching the
playback start frame for both existing and new uploads. The iOS viewer removes that
poster atomically after `AVPlayerLayer` reports a displayable frame; it does not
crossfade between the poster and live video.

- private Vercel Blob token for originals
- separate public Vercel Blob token for HLS delivery
- `STORY_VIDEO_PROCESSOR=vercel-hls` and `MEDIA_PIPELINE_ENABLED=true` only
  after migration and preview verification
- Cloudflare credentials only during the rollback/drain window

Roll out image format changes by rendition version. Never change the bytes behind an existing immutable derivative URL.

Vercel calls `/api/cron/media-upload-cleanup` daily. It removes expired incomplete
private-Blob or Cloudflare uploads before deleting their session rows, and prunes
completed session rows after seven days without deleting published media.

Vercel calls `/api/cron/media-processing-reconcile` daily. It retries pending
or failed custom jobs up to the bounded attempt limit; each workflow step and
rendition path is idempotent.

Vercel also calls `/api/cron/story-publication-reconcile` every minute. It reconciles up
to 50 processing Stream stories and starts durable publication work for live stories
whose dispatch is missing or stale.
