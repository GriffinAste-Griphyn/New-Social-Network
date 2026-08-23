# UBEYE — Aggressive Instagram / Snapchat Parity Plan
**Date:** 2026-08-12  
**Goal:** 3× faster feed, flawless 60fps story viewer, lossless-looking media at half the bytes. No excuses.

## TL;DR — 7 Brutal Truths

1. **Your proxy is killing you.** `GET /api/story-media/[...]` streams private Blobs *through* Next.js (Node `get()` + stream). Every image goes `Vercel Blob → Vercel Function → CDN → Client` instead of `Blob → CDN → Client`. You pay double latency + double egress.
2. **Neon HTTP + Upstash REST = 120-250ms per query.** Feed needs 4-6 sequential DB hits + Redis `fetch()` REST. IG uses persistent TCP/QUIC + in-memory.
3. **iOS preheat is timid.** `preparedPlayerLimit=2`, `stackPreheat=3`, `imagePreheat=2`, debounce 400ms. Snap keeps 6-8 videos warm + pools decoders.
4. **Ranking is fake.** `freshness*5 + quality*4 + affinity*2 + monetization*3` with static `creatorScores`. No events → no learning. IG ranks per-user with 100+ features + online bandits.
5. **No real offline story.** Video uploads are TUS but no background `URLSession` queue, no resume-across-kill, no optimistic feed insert.
6. **ThumbHash exists but isn't wired end-to-end.** Placeholder → display derivative jump has no cross-fade, no progressive AVIF, no `content-visibility`.
7. **Zero streaming UI.** Feed is full JSON re-render, no PPR / no `Suspense` / no `loading.tsx` streaming.

---

## What "Aggressive" Means (Numbers)

| Metric | Now (est.) | IG/Snap | Target (4 weeks) |
|---|---|---|---|
| Feed TTFB (p50, US) | ~420ms | 80-140ms | <150ms |
| Feed → first story first-frame | 900-1400ms | 180-350ms | <300ms |
| Story swipe jank | visible | 0 | 0 frames dropped @120Hz |
| Image LCP | 1.2s (1080 AVIF via proxy) | 0.4s direct CDN | <0.5s |
| Video startup (HLS first frame) | 600-1100ms | 150-300ms | <300ms |
| Upload P50 (40MB 1080p) | 18-30s (serial) | 6-9s (chunked + concurrent) | <10s on LTE |
| Concurrent warm videos | 2 | 6-8 | 4-6 |

---

## PHASE 0 — Stop Bleeding (Week 1) — Biggest ROI

### 0A. Kill the Proxy, Sign the Edge
**File:** `lib/story-media/access.ts` + `app/api/story-media/[...pathname]/route.ts` + `lib/story-storage.ts`

- Switch Vercel Blob from `access:"private"`+proxy to **`cache-control: private, immutable` + signed URL direct to `*.blob.vercel-storage.com`** with 2h bucketed HMAC you already have. Stop calling `get(blobPathname)` inside Next.js.
- For images: return **302 → Blob direct URL with `token=`** + `Cache-Control: private, max-age=7200, immutable` + `CDN-Cache-Control: s-maxage=7200`. Cloudfront/VCEL edge caches it; Next.js does 0 bytes.
- Keep existence check via `head()` only on miss + short-circuit with DB `mediaAssets` row (you already have `mediaAssetId` in `stories`). Avoid the `SELECT … OR mediaUrl = decodedRoute` scan on every media hit.
- Add `next.config.ts: images.remotePatterns` already has Blob host — but add `unoptimized: false` and enforce `loader: custom` that respects your signed query. Add `minimumCacheTTL: 2592000`.

**Gain:** -180ms TTFB, -40% function duration, edge hit rate 85%+.

### 0B. Neon + Upstash: Persistent, Not Per-Request REST
**File:** `lib/db/index.ts`, `lib/upstash-redis.ts`

