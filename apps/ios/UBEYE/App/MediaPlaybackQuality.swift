import AVFoundation
import CoreGraphics
import Foundation

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
    static func relaxStreamingHints(for item: AVPlayerItem?, playbackURL: URL?) {
        guard let item,
              playbackURL?.pathExtension.lowercased() == "m3u8" else {
            return
        }

        item.preferredPeakBitRate = 0
        item.preferredMaximumResolution = .zero
    }

    @MainActor
    static func preloadURLs(for card: StoryCard) -> [URL] {
        guard card.isPlayableVideo else {
            return []
        }

        return [card.playbackMediaUrl]
    }

    @MainActor
    static func preferredPlaybackURL(
        defaultURL: URL
    ) -> (url: URL, quality: String) {
        let quality = isHTTPStreamingPlaylist(defaultURL) ? "adaptive_hls" : "playback"
        return (defaultURL, quality)
    }
}
