# Media CDN and caching

Date: August 10, 2026

## Request path

The mobile media path is intentionally layered:

1. `MediaImageCache` keeps decoded, downsampled `UIImage` instances in a cost-bounded `NSCache`.
2. `MediaFileDiskCache` keeps progressive images and videos in an LRU bounded by bytes and available device capacity.
3. `URLCache` and AVFoundation retain transport-level responses and bounded HLS state.
4. Cloudflare Stream serves signed adaptive HLS; Vercel Blob stores private image/original assets.
5. The origin route authorizes private media and never exposes an unsigned original.

HLS playlists are not copied into the progressive file cache. A playlist without its segment and key graph is not an offline asset and stale signed manifests are actively harmful. Prepared players are the bounded warm path for streaming video.

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

Cloudflare Stream owns the bitrate ladder. iOS applies a startup peak bitrate and maximum resolution while the first frame is hidden, then `MediaPlaybackQuality.relaxStreamingHints` removes both limits immediately after `video_first_frame`. This gives the player a low-cost startup choice without pinning the rest of playback to 540p/720p.

Targets:

- warm first frame p50 below 350 ms;
- good-network first frame p95 below 900 ms;
- startup stalls below 1%;
- no more than the server-configured prepared player count.

## Disk eviction

Every cache hit updates the file modification date. Writes calculate decoded/downloaded bytes, prune least-recently-used files, and check `volumeAvailableCapacityKey`. Under storage pressure the cache contracts toward half its configured byte budget and rejects a write that would leave less than 512 MiB available.

The cache is disposable. Sign-out and memory/storage lifecycle hooks may clear it without affecting correctness.

## Feed and edge cache

Authenticated feed manifests use `private, max-age=15, stale-while-revalidate=30`. They
are never shared between users. Server-side feed snapshots and timeline sorted sets live
in Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are
configured. Development without Redis skips this cache and reads database candidates.

Configure Cloudflare Stream and Blob host patterns in `next.config.ts`. Keep authorization
at the Vercel route boundary; do not vary a public CDN object on an `Authorization` header.
Production has no process-local snapshot fallback: missing Redis credentials fail closed.

## Required production configuration

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, or the Vercel
  Marketplace equivalents `KV_REST_API_URL` / `KV_REST_API_TOKEN`
- `MOBILE_IMAGE_DERIVATIVE_UPLOAD_ENABLED=true`
- `MOBILE_MEDIA_PREHEAT_CANARY_PERCENT=0` initially, then a measured gradual rollout
- `CRON_SECRET` for authenticated Vercel media-session cleanup
- Workflow runtime variables provisioned by the Vercel Workflow integration
- Cloudflare Stream account, token, customer subdomain, and signing key
- private Vercel Blob token

Roll out image format changes by rendition version. Never change the bytes behind an existing immutable derivative URL.

Vercel calls `/api/cron/media-upload-cleanup` daily. It removes expired incomplete
Cloudflare uploads before deleting their session rows, and prunes completed session
rows after seven days without deleting published media.

Vercel also calls `/api/cron/story-publication-reconcile` every minute. It reconciles up
to 50 processing Stream stories and starts durable publication work for live stories
whose dispatch is missing or stale.
