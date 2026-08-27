export type RuntimeMediaConfig = {
  version: string
  rolloutProfile: "baseline" | "preheat-canary"
  imageDerivativeUploadEnabled: boolean
  qoeAccessLogSampleRate: number
  uploadChunkBytes: number
  mediaFileCacheMaxBytes: number
  imagePreheatLimit: {
    constrained: number
    standard: number
  }
  stackPreheatLimit: {
    constrained: number
    standard: number
  }
  preparedPlayerLimit: {
    constrained: number
    standard: number
  }
  persistentVideoPreheatLimit: {
    constrained: number
    standard: number
  }
  offlineHLSPreheatLimit: {
    constrained: number
    standard: number
  }
  offlineHLSCacheMaxAssets: number
  startupStreamingPeakBitRate: {
    constrained: number
    standard: number
  }
  startupStreamingMaximumResolution: {
    constrained: {
      width: number
      height: number
    }
    standard: {
      width: number
      height: number
    }
  }
  preparedStreamingPeakBitRate: {
    constrained: number
    standard: number
  }
  preparedStreamingMaximumResolution: {
    constrained: {
      width: number
      height: number
    }
    standard: {
      width: number
      height: number
    }
  }
}

function integerEnv(name: string, fallback: number, bounds: { min: number; max: number }) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(bounds.max, Math.max(bounds.min, parsed))
}

function floatEnv(name: string, fallback: number, bounds: { min: number; max: number }) {
  const parsed = Number.parseFloat(process.env[name] ?? "")

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(bounds.max, Math.max(bounds.min, parsed))
}

function booleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase()

  if (!raw) {
    return fallback
  }

  return ["1", "true", "yes", "on"].includes(raw)
}

const constrainedQualityVideoBitRate = 3_000_000
const fullQualityVideoBitRate = 8_000_000
const fullQualityVideoWidth = 1_080
const fullQualityVideoHeight = 1_920

