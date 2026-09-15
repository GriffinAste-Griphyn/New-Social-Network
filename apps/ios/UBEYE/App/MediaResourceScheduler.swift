import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import MetricKit
import Network
import os
import SwiftUI
import UIKit

/// One decision for speculative network/decoder work. Visible playback and
/// submitted uploads are owned by their controllers and never enter these lanes.
struct MediaWorkBudget: Equatable {
    let players: Int
    let images: Int
    let stacks: Int
    let persistentVideos: Int
    let offlineHLS: Int

    static func resolve(uploading: Bool, connected: Bool, visiblePlayback: Bool,
        buffering: Bool, constrained: Bool, resourceLimited: Bool, throughput: Double?,
        configured: MediaWorkBudget) -> MediaWorkBudget {
        guard connected else { return .zero }
        let players = StoryPreheatPolicy.concurrentUploadPlayerLimit(configured: configured.players,
            uploading: uploading, visiblePlayback: visiblePlayback, buffering: buffering,
            constrained: constrained, resourceLimited: resourceLimited, throughput: throughput)
        let suspendDistant = uploading || buffering || resourceLimited || constrained
        return MediaWorkBudget(players: players,
            images: uploading || buffering ? 0 : max(0, configured.images),
            stacks: uploading || buffering ? 0 : max(0, configured.stacks),
            persistentVideos: suspendDistant ? 0 : max(0, configured.persistentVideos),
            offlineHLS: suspendDistant ? 0 : max(0, configured.offlineHLS))
    }
    static let zero = MediaWorkBudget(players: 0, images: 0, stacks: 0, persistentVideos: 0, offlineHLS: 0)
}

/// Uploads borrow bandwidth from speculative work, never from visible playback.
@MainActor
final class StoryUploadPriority {
    static let shared = StoryUploadPriority()
    private var tokens = Set<UUID>()
    var isUploading: Bool { !tokens.isEmpty }

    func begin() -> UUID {
        let token = UUID()
        let wasUploading = isUploading
        tokens.insert(token)
        if !wasUploading {
            MediaImageCache.shared.suspendSpeculativePreheats()
            NotificationCenter.default.post(name: NetworkQualityMonitor.playbackBudgetChanged, object: nil)
        }
        return token
    }

    func end(_ token: UUID) {
        guard tokens.remove(token) != nil, !isUploading else { return }
        MediaImageCache.shared.resumeSpeculativePreheats()
        NotificationCenter.default.post(name: NetworkQualityMonitor.playbackBudgetChanged, object: nil)
    }
}

