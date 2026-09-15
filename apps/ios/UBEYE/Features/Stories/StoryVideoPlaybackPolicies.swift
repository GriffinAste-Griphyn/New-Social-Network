import AVKit
import CryptoKit
import SwiftUI
import UIKit

enum StoryVideoVisitPolicy {
    static func shouldRewindForNextVisit(
        previousIsActive: Bool,
        nextIsActive: Bool
    ) -> Bool {
        previousIsActive && !nextIsActive
    }
}

enum VideoStartupPolicy {
    static let freshForwardBufferDuration: TimeInterval = 8

    static func firstFrameTimeout(isLimitedNetwork: Bool) -> TimeInterval {
        isLimitedNetwork ? 12 : 8
    }

    enum ReadinessTimeoutAction: Equatable {
        case continueBufferedPlayback
        case fail
    }

    static func readinessTimeoutAction(
        playerStatus: AVPlayer.Status,
        itemStatus: AVPlayerItem.Status
    ) -> ReadinessTimeoutAction {
        if playerStatus == .failed || itemStatus == .failed {
            return .fail
        }

        return .continueBufferedPlayback
    }

    static func canReuseCompletedPreroll(
        wasPrerolled: Bool,
        targetSeconds: TimeInterval,
        currentSeconds: TimeInterval
    ) -> Bool {
        wasPrerolled &&
            targetSeconds.isFinite &&
            currentSeconds.isFinite &&
            abs(currentSeconds - targetSeconds) <= 0.05
    }
}

enum VideoPlaybackRecoveryPolicy {
    enum Action: Equatable {
        case recoverCurrentItem
        case rebuildPlayer
        case fail
    }

    static let maximumCurrentItemRecoveries = 1
    static let maximumPlayerRebuilds = 1

    static func action(
        itemIsReady: Bool,
        currentItemRecoveryCount: Int,
        playerRebuildCount: Int
    ) -> Action {
        if itemIsReady,
           currentItemRecoveryCount < maximumCurrentItemRecoveries {
            return .recoverCurrentItem
        }

        if playerRebuildCount < maximumPlayerRebuilds {
            return .rebuildPlayer
        }

        return .fail
    }
}

enum VideoStallRecoveryPolicy {
    static let confirmationDelay: Duration = .milliseconds(200)
    static let minimumRecoveryAdvanceSeconds: TimeInterval = 0.12

    static func hasRecovered(
        timeControlStatus: AVPlayer.TimeControlStatus,
        playbackAdvanced: Bool
    ) -> Bool {
        // AVPlayer can transiently report `.playing` while its playhead and decoded
        // frames remain frozen. Measurable media-time advancement is the only reliable
        // signal that playback actually recovered.
        _ = timeControlStatus
        return playbackAdvanced
    }
}

enum VideoPlaybackWatchdogPolicy {
    static let sampleInterval: Duration = .milliseconds(250)
    static let stallThresholdSeconds: TimeInterval = 1.25
    static let minimumSampleAdvanceSeconds: TimeInterval = 0.04

    static func madeProgress(
        previousSeconds: TimeInterval,
        currentSeconds: TimeInterval
    ) -> Bool {
        previousSeconds.isFinite &&
            currentSeconds.isFinite &&
            currentSeconds - previousSeconds >= minimumSampleAdvanceSeconds
    }

    static func shouldDeclareStall(
        isVisible: Bool,
        isPaused: Bool,
        didFinish: Bool,
        secondsWithoutProgress: TimeInterval
    ) -> Bool {
        isVisible &&
            !isPaused &&
            !didFinish &&
            secondsWithoutProgress.isFinite &&
            secondsWithoutProgress >= stallThresholdSeconds
    }
}

enum VideoQualityRampPolicy {
    static let sampleInterval: Duration = .milliseconds(250)
    static let initialObservationSeconds: TimeInterval = 8
    static func observationInterval(elapsed: TimeInterval) -> Duration {
        elapsed < initialObservationSeconds ? sampleInterval : .seconds(1)
    }
    static let minimumForwardBufferSeconds: TimeInterval = 2
    static let requiredHealthySamples = 2

    static func shouldRelaxStreamingHints(
        isPlaybackLikelyToKeepUp: Bool,
        bufferedAheadSeconds: TimeInterval,
        remainingSeconds: TimeInterval?
    ) -> Bool {
        guard isPlaybackLikelyToKeepUp,
              bufferedAheadSeconds.isFinite,
              bufferedAheadSeconds >= 0 else {
            return false
        }

        let requiredBuffer = remainingSeconds.flatMap { remaining -> TimeInterval? in
            guard remaining.isFinite, remaining > 0 else { return nil }
            return min(minimumForwardBufferSeconds, max(0, remaining - 0.05))
        } ?? minimumForwardBufferSeconds
        return bufferedAheadSeconds >= requiredBuffer
    }

    static func hasReached1080p(_ size: CGSize) -> Bool {
        let shortSide = min(abs(size.width), abs(size.height))
        let longSide = max(abs(size.width), abs(size.height))
        return shortSide >= 1_000 && longSide >= 1_800
    }
}

/// Tracks sustained recovery without a deadline. A policy change can reapply
/// limits; relaxing again requires fresh healthy samples, never a stale buffer.
struct VideoQualityRecoveryState {
    enum Action: Equatable { case none, restrict, relax }
    private var wasAllowed: Bool?
    private var healthySamples = 0
    private(set) var isRelaxed: Bool

    init(isRelaxed: Bool = false) { self.isRelaxed = isRelaxed }

    mutating func observe(allowed: Bool, healthy: Bool, advancing: Bool) -> Action {
        defer { wasAllowed = allowed }
        guard allowed else {
            healthySamples = 0
            let shouldRestrict = wasAllowed != false || isRelaxed
            isRelaxed = false
            return shouldRestrict ? .restrict : .none
        }
        guard advancing, healthy else { healthySamples = 0; return .none }
        healthySamples = min(VideoQualityRampPolicy.requiredHealthySamples, healthySamples + 1)
        guard !isRelaxed, healthySamples >= VideoQualityRampPolicy.requiredHealthySamples else { return .none }
        isRelaxed = true
        return .relax
    }
}

enum VideoPlaybackCompletionPolicy {
    static let graceDelay: Duration = .milliseconds(500)

    static func isAtEnd(
        currentSeconds: TimeInterval,
        durationSeconds: TimeInterval
    ) -> Bool {
        guard currentSeconds.isFinite,
              durationSeconds.isFinite,
              durationSeconds > 0 else {
            return false
        }

        // Keep the fallback close to the authoritative AVPlayerItem duration. The
        // normal path is AVPlayerItemDidPlayToEndTime; this only covers a missed end
        // notification without skipping a visible portion of the final segment.
        let tolerance = min(0.12, max(0.05, durationSeconds * 0.005))
        return currentSeconds >= durationSeconds - tolerance
    }
}
