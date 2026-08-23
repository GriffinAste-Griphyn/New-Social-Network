import AVFoundation
import CoreGraphics
import Foundation

struct StoryVideoPlaybackSource: Hashable {
    let identity: String
    let url: URL

    func representsSameMedia(as other: StoryVideoPlaybackSource?) -> Bool {
        identity == other?.identity
    }

    static func urlBacked(_ url: URL) -> StoryVideoPlaybackSource {
        StoryVideoPlaybackSource(
            identity: StoryVideoPlaybackPool.canonicalURL(for: url).absoluteString,
            url: url
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
