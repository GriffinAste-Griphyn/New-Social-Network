import { createCloudflareStreamPlaybackUrl } from "@/lib/story-storage"

export type VideoPlaybackProbeResult = {
  ok: boolean
  status: number | null
  latencyMs: number
  checkedAt: string
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

function validCloudflareStreamUid(uid: string) {
  return /^[a-f0-9]{32}$/i.test(uid)
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
