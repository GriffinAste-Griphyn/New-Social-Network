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

export function getMobileMediaConfig(input: {
  clientBuild?: number | null
  canaryBucket?: number | null
} = {}): RuntimeMediaConfig {
  const supportsSafePlayerPreparation = (input.clientBuild ?? 0) >= 255
  const aggressiveConfigEnabled = booleanEnv(
    "MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED",
    true,
  )

  return {
    version: process.env.MOBILE_MEDIA_CONFIG_VERSION?.trim() || "2026-08-12.1",
    rolloutProfile: aggressiveConfigEnabled ? "preheat-canary" : "baseline",
    imageDerivativeUploadEnabled: booleanEnv(
      "MOBILE_IMAGE_DERIVATIVE_UPLOAD_ENABLED",
      true,
    ),
    qoeAccessLogSampleRate: floatEnv("MOBILE_QOE_ACCESS_LOG_SAMPLE_RATE", 1, {
      min: 0,
      max: 1,
    }),
    uploadChunkBytes: integerEnv("MOBILE_UPLOAD_CHUNK_BYTES", 3 * 1024 * 1024, {
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
      constrained: 0,
      standard: supportsSafePlayerPreparation
        ? integerEnv(
            "MOBILE_PREPARED_PLAYER_LIMIT_STANDARD",
            aggressiveConfigEnabled ? 4 : 2,
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
      standard: integerEnv("MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD", aggressiveConfigEnabled ? 4 : 2, {
        min: 0,
        max: 6,
      }),
    },
    startupStreamingPeakBitRate: {
      constrained: integerEnv(
        "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_CONSTRAINED",
        aggressiveConfigEnabled ? 4_000_000 : 6_000_000,
        { min: 2_000_000, max: 16_000_000 },
      ),
      standard: integerEnv(
        "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_STANDARD",
        aggressiveConfigEnabled ? 8_000_000 : 10_000_000,
        { min: 1_500_000, max: 20_000_000 },
      ),
    },
    startupStreamingMaximumResolution: {
      constrained: {
        width: integerEnv("MOBILE_STARTUP_MAX_WIDTH_CONSTRAINED", 720, {
          min: 360,
          max: 1080,
        }),
        height: integerEnv("MOBILE_STARTUP_MAX_HEIGHT_CONSTRAINED", 1280, {
          min: 640,
          max: 1920,
        }),
      },
      standard: {
        width: integerEnv("MOBILE_STARTUP_MAX_WIDTH_STANDARD", 1080, {
          min: 540,
          max: 2160,
        }),
        height: integerEnv("MOBILE_STARTUP_MAX_HEIGHT_STANDARD", 1920, {
          min: 960,
          max: 3840,
        }),
      },
    },
  }
}