- Neon serverless HTTP does TLS+auth per query. Enable `fetchOptions.cache: no-store` + `neonConfig.fetchEndpoint` with `connectionCache: true` already — but also add **Drizzle `withReplicas` read pooling** + `prepare: true` for feed queries. Move feed reads to **Neon read replica** (`DATABASE_REPLICA_URL`).
- Replace `redisCommand([...fetch])` per call with **single `redisPipeline()` batch** you already have for fanout — extend to `readTimelineStoryIds` + feed snapshot: use `pipeline: [GET snapshot, ZREVRANGE...]` in one round-trip. Today you do 2 serial fetches.
- Add `Upstash REST keep-alive` header `Keep-Alive: timeout=30` (undici does it but you recreate fetch each time).

**Gain:** -90ms feed fanout, -60ms snapshot read.

### 0C. iOS: Go From 2 → 4 Warm Players, Kill Debounce
**Files:** `apps/ios/UBEYE/App/MediaEngine.swift`, `lib/mobile-media-config.ts`

- Bump `MOBILE_PREPARED_PLAYER_LIMIT_STANDARD` 2→4 (or 3 on A15+), `PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD` 3→4, `STACK_PREHEAT_LIMIT_STANDARD` 3→4, `IMAGE_PREHEAT_LIMIT_STANDARD` 2→4. Your `mobile-media-config.ts` already has `aggressiveConfigEnabled=true` — push the env defaults, don't keep them 1-2.
- In `MediaEngine.preheat` debounce `>0.4s` → `0.15s` for `.visible`/`.active`. Snap debounces 50ms.
- In `StoryVideoPlaybackPool.prepare(urls:)`, set `item.preferredForwardBufferDuration = 2` (not 4) for adjacent + 6 for active; `automaticallyWaitsToMinimizeStalling=false` for active player.
- Add `AVPlayerItem.preferredPeakBitRate` tier: active = 0 (unlimited), adjacent = 2.5 Mbps, background = 1 Mbps. You already tier `startupStreamingPeakBitRate` — use it.

**Gain:** Swipe without spinner, <180ms takePreparedPlayer hit rate 90% → 98%.

---

## PHASE 1 — Media Pipeline Hardened (Weeks 1-2)

### 1A. Images: Client Derivatives Are Right — Make Them Lossless-Looking
**Files:** `app/api/mobile/stories/image-upload/route.ts`, `lib/story-storage.ts`, `apps/ios/UBEYE/Features/Composer/*`

- Keep 1080×1920 AVIF display + 360×640 WebP thumb — **but add 720×1280 WebP fallback** for low-end / constrained (`isConstrained`). Don't trust single 1080 AVIF on 3G; serve `srcset: 360/720/1080`.
- Bump `maxStoryImageDisplayDerivativeBytes 1.2MB → 900KB` (tighter) and enforce **sharp `avif({ quality: 55, effort: 6 })`** on client? Your client already encodes AVIF — good. Enforce `thumbhash` still ≤16KB, but **render it as real blurred canvas + cross-fade 180ms** in `StoryThumbnailOverlayView`.
- On iOS, do **concurrent 2-part upload** (display + thumb in parallel with Alamofire/TUS 3×3MB chunks, not serial). Your `generateClientTokenFromReadWriteToken` per part is already parallel via `Promise.all` — keep it but add `uploadChunkBytes 8MB → 3MB` for 6-chunk parallelism on LTE.
- Add **`ImageResponse` edge cache key `v=storyId`** you already version — extend to `?w=360,720,1080` via Vercel Image Optimization or Cloudflare Polish, not Next.js proxy.

### 1B. Video: TUS Is Right — Make It Resumable-At-Scale
**Files:** `app/api/mobile/stories/video-upload/route.ts`, `apps/ios/UBEYE/Features/Composer/StoryVideoUploadPipeline.swift`, `lib/story-storage.ts` (Cloudflare TUS)

- Keep `createCloudflareStreamTusUpload` + `uploadLengthBytes` — but **increase `MOBILE_UPLOAD_CHUNK_BYTES 8MB → 3MB`** so a 40MB video = 14 chunks, better resume. Your `StoryVideoUploadPipeline` already inspects `hasFastStart` + tries `passthrough → remux → normalize` — perfect, keep it.
- Add **background `URLSessionConfiguration.background(withIdentifier: "ubeye.upload")`** in `BackgroundTusUploadTransport.shared` + persist `uploadSessionId` + `uploadUrl` in `UserDefaults`/SQLite so kill → resume without re-inspect.
- Normalize preset order: you try `1920x1080 → 1280x720`. Keep it, but on `isConstrained` **force `1280x720` first** + cap `fileLengthLimit` 6.2 → 4.5 Mbps. Already tiered — wire it.
- On completion, **eagerly `setCloudflareStreamThumbnailAtDefaultTime`** at 15% — you do — but also request **Cloudflare Stream `thumbnailTimestampPct` 0.15 already**; ensure webhook marks `readyToStream` → `storyPublication` workflow enqueues immediately (you do via `GET /api/cron/story-publication-reconcile` every min — make it **10s** via Vercel Cron).

