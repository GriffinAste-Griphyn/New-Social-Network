# Production Readiness

Use this checklist before promoting UBEYE to a live environment.

## Required checks

```bash
npm run production:check
npm run audit:production
```

`production:check` must pass before deployment. `audit:production` currently reports
PostCSS advisories through `next` and `expo` transitive dependencies where npm only
offers a breaking `--force` resolution path. Do not force those downgrades; upgrade
Next.js and Expo when patched versions are available.

## Required environment

```bash
NEXT_PUBLIC_APP_URL=https://your-domain.example
DATABASE_URL=postgresql://...
AUTH_SECRET=generate-at-least-32-random-characters
ADMIN_EMAILS=ops@example.com
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL="UBEYE <noreply@your-domain.example>"
STORY_STORAGE_PROVIDER=vercel-blob
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
STORY_VIDEO_PROCESSOR=cloudflare-stream
CLOUDFLARE_STREAM_ACCOUNT_ID=...
CLOUDFLARE_STREAM_API_TOKEN=...
CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN=...
CLOUDFLARE_STREAM_WEBHOOK_SECRET=...
CRON_SECRET=generate-at-least-16-random-characters
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Deployment gates

- Apply checked-in migrations with `npm run db:migrate` against the production
  `DATABASE_URL`.
- Verify `/api/health`, `/robots.txt`, and `/sitemap.xml` after deployment.
- Confirm Stripe webhooks are pointed at `/api/stripe/webhook`.
- Confirm story image uploads use private Vercel Blob storage.
- Confirm story video uploads use Cloudflare Stream signed playback.
- Confirm Cloudflare Stream webhooks call `/api/cloudflare/stream/webhook`.
- Confirm Vercel Cron calls `/api/cron/media-lifecycle` with `CRON_SECRET`.
  The checked-in cron runs hourly, which requires a Vercel plan that supports
  hourly cron execution.
- Confirm non-mobile web requests to `/feed` redirect to `/mobile-only`.
