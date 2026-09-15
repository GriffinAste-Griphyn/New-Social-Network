import AVFoundation
import CoreGraphics
import Foundation

struct StoryVideoPlaybackSource: Hashable {
    let identity: String
    let url: URL
    let durationSeconds: TimeInterval?
    let pixelWidth: Int?
    let pixelHeight: Int?

    init(
        identity: String,
        url: URL,
        durationSeconds: TimeInterval? = nil,
        pixelWidth: Int? = nil,
        pixelHeight: Int? = nil
    ) {
        self.identity = identity
        self.url = MediaPlaybackQuality.adaptivePlaybackURL(for: url)
        self.durationSeconds = durationSeconds
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
    }

    func representsSameMedia(as other: StoryVideoPlaybackSource?) -> Bool {
        identity == other?.identity
    }

    static func urlBacked(_ url: URL) -> StoryVideoPlaybackSource {
        let playbackURL = MediaPlaybackQuality.adaptivePlaybackURL(for: url)
        return StoryVideoPlaybackSource(
            identity: StoryVideoPlaybackPool.canonicalURL(for: playbackURL).absoluteString,
            url: playbackURL,
            durationSeconds: nil
        )
    }
}

enum MediaPlaybackQuality {
    static let clientBandwidthHintQueryName = "clientBandwidthHint"

    enum StartupProfile {
        case cold
        case prepared
    }

    @MainActor
    static var offlineStreamingPeakBitRate: Double {
        NetworkQualityMonitor.shared.preparedStreamingPeakBitRate
    }

    @MainActor
    static func applyStreamingHints(
        for item: AVPlayerItem?,
        playbackURL: URL?,
        profile: StartupProfile
    ) {
        guard let item,
              playbackURL?.pathExtension.lowercased() == "m3u8" else {
            return
        }

        if ExactVideoQualityPolicy.target(in: playbackURL) != nil {
            // The manifest already selects one rendition. ABR upper limits cannot
            // improve that selection and may contradict the selected stream.
            item.preferredPeakBitRate = 0
            item.preferredMaximumResolution = .zero
            return
        }

        switch profile {
        case .cold:
            item.preferredPeakBitRate = NetworkQualityMonitor.shared.startupStreamingPeakBitRate
            item.preferredMaximumResolution = NetworkQualityMonitor.shared.startupStreamingMaximumResolution
        case .prepared:
            item.preferredPeakBitRate = NetworkQualityMonitor.shared.preparedStreamingPeakBitRate
            item.preferredMaximumResolution = NetworkQualityMonitor.shared.preparedStreamingMaximumResolution
        }
    }

    /// Cloudflare Stream can return the single rendition nearest this bandwidth.
    /// Using that focused manifest for the player that is actively being prerolled
    /// prevents AVPlayer from exposing a low-resolution ABR bootstrap frame before
    /// it has enough throughput history to select the intended rendition.
    @MainActor
    static func allowsPreparedPlaybackURL(_ url: URL) -> Bool {
        ExactVideoQualityPolicy.target(in: url) != nil ||
            !MediaControlConfig.shared.usesAdaptiveStartup || !isStartupQualityLocked(url)
    }

    @MainActor
    static func startupPlaybackURL(for url: URL) -> URL {
        let adaptiveURL = adaptivePlaybackURL(for: url)
        if ExactVideoQualityPolicy.supports(adaptiveURL) {
            return ExactVideoQualityPolicy.url(adaptiveURL,
                target: NetworkQualityMonitor.shared.allowsStreamingHintRelaxation ? 1080 : 720)
        }
        guard !MediaControlConfig.shared.usesAdaptiveStartup else {
            return adaptiveURL
        }
        guard isCloudflareStreamPlaylist(adaptiveURL),
              var components = URLComponents(
                url: adaptiveURL,
                resolvingAgainstBaseURL: false
              ) else {
            return adaptiveURL
        }

        let bitsPerSecond = NetworkQualityMonitor.shared.preparedStreamingPeakBitRate
        let megabitsPerSecond = min(max(bitsPerSecond / 1_000_000, 1.5), 20)
        var queryItems = components.queryItems ?? []
        queryItems.removeAll {
            $0.name.caseInsensitiveCompare(clientBandwidthHintQueryName) == .orderedSame
        }
        queryItems.append(
            URLQueryItem(
                name: clientBandwidthHintQueryName,
                value: String(format: "%.3f", megabitsPerSecond)
            )
        )
        components.queryItems = queryItems
        return components.url ?? adaptiveURL
    }

    nonisolated static func isStartupQualityLocked(_ url: URL?) -> Bool {
        if ExactVideoQualityPolicy.target(in: url) != nil { return true }
        guard let url,
              isCloudflareStreamPlaylist(url),
              let components = URLComponents(
                url: url,
                resolvingAgainstBaseURL: false
              ) else {
            return false
        }

        return components.queryItems?.contains {
            $0.name.caseInsensitiveCompare(clientBandwidthHintQueryName) == .orderedSame
        } == true
    }

