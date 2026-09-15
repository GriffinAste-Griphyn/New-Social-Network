/** Provider-owned, signed HLS metadata only; this never exposes a private draft. */
export type VerifiedProviderPlayback = {
  inputWidth: number
  inputHeight: number
  width: number
  height: number
  verifiedAt: string
}

function attribute(line: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return line.match(new RegExp(`(?:^|,)${escaped}=("[^"]*"|[^,]*)`))?.[1]?.replace(/^"|"$/g, "")
}

export function selectVerifiedPlaybackVariant(master: string, inputWidth: number, inputHeight: number) {
  if (!master.startsWith("#EXTM3U") || !Number.isSafeInteger(inputWidth) || !Number.isSafeInteger(inputHeight) ||
      inputWidth < 240 || inputHeight < 240 || inputWidth > 8192 || inputHeight > 8192) return null
  const scale = Math.min(1, 1080 / Math.min(inputWidth, inputHeight), 1920 / Math.max(inputWidth, inputHeight))
  const lines = master.split(/\r?\n/)
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue
    const info = lines[i].slice("#EXT-X-STREAM-INF:".length)
    const dimensions = attribute(info, "RESOLUTION")?.match(/^(\d+)x(\d+)$/)
    const codecs = attribute(info, "CODECS")?.split(",") ?? []
    // Conservative AAC + AVC path. Unknown, silent-only, HDR/HEVC metadata waits for full readiness.
    if (!dimensions || !codecs.some(codec => /^avc1\.[a-f0-9]{6}$/i.test(codec)) ||
        !codecs.includes("mp4a.40.2")) continue
    const width = Number(dimensions[1]), height = Number(dimensions[2])
    const uri = lines[i + 1].trim()
    if (!uri || uri.startsWith("#") || width < inputWidth * scale - 2 || height < inputHeight * scale - 2 ||
        Math.abs(width / height - inputWidth / inputHeight) > 0.02) continue
    const group = attribute(info, "AUDIO")
    const audioLine = group ? lines.find(line => line.startsWith("#EXT-X-MEDIA:") &&
      attribute(line.slice("#EXT-X-MEDIA:".length), "TYPE") === "AUDIO" &&
      attribute(line.slice("#EXT-X-MEDIA:".length), "GROUP-ID") === group) : undefined
    const audioUri = audioLine ? attribute(audioLine.slice("#EXT-X-MEDIA:".length), "URI") : undefined
    if (group && !audioUri) continue
    return { width, height, uri, audioUri }
  }
  return null
}

export function isVerifiedProviderPlayback(input: { width: number | null; height: number | null; verifiedPlayback?: VerifiedProviderPlayback }) {
  const proof = input.verifiedPlayback
  if (!proof || proof.inputWidth !== input.width || proof.inputHeight !== input.height ||
      !Number.isFinite(Date.parse(proof.verifiedAt)) || Date.parse(proof.verifiedAt) > Date.now()) return false
  const master = `#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=${proof.width}x${proof.height},CODECS="avc1.640029,mp4a.40.2"\nvariant.m3u8`
  return selectVerifiedPlaybackVariant(master, proof.inputWidth, proof.inputHeight) !== null
}

function sameProviderResource(reference: string, base: string) {
  const url = new URL(reference, base), origin = new URL(base)
  if (url.origin !== origin.origin || url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Unexpected provider playback resource")
  }
  return url.toString()
}

async function boundedPlaylist(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, redirect: "error", cache: "no-store" })
  if (!response.ok || !response.body) throw new Error("Provider playlist unavailable")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > 64 * 1024) throw new Error("Provider playlist exceeds verification limit")
      chunks.push(result.value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  return Buffer.concat(chunks).toString("utf8")
}

export async function verifyProviderPlayback(url: string, inputWidth: number, inputHeight: number): Promise<VerifiedProviderPlayback | null> {
  const signal = AbortSignal.timeout(1500)
  try {
    const master = await boundedPlaylist(url, signal)
    const variant = selectVerifiedPlaybackVariant(master, inputWidth, inputHeight)
    if (!variant) return null
    const variantUrl = sameProviderResource(variant.uri, url)
    const playlistUrls = [variantUrl, ...(variant.audioUri ? [sameProviderResource(variant.audioUri, url)] : [])]
    const playlists = await Promise.all(playlistUrls.map(resource => boundedPlaylist(resource, signal)))
    const resources: string[] = []
    for (let index = 0; index < playlists.length; index++) {
      const playlist = playlists[index]
      if (!playlist.startsWith("#EXTM3U") || !playlist.includes("#EXT-X-ENDLIST") || playlist.includes("#EXT-X-GAP") ||
          playlist.includes("#EXT-X-KEY")) return null
      const segments = playlist.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"))
      const durations = [...playlist.matchAll(/^#EXTINF:([\d.]+),/gm)].map(match => Number(match[1]))
      if (!segments.length || segments.length !== durations.length || durations.some(duration => !Number.isFinite(duration) || duration <= 0)) return null
      const map = playlist.match(/^#EXT-X-MAP:URI="([^"]+)"/m)?.[1]
      for (const reference of [map, segments[0]]) {
        if (reference) resources.push(sameProviderResource(reference, playlistUrls[index]))
      }
    }
    // Check initialization and first video/audio resources without fetching media contents.
    const heads = await Promise.all(resources.map(resource => fetch(resource,
      { method: "HEAD", signal, redirect: "error", cache: "no-store" })))
    if (heads.some(response => !response.ok)) return null
    return { inputWidth, inputHeight, width: variant.width, height: variant.height, verifiedAt: new Date().toISOString() }
  } catch { return null }
}
