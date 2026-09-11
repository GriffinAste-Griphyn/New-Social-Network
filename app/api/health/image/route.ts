import { NextResponse } from "next/server"

import {
  isCloudflareR2Configured,
  probeCloudflareR2Buckets,
} from "@/lib/cloudflare-r2"
import { isVercelBlobAccessDisabled } from "@/lib/media-availability"
import { areDurableMediaWorkersEnabled } from "@/lib/media-pipeline/features"

export const runtime = "nodejs"

export async function GET() {
  const provider = process.env.STORY_IMAGE_STORAGE_PROVIDER?.trim()
  const cloudflareR2Selected = provider === "cloudflare-r2"
  const cloudflareR2Configured = isCloudflareR2Configured()
  const cloudflareR2ApiProbe =
    cloudflareR2Selected && cloudflareR2Configured
      ? await probeCloudflareR2Buckets().catch(() => false)
      : false
  const checks = {
    storyImageStorageProvider: ["cloudflare-r2", "vercel-blob"].includes(
      provider ?? "",
    ),
    profileAvatarStorageProvider:
      cloudflareR2Selected ||
      (process.env.STORY_STORAGE_PROVIDER?.trim() === "vercel-blob" &&
        !isVercelBlobAccessDisabled()),
    cloudflareR2Selected,
    cloudflareR2Configured,
    cloudflareR2ApiProbe,
    durableMediaWorkers: areDurableMediaWorkersEnabled(),
    publicDeliveryUrl: Boolean(
      process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL?.trim(),
    ),
  }
  const ok =
    checks.storyImageStorageProvider &&
    checks.profileAvatarStorageProvider &&
    checks.durableMediaWorkers &&
    (cloudflareR2Selected
      ? cloudflareR2Configured &&
        cloudflareR2ApiProbe &&
        checks.publicDeliveryUrl
      : !isVercelBlobAccessDisabled())

  return NextResponse.json(
    {
      ok,
      service: "ubeye-image",
      provider,
      blobAccessMode: isVercelBlobAccessDisabled() ? "paused" : "enabled",
      checks,
      now: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  )
}