export function getMobileMediaConfig(input: {
  clientBuild?: number | null
  canaryBucket?: number | null
} = {}): RuntimeMediaConfig {
  const supportsSafePlayerPreparation = (input.clientBuild ?? 0) >= 255
  const supportsOfflineHLSCaching = (input.clientBuild ?? 0) >= 320
  const aggressiveConfigEnabled = booleanEnv(
    "MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED",
    true,
  )

  return {
    version: process.env.MOBILE_MEDIA_CONFIG_VERSION?.trim() || "2026-08-26.1",
    rolloutProfile: aggressiveConfigEnabled ? "preheat-canary" : "baseline",
    imageDerivativeUploadEnabled: booleanEnv(
      "MOBILE_IMAGE_DERIVATIVE_UPLOAD_ENABLED",
      true,
    ),
    qoeAccessLogSampleRate: floatEnv("MOBILE_QOE_ACCESS_LOG_SAMPLE_RATE", 0.1, {
      min: 0,
      max: 1,
    }),
    uploadChunkBytes: integerEnv("MOBILE_UPLOAD_CHUNK_BYTES", 5 * 1024 * 1024, {
      min: 256 * 1024,
      max: 32 * 1024 * 1024,
    }),
    mediaFileCacheMaxBytes: integerEnv(
      "MOBILE_MEDIA_FILE_CACHE_MAX_BYTES",
      1024 * 1024 * 1024,
      { min: 128 * 1024 * 1024, max: 2 * 1024 * 1024 * 1024 },
    ),
    imagePreheatLimit: {
      constrained: integerEnv("MOBILE_IMAGE_PREHEAT_LIMIT_CONSTRAINED", 2, {
        min: 1,
        max: 4,
      }),
      standard: integerEnv("MOBILE_IMAGE_PREHEAT_LIMIT_STANDARD", 4, {
        min: 1,
        max: 8,
      }),
    },
    stackPreheatLimit: {
      constrained: integerEnv("MOBILE_STACK_PREHEAT_LIMIT_CONSTRAINED", 2, {
        min: 1,
        max: 4,
      }),
      standard: integerEnv("MOBILE_STACK_PREHEAT_LIMIT_STANDARD", aggressiveConfigEnabled ? 4 : 2, {
        min: 1,
        max: 8,
      }),
    },
    preparedPlayerLimit: {
      constrained: supportsSafePlayerPreparation
        ? integerEnv(
            "MOBILE_PREPARED_PLAYER_LIMIT_CONSTRAINED",
            aggressiveConfigEnabled ? 1 : 0,
            {
              min: 0,
              max: 1,
            },
          )
        : 0,
      standard: supportsSafePlayerPreparation
        ? integerEnv(
          "MOBILE_PREPARED_PLAYER_LIMIT_STANDARD",
            3,
            {
              min: 0,
              max: 4,
            },
          )
        : 0,
    },
    persistentVideoPreheatLimit: {
      constrained: integerEnv("MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_CONSTRAINED", aggressiveConfigEnabled ? 2 : 1, {
        min: 0,
        max: 4,
      }),
      standard: integerEnv("MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD", 2, {
        min: 0,
        max: 6,
      }),
    },
    offlineHLSPreheatLimit: {
      constrained: 0,
      standard: supportsOfflineHLSCaching
        ? integerEnv(
            "MOBILE_OFFLINE_HLS_PREHEAT_LIMIT_STANDARD",
            aggressiveConfigEnabled ? 1 : 0,
            { min: 0, max: 1 },
          )
        : 0,
    },
    offlineHLSCacheMaxAssets: supportsOfflineHLSCaching
      ? integerEnv("MOBILE_OFFLINE_HLS_CACHE_MAX_ASSETS", 2, {
          min: 0,
          max: 3,
        })
      : 0,
    startupStreamingPeakBitRate: {
      constrained: integerEnv(
        "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_CONSTRAINED",
        aggressiveConfigEnabled ? constrainedQualityVideoBitRate : 2_000_000,
        { min: 1_500_000, max: 16_000_000 },
      ),
      standard: integerEnv(
        "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_STANDARD",
        aggressiveConfigEnabled ? fullQualityVideoBitRate : 4_000_000,
        { min: 1_500_000, max: 20_000_000 },
      ),
    },
    startupStreamingMaximumResolution: {
      constrained: {
        width: integerEnv(
          "MOBILE_STARTUP_MAX_WIDTH_CONSTRAINED",
          aggressiveConfigEnabled ? 720 : 540,
          { min: 360, max: 1080 },
        ),
        height: integerEnv(
          "MOBILE_STARTUP_MAX_HEIGHT_CONSTRAINED",
          aggressiveConfigEnabled ? 1280 : 960,
          { min: 640, max: 1920 },
        ),
      },
      standard: {
        width: integerEnv(
          "MOBILE_STARTUP_MAX_WIDTH_STANDARD",
          aggressiveConfigEnabled ? fullQualityVideoWidth : 720,
          { min: 540, max: 2160 },
        ),
        height: integerEnv(
          "MOBILE_STARTUP_MAX_HEIGHT_STANDARD",
          aggressiveConfigEnabled ? fullQualityVideoHeight : 1280,
          { min: 960, max: 3840 },
        ),
      },
    },
    preparedStreamingPeakBitRate: {
      constrained: integerEnv(
        "MOBILE_PREPARED_STREAMING_PEAK_BITRATE_CONSTRAINED",
        aggressiveConfigEnabled ? constrainedQualityVideoBitRate : 2_000_000,
        { min: 1_500_000, max: 8_500_000 },
      ),
      standard: integerEnv(
        "MOBILE_PREPARED_STREAMING_PEAK_BITRATE_STANDARD",
        aggressiveConfigEnabled ? fullQualityVideoBitRate : 4_000_000,
        { min: 3_000_000, max: 20_000_000 },
      ),
    },
    preparedStreamingMaximumResolution: {
      constrained: {
        width: integerEnv(
          "MOBILE_PREPARED_MAX_WIDTH_CONSTRAINED",
          aggressiveConfigEnabled ? 720 : 540,
          { min: 360, max: 1080 },
        ),
        height: integerEnv(
          "MOBILE_PREPARED_MAX_HEIGHT_CONSTRAINED",
          aggressiveConfigEnabled ? 1280 : 960,
          { min: 640, max: 1920 },
        ),
      },
      standard: {
        width: integerEnv(
          "MOBILE_PREPARED_MAX_WIDTH_STANDARD",
          aggressiveConfigEnabled ? fullQualityVideoWidth : 720,
          { min: 720, max: 2160 },
        ),
        height: integerEnv(
          "MOBILE_PREPARED_MAX_HEIGHT_STANDARD",
          aggressiveConfigEnabled ? fullQualityVideoHeight : 1280,
          { min: 1280, max: 3840 },
        ),
      },
    },
  }
}
