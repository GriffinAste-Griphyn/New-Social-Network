import {
  isCloudflareR2StoryImageStorageEnabled,
  minimumCloudflareR2ImageBuild,
} from "@/lib/cloudflare-r2"

export type RuntimeMediaConfig = {
  version: string
  rolloutProfile: "baseline" | "preheat-canary"
  startupMode: "focused" | "adaptive"
  startupExperiment: "quality-first" | "adaptive-canary"
  blobUploadsAvailable: boolean
  profilePhotoUploadsAvailable: boolean
  storyImageUploadsAvailable: boolean
  imageDerivativeUploadEnabled: boolean
  qoeAccessLogSampleRate: number
  uploadExperiment: "baseline" | "adaptive-canary"
  adaptiveUploadEncodingEnabled: boolean
  adaptiveUploadChunksEnabled: boolean
  uploadChunkBytes: number
  blobMultipartThresholdBytes: {
    constrained: number
    standard: number
  }
  blobMultipartPartBytes: {
    constrained: number
    standard: number
  }
  blobMultipartConcurrency: {
    constrained: number
    standard: number
  }
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
  const supportsPersistentDisplayPreparation = (input.clientBuild ?? 0) >= 424
  const supportsOfflineHLSCaching = (input.clientBuild ?? 0) >= 320
  const supportsCloudflareR2ImageUploads =
    (input.clientBuild ?? 0) >= minimumCloudflareR2ImageBuild
  const aggressiveConfigEnabled = booleanEnv(
    "MOBILE_AGGRESSIVE_MEDIA_CONFIG_ENABLED",
    true,
  )
  const adaptiveCanary = (input.clientBuild ?? 0) >= 422 &&
    input.canaryBucket != null && input.canaryBucket >= 0 &&
    input.canaryBucket < ((input.clientBuild ?? 0) >= 440
      ? integerEnv("MOBILE_ADAPTIVE_START_PERCENT_BUILD_440", 100, { min: 0, max: 100 })
      : integerEnv("MOBILE_ADAPTIVE_START_CANARY_PERCENT", 20, { min: 0, max: 100 }))

  // Retain adaptive playback without the older experiment's 720p startup ceiling.
  const conservativeStartup = adaptiveCanary && (input.clientBuild ?? 0) < 445

  const uploadCanary = (input.clientBuild ?? 0) >= 426 &&
    input.canaryBucket != null && input.canaryBucket >= 0 &&
    input.canaryBucket < integerEnv("MOBILE_ADAPTIVE_UPLOAD_CANARY_PERCENT", 10, { min: 0, max: 100 })
  const adaptiveUploadEncodingEnabled = (uploadCanary || (input.clientBuild ?? 0) >= 433) &&
    booleanEnv("MOBILE_ADAPTIVE_UPLOAD_ENCODING_ENABLED", false)
  const adaptiveUploadChunksEnabled = uploadCanary && booleanEnv("MOBILE_ADAPTIVE_UPLOAD_CHUNKS_ENABLED", false)

  return {
    uploadExperiment: adaptiveUploadEncodingEnabled || adaptiveUploadChunksEnabled ? "adaptive-canary" : "baseline",
    adaptiveUploadEncodingEnabled,
    adaptiveUploadChunksEnabled,
    version: process.env.MOBILE_MEDIA_CONFIG_VERSION?.trim() || "2026-09-13.6",
    rolloutProfile: aggressiveConfigEnabled ? "preheat-canary" : "baseline",
    startupMode: adaptiveCanary ? "adaptive" : "focused",
    startupExperiment: adaptiveCanary ? "adaptive-canary" : "quality-first",
    blobUploadsAvailable:
      process.env.VERCEL_BLOB_SUSPENDED_MODE?.trim().toLowerCase() !== "true",
    profilePhotoUploadsAvailable:
      process.env.VERCEL_BLOB_SUSPENDED_MODE?.trim().toLowerCase() !== "true" ||
      isCloudflareR2StoryImageStorageEnabled(),
    storyImageUploadsAvailable:
      process.env.VERCEL_BLOB_SUSPENDED_MODE?.trim().toLowerCase() !== "true" ||
      (supportsCloudflareR2ImageUploads &&
        isCloudflareR2StoryImageStorageEnabled()),
    imageDerivativeUploadEnabled: booleanEnv(
      "MOBILE_IMAGE_DERIVATIVE_UPLOAD_ENABLED",
      true,
    ),
    qoeAccessLogSampleRate: floatEnv("MOBILE_QOE_ACCESS_LOG_SAMPLE_RATE", 0.1, {
      min: 0,
      max: 1,
    }),
    uploadChunkBytes: integerEnv("MOBILE_UPLOAD_CHUNK_BYTES", 50 * 1024 * 1024, {
      min: 5 * 1024 * 1024,
      max: 200 * 1024 * 1024,
    }),
    blobMultipartThresholdBytes: {
      constrained: integerEnv(
        "MOBILE_BLOB_MULTIPART_THRESHOLD_BYTES_CONSTRAINED",
        32 * 1024 * 1024,
        { min: 8 * 1024 * 1024, max: 256 * 1024 * 1024 },
      ),
      standard: integerEnv(
        "MOBILE_BLOB_MULTIPART_THRESHOLD_BYTES_STANDARD",
        64 * 1024 * 1024,
        { min: 8 * 1024 * 1024, max: 256 * 1024 * 1024 },
      ),
    },
    blobMultipartPartBytes: {
      constrained: integerEnv(
        "MOBILE_BLOB_MULTIPART_PART_BYTES_CONSTRAINED",
        8 * 1024 * 1024,
        { min: 5 * 1024 * 1024, max: 64 * 1024 * 1024 },
      ),
      standard: integerEnv(
        "MOBILE_BLOB_MULTIPART_PART_BYTES_STANDARD",
        16 * 1024 * 1024,
        { min: 5 * 1024 * 1024, max: 64 * 1024 * 1024 },
      ),
    },
    blobMultipartConcurrency: {
      constrained: integerEnv(
        "MOBILE_BLOB_MULTIPART_CONCURRENCY_CONSTRAINED",
        2,
        { min: 1, max: 4 },
      ),
      standard: integerEnv(
        "MOBILE_BLOB_MULTIPART_CONCURRENCY_STANDARD",
        4,
        { min: 1, max: 6 },
      ),
    },
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
      standard: integerEnv(adaptiveCanary ? "MOBILE_STACK_PREHEAT_LIMIT_STANDARD_CANARY" : "MOBILE_STACK_PREHEAT_LIMIT_STANDARD", adaptiveCanary ? 2 : aggressiveConfigEnabled ? 4 : 2, {
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
          adaptiveCanary ? "MOBILE_PREPARED_PLAYER_LIMIT_STANDARD_CANARY" : "MOBILE_PREPARED_PLAYER_LIMIT_STANDARD",
            adaptiveCanary && !supportsPersistentDisplayPreparation ? 2 : 3,
            {
              min: 0,
              max: 4,
            },
          )
        : 0,
    },
    persistentVideoPreheatLimit: {
      constrained: integerEnv(adaptiveCanary ? "MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_CONSTRAINED_CANARY" : "MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_CONSTRAINED", adaptiveCanary ? 0 : aggressiveConfigEnabled ? 2 : 1, {
        min: 0,
        max: 4,
      }),
      standard: integerEnv(adaptiveCanary ? "MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD_CANARY" : "MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD", adaptiveCanary ? 1 : 2, {
        min: 0,
        max: 6,
      }),
    },
    offlineHLSPreheatLimit: {
      constrained: 0,
      standard: supportsOfflineHLSCaching
        ? integerEnv(
            adaptiveCanary ? "MOBILE_OFFLINE_HLS_PREHEAT_LIMIT_STANDARD_CANARY" : "MOBILE_OFFLINE_HLS_PREHEAT_LIMIT_STANDARD",
            adaptiveCanary ? 0 : aggressiveConfigEnabled ? 1 : 0,
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
        conservativeStartup ? "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_CONSTRAINED_CANARY" : "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_CONSTRAINED",
        conservativeStartup ? 1_600_000 : aggressiveConfigEnabled ? constrainedQualityVideoBitRate : 2_000_000,
        { min: 1_500_000, max: 16_000_000 },
      ),
      standard: integerEnv(
        conservativeStartup ? "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_STANDARD_CANARY" : "MOBILE_STARTUP_STREAMING_PEAK_BITRATE_STANDARD",
        conservativeStartup ? 4_000_000 : aggressiveConfigEnabled ? fullQualityVideoBitRate : 4_000_000,
        { min: 1_500_000, max: 20_000_000 },
      ),
    },
    startupStreamingMaximumResolution: {
      constrained: {
        width: integerEnv(
          conservativeStartup ? "MOBILE_STARTUP_MAX_WIDTH_CONSTRAINED_CANARY" : "MOBILE_STARTUP_MAX_WIDTH_CONSTRAINED",
          conservativeStartup ? 540 : aggressiveConfigEnabled ? 720 : 540,
          { min: 360, max: 1080 },
        ),
        height: integerEnv(
          conservativeStartup ? "MOBILE_STARTUP_MAX_HEIGHT_CONSTRAINED_CANARY" : "MOBILE_STARTUP_MAX_HEIGHT_CONSTRAINED",
          conservativeStartup ? 960 : aggressiveConfigEnabled ? 1280 : 960,
          { min: 640, max: 1920 },
        ),
      },
      standard: {
        width: integerEnv(
          conservativeStartup ? "MOBILE_STARTUP_MAX_WIDTH_STANDARD_CANARY" : "MOBILE_STARTUP_MAX_WIDTH_STANDARD",
          conservativeStartup ? 720 : aggressiveConfigEnabled ? fullQualityVideoWidth : 720,
          { min: 540, max: 2160 },
        ),
        height: integerEnv(
          conservativeStartup ? "MOBILE_STARTUP_MAX_HEIGHT_STANDARD_CANARY" : "MOBILE_STARTUP_MAX_HEIGHT_STANDARD",
          conservativeStartup ? 1280 : aggressiveConfigEnabled ? fullQualityVideoHeight : 1280,
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
