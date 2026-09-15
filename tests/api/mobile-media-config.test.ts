import { afterEach, describe, expect, it, vi } from "vitest"

import { getMobileMediaConfig } from "@/lib/mobile-media-config"

const originalEnv = { ...process.env }

const mediaConfigEnvironmentNames = [
  "MOBILE_MEDIA_CONFIG_VERSION",
  "MOBILE_ADAPTIVE_START_CANARY_PERCENT",
  "MOBILE_ADAPTIVE_UPLOAD_CANARY_PERCENT",
  "MOBILE_ADAPTIVE_UPLOAD_ENCODING_ENABLED",
  "MOBILE_ADAPTIVE_UPLOAD_CHUNKS_ENABLED",
  "VERCEL_BLOB_SUSPENDED_MODE",
  "STORY_IMAGE_STORAGE_PROVIDER",
  "CLOUDFLARE_R2_ACCOUNT_ID",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_ORIGINALS_BUCKET",
  "CLOUDFLARE_R2_DELIVERY_BUCKET",
  "CLOUDFLARE_R2_PUBLIC_BASE_URL",
  "MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED",
  "MOBILE_MEDIA_PREHEAT_CANARY_PERCENT",
  "MOBILE_IMAGE_DERIVATIVE_UPLOAD_ENABLED",
  "MOBILE_UPLOAD_CHUNK_BYTES",
  "MOBILE_BLOB_MULTIPART_THRESHOLD_BYTES_CONSTRAINED",
  "MOBILE_BLOB_MULTIPART_THRESHOLD_BYTES_STANDARD",
  "MOBILE_BLOB_MULTIPART_PART_BYTES_CONSTRAINED",
  "MOBILE_BLOB_MULTIPART_PART_BYTES_STANDARD",
  "MOBILE_BLOB_MULTIPART_CONCURRENCY_CONSTRAINED",
  "MOBILE_BLOB_MULTIPART_CONCURRENCY_STANDARD",
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
      version: "2026-09-13.6",
      rolloutProfile: "preheat-canary",
      blobUploadsAvailable: true,
      profilePhotoUploadsAvailable: true,
      storyImageUploadsAvailable: true,
      imageDerivativeUploadEnabled: true,
      uploadChunkBytes: 50 * 1024 * 1024,
      blobMultipartThresholdBytes: {
        constrained: 32 * 1024 * 1024,
        standard: 64 * 1024 * 1024,
      },
      blobMultipartPartBytes: {
        constrained: 8 * 1024 * 1024,
        standard: 16 * 1024 * 1024,
      },
      blobMultipartConcurrency: { constrained: 2, standard: 4 },
      imagePreheatLimit: { constrained: 2, standard: 4 },
      stackPreheatLimit: { constrained: 2, standard: 4 },
      preparedPlayerLimit: { constrained: 0, standard: 0 },
      persistentVideoPreheatLimit: { constrained: 2, standard: 2 },
      offlineHLSPreheatLimit: { constrained: 0, standard: 0 },
      offlineHLSCacheMaxAssets: 0,
      startupStreamingPeakBitRate: {
        constrained: 3_000_000,
        standard: 8_000_000,
      },
      startupStreamingMaximumResolution: {
        constrained: { width: 720, height: 1280 },
        standard: { width: 1080, height: 1920 },
      },
      preparedStreamingPeakBitRate: {
        constrained: 3_000_000,
        standard: 8_000_000,
      },
      preparedStreamingMaximumResolution: {
        constrained: { width: 720, height: 1280 },
        standard: { width: 1080, height: 1920 },
      },
    })
  })

  it("publishes the reversible Blob upload availability switch", () => {
    process.env.VERCEL_BLOB_SUSPENDED_MODE = "true"

    expect(getMobileMediaConfig()).toMatchObject({
      blobUploadsAvailable: false,
      profilePhotoUploadsAvailable: false,
      storyImageUploadsAvailable: false,
    })
  })

  it("keeps story photo uploads available through Cloudflare R2 while Blob is paused", () => {
    process.env.VERCEL_BLOB_SUSPENDED_MODE = "true"
    process.env.STORY_IMAGE_STORAGE_PROVIDER = "cloudflare-r2"
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = "account"
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "access"
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "secret"
    process.env.CLOUDFLARE_R2_ORIGINALS_BUCKET = "originals"
    process.env.CLOUDFLARE_R2_DELIVERY_BUCKET = "delivery"
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = "https://media.example.com"

    expect(getMobileMediaConfig({ clientBuild: 399 })).toMatchObject({
      blobUploadsAvailable: false,
      profilePhotoUploadsAvailable: true,
      storyImageUploadsAvailable: false,
    })
    expect(getMobileMediaConfig({ clientBuild: 400 })).toMatchObject({
      blobUploadsAvailable: false,
      profilePhotoUploadsAvailable: true,
      storyImageUploadsAvailable: true,
    })
  })

  it("clamps remotely configured limits to safe bounds", () => {
    process.env.MOBILE_IMAGE_PREHEAT_LIMIT_STANDARD = "999"
    process.env.MOBILE_BLOB_MULTIPART_THRESHOLD_BYTES_CONSTRAINED = "1"
    process.env.MOBILE_BLOB_MULTIPART_PART_BYTES_STANDARD = "999999999"
    process.env.MOBILE_BLOB_MULTIPART_CONCURRENCY_CONSTRAINED = "99"
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
      blobMultipartThresholdBytes: { constrained: 8 * 1024 * 1024 },
      blobMultipartPartBytes: { standard: 64 * 1024 * 1024 },
      blobMultipartConcurrency: { constrained: 4 },
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
        constrained: 3_000_000,
        standard: 8_000_000,
      },
    })
    process.env.MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED = "false"
    expect(getMobileMediaConfig({ clientBuild: 255 })).toMatchObject({
      rolloutProfile: "baseline",
      stackPreheatLimit: { standard: 2 },
      preparedPlayerLimit: { constrained: 0, standard: 3 },
      persistentVideoPreheatLimit: { constrained: 1, standard: 2 },
      startupStreamingPeakBitRate: {
        constrained: 2_000_000,
        standard: 4_000_000,
      },
      offlineHLSPreheatLimit: { constrained: 0, standard: 0 },
    })
  })
})