    @MainActor
    static func relaxStreamingHints(for item: AVPlayerItem?, playbackURL: URL?) {
        guard let item,
              playbackURL?.pathExtension.lowercased() == "m3u8" else {
            return
        }

        item.preferredPeakBitRate = 0
        item.preferredMaximumResolution = .zero
    }

    @MainActor
    static func preloadSources(for card: StoryCard) -> [StoryVideoPlaybackSource] {
        guard card.isPlayableVideo else {
            return []
        }

        return [card.playbackSource]
    }

    @MainActor
    static func preferredPlaybackURL(
        defaultURL: URL
    ) -> (url: URL, quality: String) {
        let playbackURL = adaptivePlaybackURL(for: defaultURL)
        let quality = isHTTPStreamingPlaylist(playbackURL) ? "adaptive_hls" : "playback"
        return (playbackURL, quality)
    }

    nonisolated static func adaptivePlaybackURL(for url: URL) -> URL {
        guard isHTTPStreamingPlaylist(url),
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }

        let filteredQueryItems = components.queryItems?.filter {
            $0.name.caseInsensitiveCompare(clientBandwidthHintQueryName) != .orderedSame &&
                $0.name != "rendition"
        }
        components.queryItems = filteredQueryItems?.isEmpty == true ? nil : filteredQueryItems
        return components.url ?? url
    }

    private nonisolated static func isCloudflareStreamPlaylist(_ url: URL) -> Bool {
        guard isHTTPStreamingPlaylist(url) else {
            return false
        }

        let hostname = url.host?.lowercased() ?? ""
        let path = url.path.lowercased()
        return path.contains("/cloudflare-stream/") ||
            hostname.hasSuffix(".cloudflarestream.com") ||
            hostname == "videodelivery.net" ||
            hostname.hasSuffix(".videodelivery.net")
    }
}

/// The capability marker is issued only by servers supporting exact manifests.
/// A quality target never turns an old server's adaptive response into a guarantee.
enum ExactVideoQualityPolicy {
    static func supports(_ url: URL) -> Bool {
        url.scheme == "https" && url.path.hasPrefix("/api/story-media/") &&
            url.pathExtension == "m3u8" &&
            URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains {
                $0.name == "selection" && $0.value == "exact-v1"
            } == true
    }

    static func target(in url: URL?) -> Int? {
        guard let url, supports(url),
              let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "rendition" })?.value,
              let target = Int(value), [720, 1080].contains(target) else { return nil }
        return target
    }

    static func url(_ source: URL, target: Int) -> URL {
        guard supports(source), var parts = URLComponents(url: source, resolvingAgainstBaseURL: false) else { return source }
        var query = parts.queryItems ?? []
        query.removeAll { $0.name == "rendition" || $0.name == MediaPlaybackQuality.clientBandwidthHintQueryName }
        if [720, 1080].contains(target) { query.append(URLQueryItem(name: "rendition", value: String(target))) }
        parts.queryItems = query
        return parts.url ?? source
    }

    static func isReady(size: CGSize, target: Int, sourceWidth: Int?, sourceHeight: Int?, buffered: Double, remaining: Double?) -> Bool {
        let nativeEdge = min(sourceWidth ?? target, sourceHeight ?? target)
        let edge = min(target, nativeEdge > 0 ? nativeEdge : target)
        let requiredBuffer = min(0.75, max(0, (remaining ?? 0.80) - 0.05))
        return min(size.width, size.height) >= Double(edge - 2) &&
            size.width.isFinite && size.height.isFinite && buffered.isFinite && buffered >= requiredBuffer
    }

    static func fallback(after target: Int) -> Int { target == 1080 ? 720 : 0 }
    static func preparationTimeout(target: Int) -> TimeInterval { target == 1080 ? 2.5 : 2.0 }

    static func shouldUpgrade(target: Int?, healthySeconds: Double, remaining: Double?, throughput: Double?, allowed: Bool, alreadyAttempted: Bool) -> Bool {
        // A single attempt on a long, healthy playback avoids repeated decoder
        // replacement, short-clip churn and oscillation after a genuine stall.
        (target == 720 || target == nil) && !alreadyAttempted && allowed && healthySeconds >= 10 &&
            (remaining ?? 0) >= 12 && (throughput ?? 0) >= 12_000_000
    }
}

/// Picture quality is independent of the budget for speculative work. Cellular
/// and Low Power Mode may reduce prefetch depth, but do not impose an HD ceiling.
enum VisibleVideoQualityPolicy {
    static func isRestricted(lowDataMode: Bool, resourceMode: UBEYEAdaptiveMode) -> Bool {
        lowDataMode || resourceMode == .critical
    }

    static func preparedBufferSeconds(restricted: Bool) -> TimeInterval { restricted ? 2 : 4 }
    static func activeBufferSeconds(restricted: Bool) -> TimeInterval { restricted ? 4 : 8 }
}

// Pure policies keep network history and pixel budgets testable without a live player.
struct PlaybackThroughputHistory {
    private(set) var estimate: Double?
    private var recordedAt: Date?