### 1C. HLS Playback: Preconnect Is Not Enough
**Files:** `app/api/mobile/feed/route.ts` (`hlsPreconnectLinks`), `apps/ios/UBEYE/App/MediaEngine.swift`

- Your `hlsPreconnectLinks()` emits `Link: <.../manifest.m3u8>; rel=preconnect` for 2 videos — good. Add `rel=preload as=fetch` for first manifest + `dns-prefetch` for `videodelivery.net` + `*.cloudflarestream.com`.
- In iOS, `MediaFileDiskCache.shared.supportsPersistence` caches HLS chunks to disk — extend to **persist first 2 segments (6-8s) to FileCache** before user even opens story. Your `persistentVideoPreheatLimit` 3 is right — push to 4.

---

## PHASE 2 — Feed: From N+1 Heuristic to Real Ranking (Weeks 2-3)

### 2A. DB Indexes & Query Shape
**File:** `lib/db/schema/definitions.ts`, `lib/story-store.ts`

- Add partial index you already have `stories_live_feed_idx(status, moderationStatus, createdAt)` — but it's not covering `expiresAt`. Make it **`(status, moderationStatus, expiresAt, createdAt DESC) WHERE status='live' AND moderationStatus='approved'`** so `getFeedData` can index-only scan.
- Your `getFeedData` fans out: `followingStories` + `discoverStories` + `myStory` as 3 separate selects with `inArray(storyIds)` + `listFollowingProfiles`. Collapse to **2 queries**: (1) timeline storyIds ZREVRANGE → single `SELECT ... WHERE id IN (...) WITH joined creatorScores + storyMentions` + (2) discover via anti-join on `follows.followerId = viewerId`. Saves 2 round-trips.
- `stories_live_feed_idx` currently not used for `backfillTimelineForFollow` which does `WHERE creatorId = ? ORDER BY createdAt DESC LIMIT 24` — add **`stories_creator_live_idx (creatorId, createdAt DESC) WHERE status='live'`** (you have similar).

### 2B. Scoring: Capture Events → Learn
**File:** `lib/feed-snapshot-store.ts`, `lib/story-store.ts` (`rankStory`)

- Keep `rankStory(freshnessBoost + freshness*5 + quality*4 + affinity*2 + monetization*3)` for cold start, but **compute `freshnessScore/qualityScore/affinityScore` in a 1-minute cron** from `feed_events` (you already have `feedEvents` table). Today `creatorScores` is static `"0.650"/"0.350"` on story creation and never updated — that's why feed feels dead.
- Add `feed_events` aggregation job: `completion_rate = completions/impressions`, `hide_rate`, `rewatch_rate` per creator per 6h window → update `creatorScores` with EWMA. Simple SQL, no ML yet.
- Next level: per-viewer topic affinity via `storyMentions.brandSlug` → Redis hash `affinity:{viewerId}` increment on completion.

### 2C. Snap/IG Timeline UX
**Files:** `app/api/mobile/feed/route.ts`, `apps/ios/UBEYE/Features/Home/HomeView.swift`

- You already do cursor = `lastUploadedAt + id` base64url + `ZADD score = createdAt.getTime()` — correct. But `readTimelineStoryIds` does `ZREVRANGEBYSCORE +inf/-inf LIMIT 0 50` — keep but **add `nextCursor` from Redis score**, not just DB createdAt, so pagination survives fanout lag.
- Add **pull-to-refresh → `feedDiskCache Hit → network delta`** diff: you already restore disk then network, but you replace entire `feed`. Do **item-level diff + `withAnimation(.spring)`** so list doesn't jump.
- Add **prefetch `initialStoryStacks` limit 2 → 4** (you have `initialStoryStackLimit=2`). With 4 warm stacks, opening any of 4 tiles is instant.

