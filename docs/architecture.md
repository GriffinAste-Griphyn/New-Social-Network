# Architecture

Date: April 19, 2026

## Product shape

This app makes sense.

The key difference from a standard social graph is that the product is built around:

- stories only
- no follower counts
- handle-based identity
- algorithmic creator discovery
- monetization wired into ordinary posting behavior
- ad-share participation for active users

That changes the architecture in a useful way. You do need a lightweight one-way follow graph, but it should stay secondary to the story graph, event pipeline, and payout ledger you need from day one.

## Recommended stack

### Language

Use TypeScript for the entire MVP.

Reason:

- one language across UI, route handlers, validation, database code, and jobs
- faster iteration for a small team
- easier shared types between product, moderation, and monetization logic

Do not start with Python for the core backend. Add Python only later if you need offline ranking research, feature generation, or moderation experiments that are genuinely better there.

### App framework

Use Next.js App Router with shadcn/ui for the first product.

Reason:

- fast full-stack iteration in one codebase
- good fit for a web MVP, creator studio, admin tooling, and moderation surfaces
- route handlers are enough for the first API layer
- shadcn/ui gives you open-code components instead of a boxed-in design system

Important tradeoff:

If this is ultimately a consumer mobile product, the long-term client should be native or React Native with Expo. `shadcn/ui` is the right choice for the web app and internal tools, but not the final consumer mobile UI stack.

## Backend recommendation

Start as a modular monolith:

- Next.js app
- Postgres
- Drizzle ORM
- auth provider
- media provider
- payout provider

Do not split into microservices yet.

You need:

1. one clean relational model
2. one append-only event stream
3. one ledger for earnings

That is enough for the first real launch.

## Infrastructure recommendation

### Database and auth

Use Neon first for the relational backend.

Reason:

- serverless Postgres that fits Next.js and Drizzle well
- branch-based workflows are useful when the schema is moving fast
- strong default fit for the event-heavy, relational core this product needs

For auth, the repo currently uses a credentials-based cookie session flow backed by the `users` table. For production, move to a managed provider later if the product needs social login, device management, or admin tooling.

### Video

Use Cloudflare Stream for story videos.

Reason:

- direct user uploads
- encoding and playback handled for you
- fewer surprises than storing raw video files and building your own playback pipeline

### Images

Use Vercel Blob or Cloudflare R2 first, then reassess later if image egress or transformation cost becomes a problem.

### Payouts

Use Stripe Connect.

Reason:

- you need creator payouts
- you may later need brand-side billing and settlement
- Connect already fits platforms and marketplaces

## Core domains

### 1. Identity

- `users`
- unique `handle`
- rename history
- account trust flags

The handle is the public unit of identity. Keep it separate from private auth identifiers.

### 2. Story content

- `stories`
- asset type: image or video
- media metadata
- expiration timestamp
- moderation state

Stories are the only content primitive. That simplifies product logic a lot.

### 3. Feed ranking

You want a `For You` system, not a follower feed.

Start with heuristic ranking:

- freshness
- completion rate
- hide rate
- rewatch rate
- topic affinity
- creator diversity
- brand safety

Do not start with a complex ML model. First capture good events.

### 4. Brand monetization

This is the differentiator.

You need:

- explicit tags
- text mentions
- brand detection review queue
- campaign match table
- approval workflow

Launch rules-first. Do not make computer vision or LLM brand classification a dependency for v1.

### 5. Earnings ledger

Both monetization paths should settle into one ledger:

- brand-match payouts
- ad-share payouts
- manual adjustments

That keeps creator balances understandable and payout operations sane.

## Feed architecture

### v1 flow

1. user opens `For You`
2. fetch candidate stories from recent, safe, active creators
3. score with heuristic weights
4. log every impression, skip, completion, hide, and rewatch
5. recompute creator-level scores on a schedule

### v2 flow

Once you have enough data:

- offline feature generation
- model training or ranking experimentation
- candidate generation separated from scoring
- per-topic affinity vectors

Do not pay the complexity cost before the data exists.

## Monetization architecture

### Organic brand mention flow

1. creator posts a story
2. story contains explicit brand tag or detected brand signal
3. story enters campaign match logic
4. eligible matches get reviewed or auto-approved under strict rules
5. payout entry lands in `earnings_ledger`

### Ad-share flow

1. user activity qualifies for the pool
2. pool allocation job computes daily earnings
3. earnings land in the same ledger
4. payout ops clear balances through Stripe Connect

## Initial build order

### Phase 1

- auth
- handle claim
- story upload
- story watch surface
- basic moderation state

### Phase 2

- `For You` ranking v1
- event tracking
- creator scoring job

### Phase 3

- brand mentions
- campaign matching
- earnings ledger
- payout onboarding

### Phase 4

- native mobile client
- better ranking system
- trust and safety automation

## What not to do yet

- no microservices
- no graph database
- no custom video pipeline
- no complex ML dependency for launch
- no follower counts hidden in the UI but still driving the ranking model

If follower counts are philosophically out, keep them out of the product surface and out of the ranking model even if the app supports one-way follows.