    mutating func record(bitsPerSecond: Double, stalls: Int, now: Date = Date()) {
        guard bitsPerSecond.isFinite, bitsPerSecond > 0 else { return }
        let sample = min(bitsPerSecond, 200_000_000) * (stalls > 0 ? 0.65 : 1)
        let prior = recent(now: now)
        // React faster to a slowdown than an apparent speedup.
        let weight = prior.map { sample < $0 ? 0.65 : 0.25 } ?? 1
        estimate = (prior ?? sample) * (1 - weight) + sample * weight
        recordedAt = now
    }

    func recent(now: Date = Date()) -> Double? {
        guard let recordedAt, now.timeIntervalSince(recordedAt) >= 0,
              now.timeIntervalSince(recordedAt) <= 120 else { return nil }
        return estimate
    }

    mutating func reset() { estimate = nil; recordedAt = nil }

    static func startupCap(configured: Double, throughput: Double?, recoveringFromStall: Bool = false) -> Double {
        // AVPlayer already adapts to bandwidth. Old observations must not impose
        // a second quality ceiling on every following story after reception improves.
        guard recoveringFromStall else { return configured }
        guard let throughput, throughput.isFinite, throughput > 0 else { return configured }
        return min(configured, max(600_000, throughput * 0.7))
    }
}

enum MediaImagePixelBudget {
    static let thumbnail: CGFloat = 640
    static func avatar(points: CGFloat, scale: CGFloat) -> CGFloat {
        bucket(for: max(1, points) * max(1, scale), ceiling: 512)
    }
    static func bucket(for pixels: CGFloat, ceiling: CGFloat) -> CGFloat {
        guard pixels.isFinite, pixels > 0 else { return ceiling }
        return min([128, 256, 512, 640, 1280, 1920, 2560].first { CGFloat($0) >= pixels }.map(CGFloat.init) ?? ceiling, ceiling)
    }
}


struct StoryPreheatPolicy {
    /// During an upload, reserve only the immediately upcoming player. Require
    /// measured download headroom and healthy visible playback, even on Wi-Fi.
    static func concurrentUploadPlayerLimit(configured: Int, uploading: Bool,
        visiblePlayback: Bool, buffering: Bool, constrained: Bool,
        resourceLimited: Bool, throughput: Double?) -> Int {
        guard !buffering else { return 0 }
        guard uploading else { return max(0, configured) }
        guard visiblePlayback, !constrained, !resourceLimited,
              let throughput, throughput.isFinite, throughput >= 8_000_000 else { return 0 }
        return min(max(0, configured), 1)
    }

    static func playerLimit(throughput: Double?, isLimited: Bool) -> Int {
        if isLimited { return 1 }
        guard let throughput, throughput.isFinite, throughput > 0 else { return 1 }
        return throughput >= 8_000_000 ? 3 : 2
    }

    static func canResumePreparation(visible: Bool, stalled: Bool, local: Bool, likelyToKeepUp: Bool, bufferedAhead: Double, throughput: Double?, recoveryReserve: Double = 0, coolingDown: Bool = false, remainingSeconds: Double? = nil) -> Bool {
        guard visible, !stalled else { return false }
        if local { return true }
        guard !coolingDown else { return false }
        var required = max((throughput ?? 0) >= 8_000_000 ? 1.0 : 2.0, recoveryReserve)
        if let remainingSeconds, remainingSeconds.isFinite, remainingSeconds > 0 {
            required = max(0.25, min(required, remainingSeconds - 0.05))
        }
        return likelyToKeepUp && bufferedAhead.isFinite && bufferedAhead >= required
    }
}

/// Bounded preparation order, with the active item always first even on a reversal.
struct StoryWarmOrder {
    static func indices(active: Int, count: Int, mode: UBEYEAdaptiveMode, direction: Int) -> [Int] {
        guard active >= 0, active < count else { return [] }
        let step = direction < 0 ? -1 : 1
        let offsets: [Int] = mode == .standard ? [0, step, step * 2, step * 3, -step] : (mode == .constrained ? [0, step] : [0])
        return offsets.map { active + $0 }.filter { $0 >= 0 && $0 < count }
    }
}

/// Recent confirmed stalls reserve bandwidth until a contiguous buffer has recovered.
struct PlaybackRecoveryHistory {
    private var stalls: [TimeInterval] = []
    mutating func recordStall(at now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        stalls = stalls.filter { now >= $0 && now - $0 < 60 }
        stalls.append(now)
        if stalls.count > 3 { stalls.removeFirst(stalls.count - 3) }
    }
    mutating func reset() { stalls.removeAll() }
    func requiredReserve(at now: TimeInterval = ProcessInfo.processInfo.systemUptime) -> TimeInterval {
        let recent = stalls.filter { now >= $0 && now - $0 < 60 }
        return recent.isEmpty ? 0 : min(4, Double(recent.count + 1))
    }
    func isCoolingDown(at now: TimeInterval = ProcessInfo.processInfo.systemUptime) -> Bool {
        guard let last = stalls.last, now >= last else { return false }
        return now - last < 3
    }
}