---

## PHASE 3 — Client Smoothness (Weeks 2-3)

### 3A. Next.js: Stream the Shell
**Files:** `next.config.ts`, `app/*`

- Add `experimental: { ppr: 'incremental', optimizePackageImports: ['lucide-react','radix-ui'] }` + `compress: true` + `poweredByHeader: false`.
- Your `images.formats: ['image/avif','image/webp']` correct — add `deviceSizes: [360,720,1080,1920]`, `imageSizes: [64,128,256]`.
- Every `(protected)/feed/page.tsx` should be `async` Server Component with `Suspense fallback={<FeedSkeleton>}` that streams; today feed is client `GET /api/mobile/feed` from iOS — but web feed should SSR the first 6 stories without JS.

### 3B. iOS Gestures: 60fps or Die
**Files:** `StoryStackViewer.swift`, `HomeView.swift`

- `StoryStackViewer` swipe uses `verticalSwipeMinimumDistance:58` + `topChromeMinimumInset:58` — tighten to IG's 44pt + use `DragGesture(minimumDistance: 12)` + `simultaneousGesture` so horizontal story progress + vertical dismiss don't fight.
- Add `CADisplayLink` driven progress bar (you already have segment count from `storyVideoSegmentSeconds=10`, `minFinalVideoSegmentSeconds=2` — keep but render with `TimelineView(.animation)` not `Timer`).
- Pre-warm `AVAudioSession` category `.playback` on `HomeView.onAppear`, not on first story tap.

### 3C. Offline & Optimistic
**Files:** `APIClient.swift`, `apps/ios/UBEYE/App/StoryUploadCoordinator.swift`

- Your `PendingStoryUploadStore` merging into `storyStackByMergingPendingUploads` is already optimistic — wire it to **Home feed too** (`FeedStore.registerUploadedStory` does). Keep but persist pending to DiskCache so killed app still shows "Uploading..." tile.
- Add reachability `NWPathMonitor` → queue uploads with `BGTaskScheduler` when offline.

---

## PHASE 4 — Mon/Obs (Week 3-4)

- Add `instrumentation.ts` is empty — wire OpenTelemetry trace for `mobile-feed` dur → `Server-Timing: mobile-feed;dur=...` you already emit; also emit `feed_p50`, `video_first_frame` to your `mobile_performance_events` (already `qoeAccessLogSampleRate:1`).
- Add Vercel Analytics + Speed Insights.
- Cron `story-publication-reconcile` every 60s → 15s until no backlog, then 60s.

---

## Immediate File-Level Patches (Do Today)

| File | Change | Lines |
|---|---|---|
| `lib/mobile-media-config.ts` | Defaults aggressive: imagePreheat 4, stack 4, player 4, persistent 4, peak 5Mbps/720p constrained, 12Mbps/1080p standard | 18 |
| `next.config.ts` | Add `experimental.ppr`, `optimizePackageImports`, `images.deviceSizes`, `compress` | 12 |
| `app/api/mobile/feed/route.ts` | Pipeline Redis.snapshot+timeline in 1 fetch, raise `initialStoryStackLimit` 2→4, add `Early-Hints: 103` Link | 10 |
| `apps/ios/UBEYE/App/MediaEngine.swift` | Debounce 0.4→0.15s, `preferredForwardBufferDuration` 2 for adjacent, keep 4 warm | 6 |
| `lib/feed-timeline-store.ts` | Filter `backfillTimelineForFollow` to only live+approved+not expired | 5 |
| `app/api/story-media/[...pathname]/route.ts` | Add `Cache-Control: public, max-age=31536000, immutable` for signed URLs + `head()` cache | 4 |

---

## Rollout Order (Aggressive)

- **Mon-Tue:** 0A,0B,0C (edge + keepalive + iOS warm)
- **Wed-Thu:** 1A,1B + Next.js PPR
- **Fri:** 2A (indexes + query collapse)
- **Next Mon:** 2B (creatorScores job)
- **Next Tue-Fri:** 3A-3C + upload queue

Do not microservice. Do not graph DB. Do not ML model before `feed_events` has 100k rows.

