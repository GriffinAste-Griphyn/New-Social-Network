import { NextResponse } from "next/server"

import { checkCloudflareStreamPlayback } from "@/lib/video-health"

export const runtime = "nodejs"

function isConfigured(value: string | undefined) {
  return Boolean(value?.trim())
}

export async function GET() {
  const playbackCanaryUid = process.env.CLOUDFLARE_STREAM_HEALTHCHECK_UID?.trim()
  const playbackProbe = playbackCanaryUid
    ? await checkCloudflareStreamPlayback(playbackCanaryUid)
    : null
  const playbackCanaryRequired = process.env.NODE_ENV === "production"
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
    cloudflarePlaybackCanary:
      !playbackCanaryRequired || Boolean(playbackCanaryUid),
    cloudflarePlaybackProbe:
      !playbackCanaryRequired && !playbackCanaryUid
        ? true
        : playbackProbe?.ok === true,
  }
  const requiredOk =
    checks.storyVideoProcessor &&
    checks.cloudflareAccountId &&
    checks.cloudflareApiToken &&
    checks.cloudflareCustomerSubdomain &&
    (process.env.NODE_ENV !== "production" ||
      (checks.cloudflareWebhookSecret &&
        checks.cloudflareSigningKeyId &&
        checks.cloudflareSigningKeyMaterial &&
        checks.cloudflarePlaybackCanary &&
        checks.cloudflarePlaybackProbe))

  return NextResponse.json(
    {
      ok: requiredOk,
      service: "ubeye-video",
      checks,
      playbackProbe,
      optional: {
        cloudflareWebhookSecret:
          process.env.NODE_ENV === "production"
            ? "Required in production so Cloudflare can promote processed videos immediately."
            : "Enables webhook-driven processing updates. Polling/status refresh can still work without it.",
        cloudflarePlaybackCanary:
          process.env.NODE_ENV === "production"
            ? "Required in production. Uses a private canary video to verify signed HLS playback end to end."
            : "Set CLOUDFLARE_STREAM_HEALTHCHECK_UID to actively verify signed HLS playback.",
      },
      now: new Date().toISOString(),
    },
    { status: requiredOk ? 200 : 503 },
  )
}