describe("adaptive startup rollout", () => {
  afterEach(() => { process.env = { ...originalEnv } })

  it("permits three prepared players for build 424 while preserving older canary limits and overrides", () => {
    for (const name of mediaConfigEnvironmentNames) delete process.env[name]
    expect(getMobileMediaConfig({ clientBuild: 423, canaryBucket: 0 }).preparedPlayerLimit.standard).toBe(2)
    expect(getMobileMediaConfig({ clientBuild: 424, canaryBucket: 0 }).preparedPlayerLimit.standard).toBe(3)
    expect(getMobileMediaConfig({ clientBuild: 424, canaryBucket: 99 }).preparedPlayerLimit.standard).toBe(3)
    expect(getMobileMediaConfig({ clientBuild: 424, canaryBucket: 0 }).startupMode).toBe("adaptive")
    process.env.MOBILE_PREPARED_PLAYER_LIMIT_STANDARD_CANARY = "1"
    expect(getMobileMediaConfig({ clientBuild: 424, canaryBucket: 0 }).preparedPlayerLimit.standard).toBe(1)
  })

  it("gates the canary on supported builds and stable cohort boundaries", () => {
    delete process.env.MOBILE_ADAPTIVE_START_CANARY_PERCENT
    expect(getMobileMediaConfig({ clientBuild: 421, canaryBucket: 0 }).startupMode).toBe("focused")
    expect(getMobileMediaConfig({ clientBuild: 422, canaryBucket: 19 }).startupMode).toBe("adaptive")
    expect(getMobileMediaConfig({ clientBuild: 422, canaryBucket: 20 }).startupMode).toBe("focused")
    expect(getMobileMediaConfig({ clientBuild: 422 }).startupMode).toBe("focused")
    process.env.MOBILE_ADAPTIVE_START_CANARY_PERCENT = "0"
    expect(getMobileMediaConfig({ clientBuild: 422, canaryBucket: 0 }).startupMode).toBe("focused")
  })

  it("reduces speculative work while keeping the full adaptive ladder", () => {
    for (const name of Object.keys(process.env)) if (name.startsWith("MOBILE_")) delete process.env[name]
    process.env.MOBILE_STARTUP_STREAMING_PEAK_BITRATE_STANDARD = "8000000"
    expect(getMobileMediaConfig({ clientBuild: 422, canaryBucket: 0 })).toMatchObject({
      startupExperiment: "adaptive-canary", startupMode: "adaptive",
      stackPreheatLimit: { standard: 2 }, preparedPlayerLimit: { standard: 2 },
      persistentVideoPreheatLimit: { constrained: 0, standard: 1 },
      offlineHLSPreheatLimit: { standard: 0 },
      startupStreamingPeakBitRate: { standard: 4000000 },
      preparedStreamingPeakBitRate: { standard: 8000000 },
    })
  })
})

