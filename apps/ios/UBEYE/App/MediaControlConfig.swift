import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import MetricKit
import Network
import os
import SwiftUI
import UIKit

final class MediaControlConfig {
    var startupExperiment: String {
        read { $0?.startupExperiment ?? "quality-first" }
    }

    var usesAdaptiveStartup: Bool {
        read { $0?.startupMode == "adaptive" }
    }

    static let shared = MediaControlConfig()

    private let lock = NSLock()
    private var mediaConfig: MobileMediaConfigResponse.Media?

    private init() {}

    var imageDerivativeUploadEnabled: Bool {
        read { $0?.imageDerivativeUploadEnabled ?? true }
    }

    var blobUploadsAvailable: Bool {
        read { $0?.blobUploadsAvailable ?? true }
    }

    var profilePhotoUploadsAvailable: Bool {
        read { config in
            config?.profilePhotoUploadsAvailable ?? config?.storyImageUploadsAvailable ?? config?.blobUploadsAvailable ?? true
        }
    }

    var storyImageUploadsAvailable: Bool {
        read { config in
            config?.storyImageUploadsAvailable ?? config?.blobUploadsAvailable ?? true
        }
    }

    var qoeAccessLogSampleRate: Double {
        read { min(max($0?.qoeAccessLogSampleRate ?? 0.1, 0), 1) }
    }

    var uploadExperiment: String { read { $0?.uploadExperiment ?? "baseline" } }
    var adaptiveUploadEncodingEnabled: Bool { read { $0?.adaptiveUploadEncodingEnabled ?? false } }
    var adaptiveUploadChunksEnabled: Bool { read { $0?.adaptiveUploadChunksEnabled ?? false } }

    var uploadChunkBytes: Int {
        read { $0?.uploadChunkBytes ?? 50 * 1024 * 1024 }
    }

    func blobMultipartThresholdBytes(isLimited: Bool) -> Int {
        readOptionalLimit(
            \.blobMultipartThresholdBytes,
            isLimited: isLimited,
            fallback: isLimited ? 32 * 1024 * 1024 : 64 * 1024 * 1024
        )
    }

    func blobMultipartPartBytes(isLimited: Bool) -> Int {
        readOptionalLimit(
            \.blobMultipartPartBytes,
            isLimited: isLimited,
            fallback: isLimited ? 8 * 1024 * 1024 : 16 * 1024 * 1024
        )
    }

    func blobMultipartConcurrency(isLimited: Bool) -> Int {
        readOptionalLimit(
            \.blobMultipartConcurrency,
            isLimited: isLimited,
            fallback: isLimited ? 2 : 4
        )
    }

    var mediaFileCacheMaxBytes: Int {
        read { $0?.mediaFileCacheMaxBytes ?? 1024 * 1024 * 1024 }
    }

    func apply(_ config: MobileMediaConfigResponse.Media) {
        lock.lock()
        mediaConfig = config
        lock.unlock()

        MediaPerformance.mark("media_qoe_config version=\(config.version) profile=\(config.rolloutProfile ?? "baseline") cacheBytes=\(config.mediaFileCacheMaxBytes)")
    }

    func imagePreheatLimit(isLimited: Bool) -> Int {
        readLimit(\.imagePreheatLimit, isLimited: isLimited, fallback: isLimited ? 2 : 4)
    }

    func stackPreheatLimit(isLimited: Bool) -> Int {
        readLimit(\.stackPreheatLimit, isLimited: isLimited, fallback: isLimited ? 2 : 4)
    }

    func preparedPlayerLimit(isLimited: Bool) -> Int {
        min(
            readLimit(\.preparedPlayerLimit, isLimited: isLimited, fallback: isLimited ? 1 : 3),
            isLimited ? 1 : 3
        )
    }

    func persistentVideoPreheatLimit(isLimited: Bool) -> Int {
        min(
            readLimit(\.persistentVideoPreheatLimit, isLimited: isLimited, fallback: isLimited ? 1 : 2),
            isLimited ? 1 : 2
        )
    }

    func offlineHLSPreheatLimit(isLimited: Bool) -> Int {
        readLimit(\.offlineHLSPreheatLimit, isLimited: isLimited, fallback: isLimited ? 0 : 1)
    }

    var offlineHLSCacheMaxAssets: Int {
        read { min(max($0?.offlineHLSCacheMaxAssets ?? 2, 0), 3) }
    }

    func startupStreamingPeakBitRate(isLimited: Bool) -> Double {
        read {
            let startupCap = isLimited ? 3_000_000.0 : 8_000_000.0
            guard let pair = $0?.startupStreamingPeakBitRate else {
                return startupCap
            }

            return min(isLimited ? pair.constrained : pair.standard, startupCap)
        }
    }

    func startupStreamingMaximumResolution(isLimited: Bool) -> CGSize {
        read {
            let startupCap = isLimited
                ? CGSize(width: 720, height: 1280)
                : CGSize(width: 1080, height: 1920)
            guard let pair = $0?.startupStreamingMaximumResolution else {
                return startupCap
            }

            let resolution = isLimited ? pair.constrained : pair.standard
            return CGSize(
                width: min(resolution.width, startupCap.width),
                height: min(resolution.height, startupCap.height)
            )
        }
    }

    func preparedStreamingPeakBitRate(isLimited: Bool) -> Double {
        read {
            let preparedCap = isLimited ? 3_000_000.0 : 8_000_000.0
            guard let pair = $0?.preparedStreamingPeakBitRate else {
                return preparedCap
            }

            return min(isLimited ? pair.constrained : pair.standard, preparedCap)
        }
    }

    func preparedStreamingMaximumResolution(isLimited: Bool) -> CGSize {
        read {
            let preparedCap = isLimited
                ? CGSize(width: 720, height: 1280)
                : CGSize(width: 1080, height: 1920)
            guard let pair = $0?.preparedStreamingMaximumResolution else {
                return preparedCap
            }

            let resolution = isLimited ? pair.constrained : pair.standard
            return CGSize(
                width: min(resolution.width, preparedCap.width),
                height: min(resolution.height, preparedCap.height)
            )
        }
    }

    func shouldUploadAccessLog() -> Bool {
        let sampleRate = qoeAccessLogSampleRate
        guard sampleRate > 0 else {
            return false
        }

        return sampleRate >= 1 || Double.random(in: 0..<1) <= sampleRate
    }

    private func read<T>(_ block: (MobileMediaConfigResponse.Media?) -> T) -> T {
        lock.lock()
        let config = mediaConfig
        lock.unlock()
        return block(config)
    }

    private func readLimit(
        _ keyPath: KeyPath<MobileMediaConfigResponse.Media, MobileMediaConfigResponse.Media.LimitPair>,
        isLimited: Bool,
        fallback: Int
    ) -> Int {
        read {
            guard let pair = $0?[keyPath: keyPath] else {
                return fallback
            }

            return isLimited ? pair.constrained : pair.standard
        }
    }

    private func readOptionalLimit(
        _ keyPath: KeyPath<MobileMediaConfigResponse.Media, MobileMediaConfigResponse.Media.LimitPair?>,
        isLimited: Bool,
        fallback: Int
    ) -> Int {
        read {
            guard let pair = $0?[keyPath: keyPath] else {
                return fallback
            }
            return isLimited ? pair.constrained : pair.standard
        }
    }
}

