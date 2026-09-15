/** Exact selection is opt-in; older players continue to receive the full ladder. */
export const renditionSelectionVersion = "exact-v1"

export function requestedRendition(url: string): 720 | 1080 | null {
  const value = new URL(url).searchParams.get("rendition")
  return value === "1080" ? 1080 : value === "720" ? 720 : null
}

function attribute(line: string, name: string) {
  return line.match(new RegExp(`(?:^|,)${name}=("[^"]*"|[^,]*)`))?.[1]?.replace(/^"|"$/g, "")
}

/** Keep the selected variant's audio, subtitles and codec declarations together. */
export function selectStoryRendition(master: string, baseURL: string, target: 720 | 1080) {
  if (!master.startsWith("#EXTM3U") || master.length > 64 * 1024 || /#EXT-X-(SESSION-KEY|DEFINE):/.test(master)) {
    throw new Error("Unsupported story master")
  }
  const absolute = (reference: string) => {
    const url = new URL(reference, baseURL)
    if (url.protocol !== "https:" || url.origin !== new URL(baseURL).origin || url.username || url.password) {
      throw new Error("Unexpected rendition resource")
    }
    return url.toString()
  }
  const lines = master.split(/\r?\n/).map(line => line.trim())
  const variants = lines.flatMap((line, index) => {
    if (!line.startsWith("#EXT-X-STREAM-INF:")) return []
    const info = line.slice(18)
    const dimensions = attribute(info, "RESOLUTION")?.match(/^(\d+)x(\d+)$/)
    const bandwidth = Number(attribute(info, "BANDWIDTH"))
    const uri = lines[index + 1]
    if (!dimensions || !uri || uri.startsWith("#") || !Number.isFinite(bandwidth) || bandwidth <= 0) {
      throw new Error("Invalid rendition")
    }
    const width = Number(dimensions[1]), height = Number(dimensions[2])
    if (Math.min(width, height) < 1 || Math.max(width, height) > 8192) throw new Error("Invalid dimensions")
    return [{ line, info, width, height, bandwidth, uri: absolute(uri) }]
  }).filter(variant => Math.min(variant.width, variant.height) <= target)
  // Never upscale a smaller source. Equal-resolution variants prefer lower bandwidth.
  variants.sort((a, b) => b.width * b.height - a.width * a.height || a.bandwidth - b.bandwidth)
  const selected = variants[0]
  if (!selected) throw new Error("Requested rendition unavailable")
  const media: string[] = []
  for (const type of ["AUDIO", "VIDEO", "SUBTITLES", "CLOSED-CAPTIONS"]) {
    const group = attribute(selected.info, type)
    if (!group || group === "NONE") continue
    const entries = lines.filter(line => line.startsWith("#EXT-X-MEDIA:") &&
      attribute(line.slice(13), "TYPE") === type && attribute(line.slice(13), "GROUP-ID") === group)
    if (!entries.length) throw new Error("Missing rendition media group")
    media.push(...entries.map(line => line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${absolute(uri)}"`)))
  }
  const globals = lines.filter(line => /^#EXT-X-(VERSION:|INDEPENDENT-SEGMENTS\s*$)/.test(line))
  return { width: selected.width, height: selected.height, bandwidth: selected.bandwidth,
    playlist: ["#EXTM3U", ...globals, ...media, selected.line, selected.uri, ""].join("\n") }
}

export async function fetchStoryMaster(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: "error", cache: "no-store" })
  if (!response.ok || !response.body) throw new Error("Story master unavailable")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 64 * 1024) throw new Error("Story master too large")
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  return Buffer.concat(chunks).toString("utf8")
}

export function renditionResponse(master: string, baseURL: string, target: 720 | 1080) {
  const selected = selectStoryRendition(master, baseURL, target)
  return new Response(selected.playlist, { headers: {
    "Content-Type": "application/vnd.apple.mpegurl",
    "Cache-Control": "private, no-store",
    "CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-UBEYE-Rendition": `${selected.width}x${selected.height}`,
  } })
}
