# UBEYE

UBEYE is a story-first social network prototype with:

- stories as the only content type
- no follower counts
- handle-based identity
- an algorithmic `For You` feed
- built-in branded-content payouts
- ad-share participation for active users
- public landing page plus authenticated app flow

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS v4
- shadcn/ui
- Drizzle ORM
- Postgres
- SwiftUI iOS app

Recommended production integrations for the first serious build:

- Neon for Postgres
- Vercel Blob for private originals and immutable adaptive media delivery
- Vercel Workflow plus bundled FFmpeg for story-video processing
- Stripe Connect for payouts

## Story media setup

Local development can use `STORY_STORAGE_PROVIDER=local`, which writes uploads
under `public/uploads/stories`.

Production uploads fail closed unless story media is configured for private
storage:

The custom Vercel HLS path uses two Blob stores. `BLOB_READ_WRITE_TOKEN` must
belong to a private store for originals. `MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN`
must belong to a public store for opaque, versioned HLS packages and posters.
Apply migration `0049_vercel_hls_media_pipeline.sql` before enabling it.

```bash
STORY_STORAGE_PROVIDER=vercel-blob
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_private_...
MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN=vercel_blob_rw_public_...
STORY_VIDEO_PROCESSOR=vercel-hls
MEDIA_PIPELINE_ENABLED=true
```

Deploy the code and migration first with the legacy
`STORY_VIDEO_PROCESSOR=cloudflare-stream` setting and
`MEDIA_PIPELINE_ENABLED=false`. After preview validation, change the processor
to `vercel-hls` and the flag to `true` together. Previously issued Cloudflare
uploads remain completable, and custom uploads already in flight remain
completable after a rollback.

The legacy Cloudflare rollback configuration is:

```bash
STORY_STORAGE_PROVIDER=vercel-blob
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
STORY_VIDEO_PROCESSOR=cloudflare-stream
CLOUDFLARE_STREAM_ACCOUNT_ID=...
CLOUDFLARE_STREAM_API_TOKEN=...
CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN=...
CLOUDFLARE_STREAM_WEBHOOK_SECRET=...
# Temporary build-250 compatibility. Headerless clients stop preparing progressive
# video stories at this timestamp (default: 2026-08-09T00:00:00Z); completion has
# a 24-hour grace period. Set ALLOW_LEGACY_ORIGINAL_VIDEO_UPLOADS=false to retire now.
LEGACY_ORIGINAL_VIDEO_UPLOADS_UNTIL=2026-08-09T00:00:00Z
# Required in production for local playback-token generation:
CLOUDFLARE_STREAM_SIGNING_KEY_ID=...
CLOUDFLARE_STREAM_SIGNING_KEY_JWK=...
# or CLOUDFLARE_STREAM_SIGNING_KEY_PEM=...
# UID of a private, processed canary video. Production health checks mint a
# signed URL and verify that its HLS manifest is actually reachable.
CLOUDFLARE_STREAM_HEALTHCHECK_UID=0123456789abcdef0123456789abcdef
```

Private original Blob media is served through `/api/story-media/...`, which
requires an authenticated session or a short-lived signed media URL issued by
the mobile API. Direct image uploads publish normalized display/poster
derivatives as private Blob assets and send a tiny inline placeholder.

Production also requires durable feed/publication infrastructure:

```bash
# Direct Upstash credentials, or the KV_REST_API_* variables injected by the
# Vercel Upstash Marketplace integration.
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
CRON_SECRET=...
# 0 keeps the stronger iOS preheat profile disabled; raise gradually.
MOBILE_MEDIA_PREHEAT_CANARY_PERCENT=0
```

Install the Vercel Workflow integration before deployment. Vercel invokes the
publication and custom-media reconciliation routes using `CRON_SECRET`.

## Admin setup

The admin portal is available at `/admin`. `griffin@ubeye.ai` is included
as a built-in admin. In production, set `ADMIN_EMAILS` to add more
comma-separated account emails:

```bash
ADMIN_EMAILS=founder@example.com,ops@example.com
```

If `ADMIN_EMAILS` is omitted in local development, any signed-in account can open
the admin portal.

## Stripe setup

This repo uses Stripe server-side only:

- creator payout onboarding: Stripe Connect Accounts v2 and hosted account links
- advertiser funding: Stripe Checkout Sessions
- payment reconciliation: signed Stripe webhooks at `/api/stripe/webhook`

Set these environment variables before using live Stripe flows:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

For local webhook testing:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Use the printed webhook signing secret as `STRIPE_WEBHOOK_SECRET`.

## Project layout

- [app/page.tsx](/Users/griffinaste/Desktop/New-Social-Network/app/page.tsx): public landing page
- [apps/ios](/Users/griffinaste/Desktop/New-Social-Network/apps/ios): native SwiftUI iOS app and Xcode project
- [app/(auth)/login/page.tsx](/Users/griffinaste/Desktop/New-Social-Network/app/(auth)/login/page.tsx): sign-in page
- [app/(auth)/signup/page.tsx](/Users/griffinaste/Desktop/New-Social-Network/app/(auth)/signup/page.tsx): sign-up page
- [app/(protected)/feed/page.tsx](/Users/griffinaste/Desktop/New-Social-Network/app/(protected)/feed/page.tsx): authenticated feed
- [lib/auth.ts](/Users/griffinaste/Desktop/New-Social-Network/lib/auth.ts): cookie session utilities
- [lib/user-store.ts](/Users/griffinaste/Desktop/New-Social-Network/lib/user-store.ts): Neon-backed user auth store
- [docs/architecture.md](/Users/griffinaste/Desktop/New-Social-Network/docs/architecture.md): architecture and rollout plan
- [lib/db/schema.ts](/Users/griffinaste/Desktop/New-Social-Network/lib/db/schema.ts): initial relational model
- [app/api/health/route.ts](/Users/griffinaste/Desktop/New-Social-Network/app/api/health/route.ts): basic route handler
- [.env.example](/Users/griffinaste/Desktop/New-Social-Network/.env.example): environment template

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Set `DATABASE_URL` to your Neon connection string before using sign up or sign in. Auth users are now stored in the Neon `users` table.

## iOS app

The production mobile client is the native SwiftUI app in [apps/ios](/Users/griffinaste/Desktop/New-Social-Network/apps/ios). The old Expo app has been removed from the active repo.

```bash
npm run ios:generate
npm run ios:open
npm run ios:build:debug
npm run ios:build:release
```

For TestFlight, open `apps/ios/UBEYE.xcodeproj`, set the Apple development team for bundle ID `com.griffinaste.ubeye`, archive from Xcode, and validate on a physical iPhone before public release.

## Database commands

```bash
npm run db:check
npm run db:generate
npm run db:migrate
npm run db:push
```

Use `npm run db:generate` after editing [lib/db/schema.ts](/Users/griffinaste/Desktop/New-Social-Network/lib/db/schema.ts), review the generated SQL in [drizzle](/Users/griffinaste/Desktop/New-Social-Network/drizzle), then apply the locked migration files with `npm run db:migrate`.

Reserve `npm run db:push` for local development or intentionally syncing a disposable database. Production should run `db:migrate` against the production `DATABASE_URL` so the deployed schema matches the checked-in migration history.

The [database migration workflow](/Users/griffinaste/Desktop/New-Social-Network/.github/workflows/database-migrations.yml) checks migration drift on pull requests and can be run manually against a GitHub environment that provides `DATABASE_URL`.
