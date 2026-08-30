import { createCloudflareStreamPlaybackUrl } from "@/lib/story-storage"

export type VideoPlaybackProbeResult = {
  ok: boolean
  status: number | null
  latencyMs: number
  checkedAt: string
  error?: string
  resources?: {
    master: number
    variant: number
    initialization: number
    segment: number
  }
}

export type CloudflareStreamCanaryDiscoveryResult = {
  ok: boolean
  uids: string[]
  status: number | null
  error?: string
}

const probeTimeoutMs = 5_000
const probeCacheTtlMs = 60_000

let cachedProbe:
  | {
      uid: string
      expiresAt: number
      result: Promise<VideoPlaybackProbeResult>
    }
  | undefined

const cachedVercelHlsProbes = new Map<
  string,
  { expiresAt: number; result: Promise<VideoPlaybackProbeResult> }
>()

function validCloudflareStreamUid(uid: string) {
  return /^[a-f0-9]{32}$/i.test(uid)
}

export async function discoverCloudflareStreamPlaybackCanaries(input: {
  accountId: string
  apiToken: string
}): Promise<CloudflareStreamCanaryDiscoveryResult> {
  let status: number | null = null

  try {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/stream`,
    )
    url.searchParams.set("status", "ready")
    url.searchParams.set("limit", "10")
    url.searchParams.set("asc", "false")

    const response = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${input.apiToken}` },
      signal: AbortSignal.timeout(probeTimeoutMs),
    })
    status = response.status
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean
      result?: Array<{ uid?: string }>
      errors?: Array<{ message?: string }>
    } | null

    if (!response.ok || payload?.success !== true) {
      const apiMessage = payload?.errors?.find((error) => error.message)?.message
      throw new Error(
        apiMessage
          ? `Cloudflare Stream API probe failed: ${apiMessage}`
          : `Cloudflare Stream API probe returned HTTP ${response.status}.`,
      )
    }

    return {
      ok: true,
      status,
      uids: Array.from(
        new Set(
          (payload.result ?? [])
            .map((video) => video.uid?.trim() ?? "")
            .filter(validCloudflareStreamUid),
        ),
      ),
    }
  } catch (error) {
    return {
      ok: false,
      status,
      uids: [],
      error:
        error instanceof Error
          ? error.message
          : "Cloudflare Stream API probe failed.",
    }
  }
}

async function runPlaybackProbe(uid: string): Promise<VideoPlaybackProbeResult> {
  const startedAt = performance.now()
  let status: number | null = null

  try {
    if (!validCloudflareStreamUid(uid)) {
      throw new Error("The playback canary UID is invalid.")
    }

    const playbackUrl = await createCloudflareStreamPlaybackUrl(uid)
    const response = await fetch(playbackUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain",
      },
      signal: AbortSignal.timeout(probeTimeoutMs),
    })
    status = response.status
    const manifest = await response.text()
    if (!response.ok || !manifest.trimStart().startsWith("#EXTM3U")) {
      throw new Error(
        response.ok
          ? "The playback canary did not return an HLS manifest."
          : `The playback canary returned HTTP ${response.status}.`,
      )
    }

    return {
      ok: true,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ok: false,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Playback probe failed.",
    }
  }
}

export function checkCloudflareStreamPlayback(
  uid: string,
): Promise<VideoPlaybackProbeResult> {
  const now = Date.now()
  if (cachedProbe?.uid === uid && cachedProbe.expiresAt > now) {
    return cachedProbe.result
  }

  const result = runPlaybackProbe(uid)
  cachedProbe = {
    uid,
    expiresAt: now + probeCacheTtlMs,
    result,
  }
  return result
}

function assertPublicVercelBlobUrl(url: URL, expectedHost?: string) {
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".public.blob.vercel-storage.com") ||
    (expectedHost && url.hostname !== expectedHost)
  ) {
    throw new Error("The HLS playback canary URL is not a public Vercel Blob URL.")
  }
}

function resolveCanaryResource(baseUrl: URL, resource: string) {
  const resolved = new URL(resource, baseUrl)
  assertPublicVercelBlobUrl(resolved, baseUrl.hostname)
  return resolved
}

async function fetchCanaryManifest(url: URL) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain",
    },
    signal: AbortSignal.timeout(probeTimeoutMs),
  })
  const body = await response.text()
  if (!response.ok || !body.trimStart().startsWith("#EXTM3U")) {
    throw new Error(
      response.ok
        ? "The HLS playback canary returned an invalid manifest."
        : `The HLS playback canary returned HTTP ${response.status}.`,
    )
  }
  return { body, status: response.status }
}

async function fetchCanaryMedia(url: URL) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Range: "bytes=0-1" },
    signal: AbortSignal.timeout(probeTimeoutMs),
  })
  if (!response.ok) {
    throw new Error(`The HLS playback canary returned HTTP ${response.status}.`)
  }
  await response.arrayBuffer()
  return response.status
}

async function runVercelHlsPlaybackProbe(
  playbackUrl: string,
): Promise<VideoPlaybackProbeResult> {
  const startedAt = performance.now()
  let status: number | null = null

  try {
    const masterUrl = new URL(playbackUrl)
    assertPublicVercelBlobUrl(masterUrl)
    const master = await fetchCanaryManifest(masterUrl)
    status = master.status
    const variantPath = master.body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && line.endsWith(".m3u8"))
    if (!variantPath) {
      throw new Error("The HLS playback canary master has no variant playlist.")
    }

    const variantUrl = resolveCanaryResource(masterUrl, variantPath)
    const variant = await fetchCanaryManifest(variantUrl)
    const initializationPath = variant.body.match(
      /^#EXT-X-MAP:URI="([^"]+)"/m,
    )?.[1]
    const segmentPath = variant.body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"))
    if (!initializationPath || !segmentPath) {
      throw new Error("The HLS playback canary variant is incomplete.")
    }

    const initializationUrl = resolveCanaryResource(
      variantUrl,
      initializationPath,
    )
    const segmentUrl = resolveCanaryResource(variantUrl, segmentPath)
    const [initializationStatus, segmentStatus] = await Promise.all([
      fetchCanaryMedia(initializationUrl),
      fetchCanaryMedia(segmentUrl),
    ])

    return {
      ok: true,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      resources: {
        master: master.status,
        variant: variant.status,
        initialization: initializationStatus,
        segment: segmentStatus,
      },
    }
  } catch (error) {
    return {
      ok: false,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "HLS playback probe failed.",
    }
  }
}

export function checkVercelHlsPlayback(
  playbackUrl: string,
): Promise<VideoPlaybackProbeResult> {
  const now = Date.now()
  const cached = cachedVercelHlsProbes.get(playbackUrl)
  if (cached && cached.expiresAt > now) {
    return cached.result
  }

  const result = runVercelHlsPlaybackProbe(playbackUrl)
  cachedVercelHlsProbes.set(playbackUrl, {
    expiresAt: now + probeCacheTtlMs,
    result,
  })
  return result
}
