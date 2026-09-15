# Feed performance implementation

Checkpoint: `535980a` pushed before implementation.

## Scope
- Concurrent cache restoration/network feed loading; no thumbnail gate for first content.
- Background API response decoding; account-safe feed conditional requests.
- Creator-based keyset pagination; compact subsequent pages for opt-in clients.
- Batched initial stack hydration; reuse the already-read feed snapshot.
- Coalesce concurrent feed rebuilds; preserve authorization, expiry, and invalidation.
- Extract MetricKit measurements and add reproducible performance regression gates.

## Verification and release
- Backend unit/integration coverage for pagination, batching, validation and account isolation.
- Native tests for startup ordering, stale request cancellation, decoding and cache revalidation.
- Full backend regressions, TypeScript/lint, native tests, signed Release archive.
- Stage production Vercel deployment, verify health and feed, promote.
- Upload a new TestFlight build; record acceptance and any processing limitations.

## Build 448 implementation

- Cache restore races the network and cannot replace newer content or another account. First content has no thumbnail preparation wait; refreshes retain image/overlay generation consistency.
- APITransport owns background response decoding and bounded, authenticated conditional-response bodies. Mutations discard validators; unexpected 304 responses retry without a validator.
- Creator keyset selection happens before limits, supports 50 entries plus lookahead, and excludes blocked accounts in either direction. The opt-in `timeline-v1` format sends only page additions; legacy responses remain supported.
- Initial story stacks use batched reads and reuse the owner summary. Complete stacks are omitted above a 128 KiB budget, with a 750 ms response deadline and the existing dedicated-stack fallback.
- Fresh snapshot validation avoids feed reconstruction and stack hydration on 304. Snapshots expire with their stories, check page shape, and use Redis revision fencing to prevent invalidated builds from restoring stale data. Same-instance concurrent rebuilds join one promise.
- Auth/cache/feed/stack phases are reported in Server-Timing. Decoding is measured separately; MetricKit exports launch/resume histogram upper bounds, peak memory, CPU time, disk writes, and scrolling hitch ratios with version attribution.
- A 50-sample representative decoding benchmark is enforced by `scripts/feed-performance-gate.mjs`; missing evidence fails the gate.

## Verification completed before deployment

- Backend: full credential-isolated run passed 411 tests, including five real PostgreSQL integration cases; nine unrelated database cases skipped. The subsequently added optional-stack deadline case and related endpoint suite passed (7/7).
- PostgreSQL fixtures cover tied timestamps, 100 posts from one creator, bidirectional blocks, maximum-size pages, constant-query stack hydration, and joined rebuilds. The isolated fixture query plan executed in approximately 1 ms; this is not a production latency claim.
- Native 1.0.12 (448): 273 executed, 269 passed, four optional fixture cases skipped, zero failures. Startup races, account changes, compact pagination, conditional caching and off-main-thread decoding are covered.
- Simulator decoding benchmark: 50 samples, 22,286-byte/50-creator fixture, p95 approximately 2.41 ms against a 50 ms regression ceiling. These measurements do not establish physical-device launch or energy improvements.
- TypeScript and changed-file ESLint checks passed.
- Migration 0064 (decoding event and creator/latest-story index) passed on production-copy branch `codex-feed-performance-448` (`br-fancy-truth-anxu130s`) and then on production. The verification branch autosuspends after five minutes and is retained for reproduction.
- Live Redis revision fencing is verified using disposable keys by the opt-in deployment-builder probe, because production Redis secrets cannot be exported locally.

## Production release completed — September 14, 2026

- Implementation commit `8bba579` was pushed to `origin/codex/branded-ios-skeleton-loading` before deployment and archiving.
- Vercel deployment `dpl_AKrwhpGtPHvEzvgdaAdy4zVGUAHs` built successfully from that commit: https://new-social-network-ae0qdb8dr-griffin-astes-projects.vercel.app.
- The deployment builder passed 407 backend tests, with 14 database-dependent skips. Five of those cases passed in the local PostgreSQL run, giving 412 verified backend cases across both environments; nine unrelated database cases remain skipped.
- The live Redis probe passed: invalidation rejected an older rebuild and accepted the current revision. Disposable probe keys were removed.
- Staged service, image, and video health checks returned HTTP 200 with `ok: true`. An unauthenticated mobile-feed request correctly returned HTTP 401.
- The deployment was promoted to https://www.ubeye.ai. All three production health checks subsequently returned HTTP 200 with `ok: true`.
- The signed Release archive passed code-signature verification and contained bundle `com.griffinaste.ubeye`, version **1.0.12**, build **448**. All 91 tracked native source files matched the recorded source manifest after archiving.
- App Store Connect accepted build 448 at **20:06:49 America/Denver**. The upload log reported `Uploaded package is processing.`, `Upload succeeded.`, and `EXPORT SUCCEEDED`. Apple processing and tester availability have not yet been verified. Existing public App Store review submission 447 was left in place.

The signed archive, upload log, deployment and promotion logs, health responses, migration logs, test output, source manifest, and benchmark report are preserved under `/Users/griffinaste/Library/Developer/UBEYE-Releases/448/`.
