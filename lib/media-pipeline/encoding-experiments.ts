import type { MediaRenditionProfile } from "./contracts"
import { renditionFfmpegArguments } from "./ffmpeg"

export type DeliveryCandidate = {
  name: string; codec: "h264" | "hevc"; bytes: number; encodingMs: number
  ssim: number | null; vmaf: number | null; valid: boolean
}

/** Offline experiment only. Production stays on the validated encoder/manifest. */
export function experimentalRenditionArguments(input: Parameters<typeof renditionFfmpegArguments>[0],
  codec: "h264" | "hevc") {
  const args = renditionFfmpegArguments(input)
  if (codec === "h264") return args
  const replace = (flag: string, value: string) => { args[args.indexOf(flag) + 1] = value }
  replace("-c:v", "libx265")
  replace("-profile:v", "main")
  // Level signalling is codec-specific; allow x265 to select it from the stream.
  const level = args.indexOf("-level:v"); args.splice(level, 2)
  const tune = args.indexOf("-tune"); args.splice(tune, 2)
  const options = args.indexOf("-x264-params")
  args[options] = "-x265-params"
  args[options + 1] = "pools=1:frame-threads=1:scenecut=0:open-gop=0:repeat-headers=1"
  args.splice(args.indexOf("-pix_fmt"), 0, "-tag:v", "hvc1")
  return args
}

/** Choose per clip only when a matched-reference quality gate and byte saving pass.
 * This returns an experiment recommendation, never an automatic production rollout. */
export function selectVerifiedDeliveryCandidate(baseline: DeliveryCandidate, candidates: DeliveryCandidate[]) {
  const baselineSSIM = baseline.ssim
  if (!baseline.valid || !Number.isFinite(baseline.bytes) || baseline.bytes <= 0 ||
      !Number.isFinite(baseline.encodingMs) || baseline.encodingMs <= 0 ||
      baselineSSIM == null || !Number.isFinite(baselineSSIM)) return baseline
  return candidates.filter(candidate => candidate.valid && Number.isFinite(candidate.bytes) && candidate.bytes > 0 &&
    Number.isFinite(candidate.encodingMs) && candidate.encodingMs > 0 && candidate.encodingMs <= Math.max(baseline.encodingMs * 3, 1000) &&
    candidate.bytes <= baseline.bytes * 0.85 && candidate.ssim != null && Number.isFinite(candidate.ssim) &&
    candidate.ssim >= Math.max(0.97, baselineSSIM - 0.005) &&
    (baseline.vmaf == null || (candidate.vmaf != null && Number.isFinite(candidate.vmaf) && candidate.vmaf >= Math.max(90, baseline.vmaf - 1))))
    .sort((a, b) => a.bytes - b.bytes)[0] ?? baseline
}

export const deliveryExperimentProfiles: { name: string; codec: "h264" | "hevc"; crf: number }[] = [
  { name: "baseline-h264", codec: "h264", crf: 23 },
  { name: "efficient-h264", codec: "h264", crf: 25 },
  { name: "efficient-hevc", codec: "hevc", crf: 26 },
]
export function experimentProfile(base: MediaRenditionProfile, crf: number): MediaRenditionProfile { return { ...base, crf } }
