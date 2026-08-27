import AVFoundation
import CoreGraphics
import Foundation

struct StoryVideoPlaybackSource: Hashable {
    let identity: String
    let url: URL
    let durationSeconds: TimeInterval?

    init(
        identity: String,
        url: URL,
        durationSeconds: TimeInterval? = nil
    ) {
        self.identity = identity
        self.url = MediaPlaybackQuality.adaptivePlaybackURL(for: url)
        self.durationSeconds = durationSeconds
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
    static func startupPlaybackURL(for url: URL) -> URL {
        let adaptiveURL = adaptivePlaybackURL(for: url)
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
            $0.name.caseInsensitiveCompare(clientBandwidthHintQueryName) != .orderedSame
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