describe("adaptive upload rollout", () => {
  it("preserves source quality by default for existing and new builds", () => {
    delete process.env.MOBILE_ADAPTIVE_UPLOAD_ENCODING_ENABLED
    expect(getMobileMediaConfig({clientBuild:433,canaryBucket:99}).adaptiveUploadEncodingEnabled).toBe(false)
    expect(getMobileMediaConfig({clientBuild:432,canaryBucket:99}).adaptiveUploadEncodingEnabled).toBe(false)
    process.env.MOBILE_ADAPTIVE_UPLOAD_ENCODING_ENABLED = "false"
    expect(getMobileMediaConfig({clientBuild:433,canaryBucket:99}).adaptiveUploadEncodingEnabled).toBe(false)
  })
  afterEach(() => { process.env = { ...originalEnv } })
  it("requires a supported build, stable cohort and explicit independent switches", () => {
    process.env.MOBILE_ADAPTIVE_UPLOAD_CANARY_PERCENT = "10"
    process.env.MOBILE_ADAPTIVE_UPLOAD_ENCODING_ENABLED = "true"
    process.env.MOBILE_ADAPTIVE_UPLOAD_CHUNKS_ENABLED = "true"
    expect(getMobileMediaConfig({ clientBuild: 425, canaryBucket: 0 }).adaptiveUploadEncodingEnabled).toBe(false)
    expect(getMobileMediaConfig({ clientBuild: 426 }).adaptiveUploadEncodingEnabled).toBe(false)
    expect(getMobileMediaConfig({ clientBuild: 426, canaryBucket: 10 }).uploadExperiment).toBe("baseline")
    expect(getMobileMediaConfig({ clientBuild: 426, canaryBucket: 0 })).toMatchObject({
      uploadExperiment: "adaptive-canary", adaptiveUploadEncodingEnabled: true, adaptiveUploadChunksEnabled: true,
    })
    process.env.MOBILE_ADAPTIVE_UPLOAD_ENCODING_ENABLED = "false"
    expect(getMobileMediaConfig({ clientBuild: 426, canaryBucket: 0 })).toMatchObject({
      adaptiveUploadEncodingEnabled: false, adaptiveUploadChunksEnabled: true,
    })
    process.env.MOBILE_ADAPTIVE_UPLOAD_CHUNKS_ENABLED = "false"
    expect(getMobileMediaConfig({ clientBuild: 426, canaryBucket: 0 }).uploadExperiment).toBe("baseline")
  })
})

describe("build 440 adaptive rollout", () => {
  afterEach(() => vi.unstubAllEnvs())
  it("uses adaptive playback for new-build buckets without expanding older cohorts", () => {
    vi.stubEnv("MOBILE_ADAPTIVE_START_PERCENT_BUILD_440", "100")
    vi.stubEnv("MOBILE_ADAPTIVE_START_CANARY_PERCENT", "20")
    expect(getMobileMediaConfig({ clientBuild: 440, canaryBucket: 99 }).startupMode).toBe("adaptive")
    expect(getMobileMediaConfig({ clientBuild: 439, canaryBucket: 99 }).startupMode).toBe("focused")
    expect(getMobileMediaConfig({ clientBuild: 440 }).startupMode).toBe("focused")
    vi.stubEnv("MOBILE_ADAPTIVE_START_PERCENT_BUILD_440", "0")
    expect(getMobileMediaConfig({ clientBuild: 440, canaryBucket: 0 }).startupMode).toBe("focused")
  })
})

describe("build 445 startup quality", () => {
  afterEach(() => vi.unstubAllEnvs())
  it("keeps the full adaptive ladder and starts with HD allowed in every new-build cohort", () => {
    for (const name of Object.keys(process.env)) if (name.startsWith("MOBILE_")) vi.stubEnv(name, "")
    for (const canaryBucket of [0, 19, 99]) {
      expect(getMobileMediaConfig({ clientBuild: 445, canaryBucket })).toMatchObject({
        startupMode: "adaptive", adaptiveUploadEncodingEnabled: false,
        startupStreamingPeakBitRate: { standard: 8_000_000 },
        startupStreamingMaximumResolution: { standard: { width: 1080, height: 1920 } },
      })
    }
    expect(getMobileMediaConfig({ clientBuild: 444, canaryBucket: 0 }).startupStreamingMaximumResolution.standard).toEqual({ width: 720, height: 1280 })
  })
  it("keeps explicit rollback limits and low-data restrictions", () => {
    vi.stubEnv("MOBILE_STARTUP_MAX_WIDTH_STANDARD", "720")
    vi.stubEnv("MOBILE_STARTUP_MAX_HEIGHT_STANDARD", "1280")
    expect(getMobileMediaConfig({ clientBuild: 445, canaryBucket: 0 }).startupStreamingMaximumResolution.standard).toEqual({ width: 720, height: 1280 })
    expect(getMobileMediaConfig({ clientBuild: 445, canaryBucket: 0 }).startupStreamingMaximumResolution.constrained).toEqual({ width: 720, height: 1280 })
  })
})
