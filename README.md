# New Social Network

Story-first social network prototype with:

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

Recommended production integrations for the first serious build:

- Neon for Postgres
- Vercel Blob for private story image storage
- Cloudflare Stream for story video
- Stripe Connect for payouts

## Story media setup

Local development can use `STORY_STORAGE_PROVIDER=local`, which writes uploads
under `public/uploads/stories`.

Production uploads fail closed unless story media is configured for private
storage:

```bash
STORY_STORAGE_PROVIDER=vercel-blob
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
STORY_VIDEO_PROCESSOR=cloudflare-stream
CLOUDFLARE_STREAM_ACCOUNT_ID=...
CLOUDFLARE_STREAM_API_TOKEN=...
CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN=...
```

Private Blob media is served through `/api/story-media/...`, which requires an
authenticated session or a short-lived signed media URL issued by the mobile API.

## Admin setup

The admin portal is available at `/admin`. `griffin.aste@gmail.com` is included
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
