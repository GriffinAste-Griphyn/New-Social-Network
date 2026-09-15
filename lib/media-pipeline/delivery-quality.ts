/** Select exact advertised renditions; bandwidth hints are not rendition IDs. */
export function deliveryVariants(master: string, manifestURL: string) {
  if (!master.startsWith("#EXTM3U")) throw new Error("Invalid HLS master")
  const lines = master.split(/\r?\n/).map(line => line.trim())
  const attribute = (line: string, name: string) =>
    line.match(new RegExp(`(?:^|,)${name}=("[^"]*"|[^,]*)`))?.[1]?.replace(/^"|"$/g, "")
  const absolute = (reference: string) => {
    const url = new URL(reference, manifestURL), base = new URL(manifestURL)
    if (url.protocol !== "https:" || url.origin !== base.origin || url.username || url.password) {
      throw new Error("Unexpected provider resource")
    }
    return url.toString()
  }
  const variants = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue
    const info = lines[i].slice("#EXT-X-STREAM-INF:".length)
    const dimensions = attribute(info, "RESOLUTION")?.match(/^(\d+)x(\d+)$/)
    const bandwidth = Number(attribute(info, "BANDWIDTH"))
    if (!dimensions || !Number.isFinite(bandwidth) || bandwidth <= 0) continue
    const uri = lines[i + 1]
    if (!uri || uri.startsWith("#")) throw new Error("Missing rendition playlist")
    const audioGroup = attribute(info, "AUDIO")
    const audio = audioGroup ? lines.filter(line => line.startsWith("#EXT-X-MEDIA:") &&
      attribute(line.slice(13), "TYPE") === "AUDIO" && attribute(line.slice(13), "GROUP-ID") === audioGroup) : []
    if (audioGroup && !audio.length) throw new Error("Missing rendition audio group")
    const media = audio.map(line => line.replace(/URI="([^"]+)"/, (_, reference: string) => `URI="${absolute(reference)}"`))
    variants.push({ width: Number(dimensions[1]), height: Number(dimensions[2]), bandwidth,
      playlist: ["#EXTM3U", "#EXT-X-VERSION:7", ...media, lines[i], absolute(uri), ""].join("\n") })
  }
  if (!variants.length) throw new Error("No advertised renditions")
  return variants
}

/** All renditions are scored at the same source-sized display, including upscale loss. */
export function deliveryComparisonGraph(width: number, height: number, frameRate: number) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value >= 2 && value <= 8192) ||
      !Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 120) throw new Error("Invalid comparison geometry")
  const scale = Math.min(1, 1080 / Math.min(width, height), 1920 / Math.max(width, height))
  const w = Math.max(2, Math.round(width * scale / 2) * 2)
  const h = Math.max(2, Math.round(height * scale / 2) * 2)
  const normalize = `fps=${frameRate},scale=${w}:${h}:flags=lanczos,setsar=1,format=yuv420p,setpts=PTS-STARTPTS`
  return `[0:v]${normalize}[dist];[1:v]${normalize}[ref];[dist][ref]`
}
