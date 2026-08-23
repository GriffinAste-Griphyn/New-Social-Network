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
        self.url = url
        self.durationSeconds = durationSeconds
    }

    func representsSameMedia(as other: StoryVideoPlaybackSource?) -> Bool {
        identity == other?.identity
    }

    static func urlBacked(_ url: URL) -> StoryVideoPlaybackSource {
        StoryVideoPlaybackSource(
            identity: StoryVideoPlaybackPool.canonicalURL(for: url).absoluteString,
            url: url,
            durationSeconds: nil
        )
    }
}

enum MediaPlaybackQuality {
    @MainActor
    static var preferredStreamingPeakBitRate: Double {
        NetworkQualityMonitor.shared.startupStreamingPeakBitRate
    }

    @MainActor
    static var preferredStreamingMaximumResolution: CGSize {
        NetworkQualityMonitor.shared.startupStreamingMaximumResolution
    }

    @MainActor
    static var offlineStreamingPeakBitRate: Double {
        min(NetworkQualityMonitor.shared.startupStreamingPeakBitRate, 2_000_000)
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
        let quality = isHTTPStreamingPlaylist(defaultURL) ? "adaptive_hls" : "playback"
        return (defaultURL, quality)
    }
}
