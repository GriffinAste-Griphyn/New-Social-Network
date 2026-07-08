import AVFoundation
import CoreGraphics
import Foundation

enum MediaPlaybackQuality {
    private static let maxDirectOriginalBytes = 512 * 1024 * 1024

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
    static func highQualityCandidate(for card: StoryCard) -> URL? {
        guard card.isPlayableVideo else {
            return nil
        }

        return highQualityCandidate(from: card.renditions)
    }

    @MainActor
    static func highQualityCandidate(for item: StoryStackItem) -> URL? {
        guard item.isPlayableVideo else {
            return nil
        }

        return highQualityCandidate(from: item.renditions)
    }

    @MainActor
    static func preloadURLs(for card: StoryCard) -> [URL] {
        guard card.isPlayableVideo else {
            return []
        }

        return [card.playbackMediaUrl] + [highQualityCandidate(for: card)].compactMap { $0 }
    }

    @MainActor
    static func preloadURLs(for item: StoryStackItem) -> [URL] {
        guard item.isPlayableVideo else {
            return []
        }

        return [item.playbackMediaUrl] + [highQualityCandidate(for: item)].compactMap { $0 }
    }

    @MainActor
    static func preferredPlaybackURL(
        defaultURL: URL,
        highQualityURL: URL?,
        playerPool: StoryVideoPlaybackPool?
    ) async -> (url: URL, quality: String) {
        guard let highQualityURL else {
            return (defaultURL, "playback")
        }

        if playerPool?.hasPreparedPlayer(for: highQualityURL) == true {
            return (highQualityURL, "original_pooled")
        }

        if await MediaFileDiskCache.shared.hasCachedFile(for: highQualityURL) {
            return (highQualityURL, "original_cached")
        }

        return (defaultURL, "playback_original_deferred")
    }

    @MainActor
    private static func highQualityCandidate(from renditions: StoryMediaRenditions?) -> URL? {
        guard let original = renditions?.original,
              isDirectPlayableOriginal(original) else {
            return nil
        }

        return original.mediaUrl
    }

    static func isDirectPlayableOriginal(_ rendition: StoryMediaRendition) -> Bool {
        guard rendition.processingStatus == nil || rendition.processingStatus == "ready" else {
            return false
        }

        if let byteSize = rendition.byteSize,
           byteSize > maxDirectOriginalBytes {
            return false
        }

        if isHTTPStreamingPlaylist(rendition.mediaUrl) {
            return false
        }

        let contentType = rendition.contentType?.lowercased()
        if contentType == "video/mp4" || contentType == "video/x-m4v" || contentType == "video/quicktime" {
            return true
        }

        switch rendition.mediaUrl.pathExtension.lowercased() {
        case "mp4", "m4v", "mov":
            return true
        default:
            return false
        }
    }
}
