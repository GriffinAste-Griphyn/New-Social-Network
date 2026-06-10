import AVFoundation
import CoreGraphics
import Foundation

enum MediaPlaybackQuality {
    private static let maxAdaptiveOriginalBytes = 90 * 1024 * 1024

    @MainActor
    static var preferredStreamingPeakBitRate: Double {
        NetworkQualityMonitor.shared.isConstrained || NetworkQualityMonitor.shared.isCellular
            ? 4_000_000
            : 16_000_000
    }

    @MainActor
    static var preferredStreamingMaximumResolution: CGSize {
        NetworkQualityMonitor.shared.isConstrained || NetworkQualityMonitor.shared.isCellular
            ? CGSize(width: 1920, height: 1920)
            : CGSize(width: 2160, height: 2160)
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
        guard shouldConsiderHighQualityPlayback,
              let highQualityURL else {
            return (defaultURL, "playback")
        }

        if playerPool?.hasPreparedPlayer(for: highQualityURL) == true {
            return (highQualityURL, "original_pooled")
        }

        if await MediaFileDiskCache.shared.hasCachedFile(for: highQualityURL) {
            return (highQualityURL, "original_cached")
        }

        return (defaultURL, "playback")
    }

    @MainActor
    private static var shouldConsiderHighQualityPlayback: Bool {
        !NetworkQualityMonitor.shared.isConstrained && !NetworkQualityMonitor.shared.isCellular
    }

    @MainActor
    private static func highQualityCandidate(from renditions: StoryMediaRenditions?) -> URL? {
        guard shouldConsiderHighQualityPlayback,
              let original = renditions?.original,
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
           byteSize > maxAdaptiveOriginalBytes {
            return false
        }

        if isHTTPStreamingPlaylist(rendition.mediaUrl) {
            return false
        }

        let contentType = rendition.contentType?.lowercased()
        if contentType == "video/mp4" || contentType == "video/x-m4v" {
            return true
        }

        switch rendition.mediaUrl.pathExtension.lowercased() {
        case "mp4", "m4v":
            return true
        default:
            return false
        }
    }
}
