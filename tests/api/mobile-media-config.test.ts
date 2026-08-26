import { afterEach, describe, expect, it } from "vitest"

import { getMobileMediaConfig } from "@/lib/mobile-media-config"

const originalEnv = { ...process.env }

const mediaConfigEnvironmentNames = [
  "MOBILE_MEDIA_CONFIG_VERSION",
  "MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED",
  "MOBILE_MEDIA_PREHEAT_CANARY_PERCENT",
  "MOBILE_IMAGE_DERIVATIVE_UPLOAD_ENABLED",
  "MOBILE_IMAGE_PREHEAT_LIMIT_CONSTRAINED",
  "MOBILE_IMAGE_PREHEAT_LIMIT_STANDARD",
  "MOBILE_STACK_PREHEAT_LIMIT_CONSTRAINED",
  "MOBILE_STACK_PREHEAT_LIMIT_STANDARD",
  "MOBILE_STACK_PREHEAT_LIMIT_STANDARD_CANARY",
  "MOBILE_PREPARED_PLAYER_LIMIT_CONSTRAINED",
  "MOBILE_PREPARED_PLAYER_LIMIT_STANDARD",
  "MOBILE_PREPARED_PLAYER_LIMIT_STANDARD_CANARY",
  "MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_CONSTRAINED",
  "MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD",
  "MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD_CANARY",
  "MOBILE_OFFLINE_HLS_PREHEAT_LIMIT_STANDARD",
  "MOBILE_OFFLINE_HLS_CACHE_MAX_ASSETS",
  "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_CONSTRAINED",
  "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_CONSTRAINED_CANARY",
  "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_STANDARD",
  "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_STANDARD_CANARY",
  "MOBILE_STARTUP_MAX_WIDTH_CONSTRAINED",
  "MOBILE_STARTUP_MAX_HEIGHT_CONSTRAINED",
  "MOBILE_STARTUP_MAX_WIDTH_STANDARD",
  "MOBILE_STARTUP_MAX_HEIGHT_STANDARD",
  "MOBILE_PREPARED_STREAMING_PEAK_BITRATE_CONSTRAINED",
  "MOBILE_PREPARED_STREAMING_PEAK_BITRATE_STANDARD",
  "MOBILE_PREPARED_MAX_WIDTH_CONSTRAINED",
  "MOBILE_PREPARED_MAX_HEIGHT_CONSTRAINED",
  "MOBILE_PREPARED_MAX_WIDTH_STANDARD",
  "MOBILE_PREPARED_MAX_HEIGHT_STANDARD",
] as const

