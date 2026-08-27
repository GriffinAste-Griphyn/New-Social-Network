# Media pipeline rollout

Date: August 26, 2026

## Compatibility boundary

- iOS build 363 introduces asynchronous image/video completion and understands pending
  moderation. Builds below 363 retain synchronous completion.
- `MEDIA_ASYNC_COMPLETION_ENABLED=false` disables the new completion path without an app
  release and routes publication, moderation, image recovery, and HLS recovery through
  direct execution. This is the safe setting when Vercel Workflow is unavailable or its
  usage quota is exhausted.
- Processed HLS remains private by default. Set `MEDIA_DELIVERY_ACCESS=public` only after
  `MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN` belongs to a public delivery store.
- Existing story URLs and in-flight Workflow deployments remain valid. HLS v3 uses new
  opaque prefixes and immutable master names; it does not overwrite v2 objects.

## Deployment order

1. Apply `drizzle/0052_async_media_workers.sql`.
2. Deploy the backend with `MEDIA_DELIVERY_ACCESS` unset and verify health, Workflow
   registration, and authenticated private playback.
3. Ship build 363 to internal TestFlight users. Confirm pending stories reach `live`,
   rejected stories terminate polling, and relaunch resumes pending uploads.
4. Monitor `media_qoe_rollup`, Workflow failures, processing age, first-frame p95, and
   upload completion errors for at least one full story-expiration window.
5. Provision/verify a public delivery Blob store, set `MEDIA_DELIVERY_ACCESS=public` in a
   preview deployment, and verify that master, variant, init, and segment requests go
   directly to Blob without the story-media Function.
6. Promote the identical configuration gradually. Keep the private route and legacy
   Cloudflare completion path during the rollback window.

The current Vercel Hobby project runs each reconciliation cron once per day. Immediate
Workflow dispatch and authenticated story-status polling are the primary recovery paths;
the daily crons are a final orphan sweep. On Vercel Pro, restore the documented five-minute
reconciliation cadence for tighter unattended recovery.

## Rollback

- Set `MEDIA_ASYNC_COMPLETION_ENABLED=false` to restore synchronous completion for new
  requests and direct execution for background recovery. Already accepted pending stories
  are reclaimed by the direct reconcilers when their leases expire.
- Remove `MEDIA_DELIVERY_ACCESS` to restore private routed delivery for new HLS outputs.
  Existing public immutable URLs remain playable until lifecycle cleanup.
- Do not remove the additive job table during an incident. Roll back application code;
  reconciliation can resume the rows after a corrected deployment.

## Required validation

- `npm test`, `npx tsc --noEmit`, lint, and production Next.js build
- iOS Debug simulator build and tests
- portrait, landscape, HDR, silent, mono, and high-motion source samples
- duplicate completion, app relaunch, Workflow retry, moderation rejection, and expired
  story cleanup
- private and public delivery modes, including relative HLS child resolution