@MainActor
final class NetworkQualityMonitor: ObservableObject {
    static let shared = NetworkQualityMonitor()

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "ubeye.network-quality")
    @Published private(set) var isConnected = true
    @Published private(set) var isConstrained = false
    @Published private(set) var isCellular = false
    @Published private(set) var isExpensive = false
    static let playbackBudgetChanged = Notification.Name("ubeye.playbackBudgetChanged")
    private var throughputHistory = PlaybackThroughputHistory()
    private var recoveryHistory = PlaybackRecoveryHistory()
    private var activePlaybackIdentity: String?
    private(set) var isActivePlaybackBuffering = false

    func setActivePlayback(identity: String, buffering: Bool) {
        let changed = isActivePlaybackBuffering != buffering || activePlaybackIdentity != identity
        activePlaybackIdentity = identity
        isActivePlaybackBuffering = buffering
        if changed { NotificationCenter.default.post(name: Self.playbackBudgetChanged, object: nil) }
    }

    func clearActivePlayback(identity: String?) {
        guard identity == activePlaybackIdentity else { return }
        activePlaybackIdentity = nil
        isActivePlaybackBuffering = false
        NotificationCenter.default.post(name: Self.playbackBudgetChanged, object: nil)
    }

    var isLimitedPath: Bool {
        isConstrained || isCellular || isExpensive
    }

    var telemetryNetworkClass: String {
        if isConstrained {
            return "constrained"
        }
        if isCellular {
            return "cellular"
        }
        if isExpensive {
            return "expensive"
        }
        return "standard"
    }

    private var shouldLimitPreheating: Bool {
        isLimitedPath ||
            measuredThroughputBitsPerSecond.map { $0 < 2_500_000 } == true ||
            UBEYEResourceMonitor.shared.mode != .standard
    }

    private var shouldLimitStreamingQuality: Bool {
        VisibleVideoQualityPolicy.isRestricted(lowDataMode: isConstrained,
            resourceMode: UBEYEResourceMonitor.shared.mode)
    }

    var workBudget: MediaWorkBudget {
        let config = MediaControlConfig.shared
        return MediaWorkBudget.resolve(uploading: StoryUploadPriority.shared.isUploading,
            connected: isConnected, visiblePlayback: activePlaybackIdentity != nil,
            buffering: isActivePlaybackBuffering, constrained: isConstrained,
            resourceLimited: UBEYEResourceMonitor.shared.mode != .standard,
            throughput: measuredThroughputBitsPerSecond,
            configured: MediaWorkBudget(players: retainedPreparedPlayerLimit,
                images: config.imagePreheatLimit(isLimited: shouldLimitPreheating),
                stacks: config.stackPreheatLimit(isLimited: shouldLimitPreheating),
                persistentVideos: config.persistentVideoPreheatLimit(isLimited: shouldLimitPreheating),
                offlineHLS: config.offlineHLSPreheatLimit(isLimited: shouldLimitPreheating)))
    }

    var imagePreheatLimit: Int { workBudget.images }
    var stackPreheatLimit: Int { workBudget.stacks }
    var preparedPlayerLimit: Int { workBudget.players }
    var persistentVideoPreheatLimit: Int { workBudget.persistentVideos }
    var offlineHLSPreheatLimit: Int { workBudget.offlineHLS }

    // Retention is independent of permission to start speculative work.
    var retainedPreparedPlayerLimit: Int {
        let configured = MediaControlConfig.shared.preparedPlayerLimit(isLimited: shouldLimitPreheating)
        return min(configured, StoryPreheatPolicy.playerLimit(throughput: measuredThroughputBitsPerSecond, isLimited: shouldLimitPreheating))
    }

    var offlineHLSCacheMaxAssets: Int {
        MediaControlConfig.shared.offlineHLSCacheMaxAssets
    }

    var startupStreamingPeakBitRate: Double {
        let configured = MediaControlConfig.shared.startupStreamingPeakBitRate(isLimited: shouldLimitStreamingQuality)
        guard MediaControlConfig.shared.usesAdaptiveStartup else { return configured }
        return PlaybackThroughputHistory.startupCap(configured: configured, throughput: measuredThroughputBitsPerSecond, recoveringFromStall: playbackRecoveryReserve > 0)
    }

    var startupStreamingMaximumResolution: CGSize {
        let configured = MediaControlConfig.shared.startupStreamingMaximumResolution(isLimited: shouldLimitStreamingQuality)
        return configured
    }

    var preparedStreamingPeakBitRate: Double {
        let configured = MediaControlConfig.shared.preparedStreamingPeakBitRate(isLimited: shouldLimitStreamingQuality)
        return PlaybackThroughputHistory.startupCap(configured: configured, throughput: measuredThroughputBitsPerSecond, recoveringFromStall: playbackRecoveryReserve > 0)
    }

    var preparedStreamingMaximumResolution: CGSize {
        let configured = MediaControlConfig.shared.preparedStreamingMaximumResolution(isLimited: shouldLimitStreamingQuality)
        return configured
    }

    var allowsStreamingHintRelaxation: Bool {
        !shouldLimitStreamingQuality
    }

    var preparedForwardBufferDuration: TimeInterval {
        VisibleVideoQualityPolicy.preparedBufferSeconds(restricted: shouldLimitStreamingQuality)
    }

    var activeForwardBufferDuration: TimeInterval {
        VisibleVideoQualityPolicy.activeBufferSeconds(restricted: shouldLimitStreamingQuality)
    }

    func recordPlaybackObservation(observedBitrate: Double, stalls: Int) {
        let previousLimit = workBudget
        throughputHistory.record(bitsPerSecond: observedBitrate, stalls: stalls)
        if previousLimit != workBudget {
            NotificationCenter.default.post(name: Self.playbackBudgetChanged, object: nil)
        }
    }

    func recordConfirmedPlaybackStall(identity: String) {
        guard identity == activePlaybackIdentity else { return }
        recoveryHistory.recordStall()
        setActivePlayback(identity: identity, buffering: true)
    }

    var playbackRecoveryReserve: TimeInterval { recoveryHistory.requiredReserve() }
    var playbackRecoveryCoolingDown: Bool { recoveryHistory.isCoolingDown() }

    var recentPlaybackThroughput: Double? { throughputHistory.recent() }

    var measuredThroughputBitsPerSecond: Double? {
        throughputHistory.recent()
    }

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let changed = self.isCellular != path.usesInterfaceType(.cellular) ||
                    self.isConstrained != path.isConstrained || self.isExpensive != path.isExpensive ||
                    self.isConnected != (path.status == .satisfied)
                if changed {
                    self.throughputHistory.reset()
                    self.recoveryHistory.reset()
                }
                self.isConnected = path.status == .satisfied
                self.isConstrained = path.isConstrained
                self.isCellular = path.usesInterfaceType(.cellular)
                self.isExpensive = path.isExpensive
                if changed { NotificationCenter.default.post(name: Self.playbackBudgetChanged, object: nil) }
            }
        }
        monitor.start(queue: queue)
    }
}
