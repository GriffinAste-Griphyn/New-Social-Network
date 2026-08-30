import { describe, expect, it } from "vitest"

import { planNextMediaProcessingStage } from "@/lib/media-pipeline/direct-processing"
import { mediaProcessingRetryDelayMs } from "@/lib/media-pipeline/jobs"

const source = {
  width: 1080,
  height: 1920,
  durationMs: 10_000,
  frameRate: 30,
  videoCodec: "h264",
  audioCodec: "aac",
  hasAudio: true,
  rotation: 0,
}

describe("direct media processing stage planning", () => {
  it("backs off repeated transient failures without delaying a yielded run", () => {
    expect(mediaProcessingRetryDelayMs(0)).toBe(0)
    expect(mediaProcessingRetryDelayMs(1)).toBe(5_000)
    expect(mediaProcessingRetryDelayMs(4)).toBe(40_000)
    expect(mediaProcessingRetryDelayMs(20)).toBe(120_000)
  })

  it("bootstraps inspection and poster generation together", () => {
    expect(
      planNextMediaProcessingStage({
        source: null,
        hasPoster: false,
        readyVariantLabels: new Set(),
      }),
    ).toEqual({ kind: "bootstrap" })

    expect(
      planNextMediaProcessingStage({
        source,
        hasPoster: false,
        readyVariantLabels: new Set(),
      }),
    ).toEqual({ kind: "bootstrap" })
  })

  it("encodes the fastest high-quality phone rendition first", () => {
    expect(
      planNextMediaProcessingStage({
        source,
        hasPoster: true,
        hasAudioRendition: true,
        readyVariantLabels: new Set(),
      }),
    ).toMatchObject({
      kind: "rendition",
      profile: { label: "540p" },
    })
  })

  it("bootstraps the shared audio rendition before publishing video", () => {
    expect(
      planNextMediaProcessingStage({
        source,
        hasPoster: true,
        hasAudioRendition: false,
        readyVariantLabels: new Set(),
      }),
    ).toEqual({ kind: "bootstrap" })
  })

  it("publishes each verified rendition set before encoding more", () => {
    expect(
      planNextMediaProcessingStage({
        source,
        hasPoster: true,
        hasAudioRendition: true,
        readyVariantLabels: new Set(["540p"]),
        publishedVariantLabels: new Set(),
      }),
    ).toMatchObject({
      kind: "publish",
      profiles: [{ label: "540p" }],
      isFinal: false,
    })

    expect(
      planNextMediaProcessingStage({
        source,
        hasPoster: true,
        hasAudioRendition: true,
        readyVariantLabels: new Set(["540p"]),
        publishedVariantLabels: new Set(["540p"]),
      }),
    ).toMatchObject({
      kind: "rendition",
      profile: { label: "720p" },
    })
  })

  it("finalizes idempotently after every eligible rendition is published", () => {
    expect(
      planNextMediaProcessingStage({
        source,
        hasPoster: true,
        hasAudioRendition: true,
        readyVariantLabels: new Set(["360p", "540p", "720p", "1080p"]),
        publishedVariantLabels: new Set([
          "360p",
          "540p",
          "720p",
          "1080p",
        ]),
      }),
    ).toMatchObject({
      kind: "publish",
      isFinal: true,
      profiles: [
        { label: "360p" },
        { label: "540p" },
        { label: "720p" },
        { label: "1080p" },
      ],
    })
  })
})
