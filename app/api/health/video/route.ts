import { NextResponse } from "next/server"

export const runtime = "nodejs"

function isConfigured(value: string | undefined) {
  return Boolean(value?.trim())
}

export async function GET() {
  const checks = {
    storyVideoProcessor: process.env.STORY_VIDEO_PROCESSOR === "cloudflare-stream",
    cloudflareAccountId: isConfigured(process.env.CLOUDFLARE_STREAM_ACCOUNT_ID),
    cloudflareApiToken: isConfigured(process.env.CLOUDFLARE_STREAM_API_TOKEN),
    cloudflareCustomerSubdomain: isConfigured(
      process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN,
    ),
    cloudflareWebhookSecret: isConfigured(
      process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET,
    ),
    cloudflareSigningKeyId: isConfigured(
      process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
    ),
    cloudflareSigningKeyMaterial:
      isConfigured(process.env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK) ||
      isConfigured(process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM),
  }
  const requiredOk =
    checks.storyVideoProcessor &&
    checks.cloudflareAccountId &&
    checks.cloudflareApiToken &&
    checks.cloudflareCustomerSubdomain &&
    (process.env.NODE_ENV !== "production" ||
      (checks.cloudflareWebhookSecret &&
        checks.cloudflareSigningKeyId &&
        checks.cloudflareSigningKeyMaterial))

  return NextResponse.json(
    {
      ok: requiredOk,
      service: "ubeye-video",
      checks,
      optional: {
        cloudflareWebhookSecret:
          process.env.NODE_ENV === "production"
            ? "Required in production so Cloudflare can promote processed videos immediately."
            : "Enables webhook-driven processing updates. Polling/status refresh can still work without it.",
      },
      now: new Date().toISOString(),
    },
    { status: requiredOk ? 200 : 503 },
  )
}
