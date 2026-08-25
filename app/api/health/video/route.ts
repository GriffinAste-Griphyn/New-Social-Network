import { list } from "@vercel/blob"
import { count } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getDb } from "@/lib/db"
import { mediaProcessingJobs } from "@/lib/db/schema"
import { checkCloudflareStreamPlayback } from "@/lib/video-health"

export const runtime = "nodejs"

function isConfigured(value: string | undefined) {
  return Boolean(value?.trim())
}

export async function GET() {
  const processor = process.env.STORY_VIDEO_PROCESSOR
  const customPipeline = processor === "vercel-hls"
  const privateOriginalToken = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  const publicDeliveryToken =
    process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN?.trim()
  const playbackCanaryUid = process.env.CLOUDFLARE_STREAM_HEALTHCHECK_UID?.trim()
  const playbackProbe = !customPipeline && playbackCanaryUid
    ? await checkCloudflareStreamPlayback(playbackCanaryUid)
    : null
  const [privateOriginalProbe, publicDeliveryProbe, processingJobs] =
    customPipeline
      ? await Promise.all([
          privateOriginalToken
            ? list({ limit: 1, token: privateOriginalToken })
                .then(() => true)
                .catch(() => false)
            : false,
          publicDeliveryToken
            ? list({ limit: 1, token: publicDeliveryToken })
                .then(() => true)
                .catch(() => false)
            : false,
          getDb()
            .select({
              status: mediaProcessingJobs.status,
              count: count(),
            })
            .from(mediaProcessingJobs)
            .groupBy(mediaProcessingJobs.status)
            .catch(() => null),
        ])
      : [null, null, null]
  const playbackCanaryRequired = process.env.NODE_ENV === "production"
  const checks = {
    storyVideoProcessor: ["cloudflare-stream", "vercel-hls"].includes(
      processor ?? "",
    ),
    customPipelineEnabled:
      !customPipeline || process.env.MEDIA_PIPELINE_ENABLED === "true",
    privateOriginalStore:
      !customPipeline || (Boolean(privateOriginalToken) && privateOriginalProbe),
    publicDeliveryStore:
      !customPipeline ||
      (Boolean(publicDeliveryToken) && publicDeliveryProbe),
    processingDatabase: !customPipeline || processingJobs !== null,
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
    (customPipeline
      ? checks.customPipelineEnabled &&
        checks.privateOriginalStore &&
        checks.publicDeliveryStore &&
        checks.processingDatabase
      : checks.cloudflareAccountId &&
        checks.cloudflareApiToken &&
        checks.cloudflareCustomerSubdomain &&
        (process.env.NODE_ENV !== "production" ||
          (checks.cloudflareWebhookSecret &&
            checks.cloudflareSigningKeyId &&
            checks.cloudflareSigningKeyMaterial &&
            checks.cloudflarePlaybackCanary &&
            checks.cloudflarePlaybackProbe)))

  return NextResponse.json(
    {
      ok: requiredOk,
      service: "ubeye-video",
      processor,
      checks,
      processingJobs,
      playbackProbe,
      optional: {
        customPipeline:
          "Private originals and public immutable HLS delivery use separate Vercel Blob stores.",
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