describe("mobile media runtime config", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("defaults to a bounded adjacent-media working set", () => {
    for (const name of mediaConfigEnvironmentNames) {
      delete process.env[name]
    }

    expect(getMobileMediaConfig()).toMatchObject({
      version: "2026-08-25.2",
      rolloutProfile: "preheat-canary",
      imageDerivativeUploadEnabled: true,
      imagePreheatLimit: { constrained: 2, standard: 4 },
      stackPreheatLimit: { constrained: 2, standard: 4 },
      preparedPlayerLimit: { constrained: 0, standard: 0 },
      persistentVideoPreheatLimit: { constrained: 2, standard: 2 },
      offlineHLSPreheatLimit: { constrained: 0, standard: 0 },
      offlineHLSCacheMaxAssets: 0,
      startupStreamingPeakBitRate: {
        constrained: 2_000_000,
        standard: 3_000_000,
      },
      startupStreamingMaximumResolution: {
        constrained: { width: 540, height: 960 },
        standard: { width: 720, height: 1280 },
      },
      preparedStreamingPeakBitRate: {
        constrained: 2_000_000,
        standard: 8_256_000,
      },
      preparedStreamingMaximumResolution: {
        constrained: { width: 540, height: 960 },
        standard: { width: 1080, height: 1920 },
      },
    })
  })

  it("clamps remotely configured limits to safe bounds", () => {
    process.env.MOBILE_IMAGE_PREHEAT_LIMIT_STANDARD = "999"
    process.env.MOBILE_STACK_PREHEAT_LIMIT_CONSTRAINED = "0"
    process.env.MOBILE_PREPARED_PLAYER_LIMIT_CONSTRAINED = "99"
    process.env.MOBILE_PREPARED_PLAYER_LIMIT_STANDARD = "99"
    process.env.MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD = "-5"
    process.env.MOBILE_OFFLINE_HLS_PREHEAT_LIMIT_STANDARD = "99"
    process.env.MOBILE_OFFLINE_HLS_CACHE_MAX_ASSETS = "99"
    process.env.MOBILE_PREPARED_STREAMING_PEAK_BITRATE_CONSTRAINED = "1"
    process.env.MOBILE_PREPARED_STREAMING_PEAK_BITRATE_STANDARD = "999999999"
    process.env.MOBILE_PREPARED_MAX_WIDTH_STANDARD = "99999"
    process.env.MOBILE_PREPARED_MAX_HEIGHT_STANDARD = "1"

    expect(getMobileMediaConfig()).toMatchObject({
      imagePreheatLimit: { standard: 8 },
      stackPreheatLimit: { constrained: 1 },
      preparedPlayerLimit: { standard: 0 },
      persistentVideoPreheatLimit: { standard: 0 },
      preparedStreamingPeakBitRate: {
        constrained: 1_500_000,
        standard: 20_000_000,
      },
      preparedStreamingMaximumResolution: {
        standard: { width: 2160, height: 1280 },
      },
    })
    expect(getMobileMediaConfig({ clientBuild: 255 })).toMatchObject({
      preparedPlayerLimit: { constrained: 1, standard: 4 },
      offlineHLSPreheatLimit: { constrained: 0, standard: 0 },
      offlineHLSCacheMaxAssets: 0,
    })
    expect(getMobileMediaConfig({ clientBuild: 320 })).toMatchObject({
      offlineHLSPreheatLimit: { constrained: 0, standard: 1 },
      offlineHLSCacheMaxAssets: 3,
    })
  })

  it("enables bounded offline HLS caching only for build 320 and newer", () => {
    expect(getMobileMediaConfig({ clientBuild: 319 })).toMatchObject({
      offlineHLSPreheatLimit: { constrained: 0, standard: 0 },
      offlineHLSCacheMaxAssets: 0,
    })
    expect(getMobileMediaConfig({ clientBuild: 320 })).toMatchObject({
      offlineHLSPreheatLimit: { constrained: 0, standard: 1 },
      offlineHLSCacheMaxAssets: 2,
    })
  })

  it("enables the prepared-player pool only for the fixed iOS build", () => {
    delete process.env.MOBILE_PREPARED_PLAYER_LIMIT_STANDARD

    expect(getMobileMediaConfig({ clientBuild: 253 })).toMatchObject({
      preparedPlayerLimit: { constrained: 0, standard: 0 },
    })
    expect(getMobileMediaConfig({ clientBuild: 254 })).toMatchObject({
      preparedPlayerLimit: { constrained: 0, standard: 0 },
    })
    expect(getMobileMediaConfig({ clientBuild: 255 })).toMatchObject({
      preparedPlayerLimit: { constrained: 1, standard: 3 },
    })
  })

  it("keeps an environment kill switch for the aggressive profile", () => {
    process.env.MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED = "true"

    expect(
      getMobileMediaConfig({ clientBuild: 255, canaryBucket: 24 }),
    ).toMatchObject({
      rolloutProfile: "preheat-canary",
      stackPreheatLimit: { standard: 4 },
      preparedPlayerLimit: { constrained: 1, standard: 3 },
      persistentVideoPreheatLimit: { constrained: 2, standard: 2 },
      startupStreamingPeakBitRate: {
        constrained: 2_000_000,
        standard: 3_000_000,
      },
    })
    process.env.MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED = "false"
    expect(getMobileMediaConfig({ clientBuild: 255 })).toMatchObject({
      rolloutProfile: "baseline",
      stackPreheatLimit: { standard: 2 },
      preparedPlayerLimit: { constrained: 0, standard: 3 },
      persistentVideoPreheatLimit: { constrained: 1, standard: 2 },
      startupStreamingPeakBitRate: {
        constrained: 4_000_000,
        standard: 6_000_000,
      },
      offlineHLSPreheatLimit: { constrained: 0, standard: 0 },
    })
  })
})
