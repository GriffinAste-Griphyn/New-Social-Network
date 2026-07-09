const defaultLegacyOriginalVideoSunset = Date.parse("2026-08-09T00:00:00.000Z")
const legacyCompletionGraceMs = 24 * 60 * 60 * 1_000

export function allowsLegacyOriginalVideoStory(input: {
  request: Request
  phase: "prepare" | "complete"
  now?: number
}) {
  if (
    input.request.headers
      .get("X-UBEYE-Media-Pipeline")
      ?.trim()
      .toLowerCase() === "hls-v2"
  ) {
    return false
  }

  const explicitSetting = process.env.ALLOW_LEGACY_ORIGINAL_VIDEO_UPLOADS

  if (explicitSetting === "false") {
    return false
  }

  if (explicitSetting === "true") {
    return true
  }

  const configuredSunset = Date.parse(
    process.env.LEGACY_ORIGINAL_VIDEO_UPLOADS_UNTIL ?? "",
  )
  const sunset = Number.isFinite(configuredSunset)
    ? configuredSunset
    : defaultLegacyOriginalVideoSunset
  const deadline =
    input.phase === "complete" ? sunset + legacyCompletionGraceMs : sunset

  return (input.now ?? Date.now()) < deadline
}

export const legacyOriginalVideoRetiredResponse = {
  error:
    "This video upload path was retired. Update UBEYE to upload adaptive video.",
  code: "legacy_video_path_retired",
} as const
