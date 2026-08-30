import { del, put } from "@vercel/blob"
import { and, count, desc, eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getDb } from "@/lib/db"
import { mediaProcessingJobs, mediaRenditions } from "@/lib/db/schema"
import {
  checkCloudflareStreamPlayback,
  checkVercelHlsPlayback,
  discoverCloudflareStreamPlaybackCanaries,
  type VideoPlaybackProbeResult,
} from "@/lib/video-health"

export const runtime = "nodejs"

function isConfigured(value: string | undefined) {
  return Boolean(value?.trim())
}

const blobStoreProbes = new Map<string, Promise<boolean>>()

function checkBlobStoreWrite(input: {
  key: string
  token: string
  access: "private" | "public"
}) {
  const cacheKey = `${input.key}:${input.token}`
  const existing = blobStoreProbes.get(cacheKey)
  if (existing) return existing

  const pathname = `_health/${input.key}-write-probe.txt`
  const probe = put(pathname, "ubeye-video-health", {
    access: input.access,
    token: input.token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain",
    cacheControlMaxAge: 60,
  })
    .then(async () => {
      await del(pathname, { token: input.token })
      return true
    })
    .catch(() => false)

  blobStoreProbes.set(cacheKey, probe)
  return probe
}

export async function GET() {
  const processor = process.env.STORY_VIDEO_PROCESSOR
  const customPipeline = processor === "vercel-hls"
  const privateOriginalToken = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  const publicDeliveryToken =
    process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN?.trim()
  const playbackCanaryUid = process.env.CLOUDFLARE_STREAM_HEALTHCHECK_UID?.trim()
  const [
    privateOriginalProbe,
    publicDeliveryProbe,
    processingJobs,
    latestHlsMasterRows,
  ] =
    customPipeline
      ? await Promise.all([
          privateOriginalToken
            ? checkBlobStoreWrite({
                key: "private-original",
                token: privateOriginalToken,
                access: "private",
              })
            : false,
          publicDeliveryToken
            ? checkBlobStoreWrite({
                key: "public-delivery",
                token: publicDeliveryToken,
                access: "public",
              })
            : false,
          getDb()
            .select({
              status: mediaProcessingJobs.status,
              count: count(),
            })
            .from(mediaProcessingJobs)
            .groupBy(mediaProcessingJobs.status)
            .catch(() => null),
          getDb()
            .select({ mediaUrl: mediaRenditions.mediaUrl })
            .from(mediaRenditions)
            .where(
              and(
                eq(mediaRenditions.kind, "hls-master"),
                eq(mediaRenditions.status, "ready"),
                eq(mediaRenditions.qualityStatus, "passed"),
              ),
            )
            .orderBy(desc(mediaRenditions.updatedAt))
            .limit(1)
            .catch(() => null),
        ])
      : [null, null, null, null]
  const playbackCanaryRequired = process.env.NODE_ENV === "production"
  const latestHlsMasterUrl = latestHlsMasterRows?.[0]?.mediaUrl ?? null
  const cloudflareCanaryDiscovery =
    !customPipeline &&
    process.env.CLOUDFLARE_STREAM_ACCOUNT_ID &&
    process.env.CLOUDFLARE_STREAM_API_TOKEN
      ? await discoverCloudflareStreamPlaybackCanaries({
          accountId: process.env.CLOUDFLARE_STREAM_ACCOUNT_ID,
          apiToken: process.env.CLOUDFLARE_STREAM_API_TOKEN,
        })
      : null
  let playbackProbe: VideoPlaybackProbeResult | null = customPipeline
    ? latestHlsMasterUrl
      ? await checkVercelHlsPlayback(latestHlsMasterUrl)
      : null
    : null
  if (!customPipeline) {
    const candidateUids = Array.from(
      new Set(
        [playbackCanaryUid, ...(cloudflareCanaryDiscovery?.uids ?? [])].filter(
          (uid): uid is string => Boolean(uid),
        ),
      ),
    ).slice(0, 5)
    for (const candidateUid of candidateUids) {
      playbackProbe = await checkCloudflareStreamPlayback(candidateUid)
      if (playbackProbe.ok) break
    }
  }
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
      (process.env.MEDIA_DELIVERY_ACCESS === "public" &&
        Boolean(publicDeliveryToken) &&
        publicDeliveryProbe),
    processingDatabase: !customPipeline || processingJobs !== null,
    vercelHlsPlaybackCanary:
      !customPipeline || !playbackCanaryRequired || Boolean(latestHlsMasterUrl),
    vercelHlsPlaybackProbe:
      !customPipeline ||
      (!playbackCanaryRequired && !latestHlsMasterUrl) ||
      playbackProbe?.ok === true,
    cloudflareAccountId: isConfigured(process.env.CLOUDFLARE_STREAM_ACCOUNT_ID),
    cloudflareApiToken: isConfigured(process.env.CLOUDFLARE_STREAM_API_TOKEN),
    cloudflareApiProbe:
      customPipeline || cloudflareCanaryDiscovery?.ok === true,
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
      !playbackCanaryRequired ||
      Boolean(
        playbackCanaryUid || (cloudflareCanaryDiscovery?.uids.length ?? 0) > 0,
      ),
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
        checks.processingDatabase &&
        checks.vercelHlsPlaybackCanary &&
        checks.vercelHlsPlaybackProbe
      : checks.cloudflareAccountId &&
        checks.cloudflareApiToken &&
        checks.cloudflareApiProbe &&
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
      cloudflareCanaryDiscovery: cloudflareCanaryDiscovery
        ? {
            ok: cloudflareCanaryDiscovery.ok,
            status: cloudflareCanaryDiscovery.status,
            candidateCount: cloudflareCanaryDiscovery.uids.length,
            error: cloudflareCanaryDiscovery.error,
          }
        : null,
      optional: {
        customPipeline:
          "Private originals and public immutable HLS delivery use separate Vercel Blob stores.",
        vercelHlsPlaybackCanary:
          "The most recently verified HLS master, variant, initialization file, and first media segment are probed through public delivery.",
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
