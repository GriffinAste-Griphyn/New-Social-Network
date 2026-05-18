import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import Network
import os
import SwiftUI
import UIKit

extension Color {
    static let ubeyeRed = Color(red: 224 / 255, green: 22 / 255, blue: 22 / 255)
    static let ubeyeNavy = Color(red: 13 / 255, green: 18 / 255, blue: 28 / 255)
    static let ubeyeInk = Color(red: 15 / 255, green: 16 / 255, blue: 20 / 255)
    static let ubeyeMuted = Color(red: 107 / 255, green: 114 / 255, blue: 128 / 255)
    static let ubeyeSubtle = Color(red: 246 / 255, green: 247 / 255, blue: 249 / 255)
    static let ubeyeBackground = Color(red: 250 / 255, green: 250 / 255, blue: 251 / 255)
    static let ubeyePanel = Color.white
    static let ubeyeBorder = Color(red: 229 / 255, green: 231 / 255, blue: 235 / 255)
    static let ubeyeYellow = Color(red: 253 / 255, green: 224 / 255, blue: 71 / 255)
    static let ubeyePurple = Color(red: 124 / 255, green: 58 / 255, blue: 237 / 255)
}

enum UBEYEMetrics {
    static let screenInset: CGFloat = 16
    static let topAvatar: CGFloat = 42
    static let topAvatarTopInset: CGFloat = 14
    static let compactTopAvatar: CGFloat = 38
}

extension View {
    func ubeyeScreen() -> some View {
        self
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.ubeyeBackground.ignoresSafeArea())
            .foregroundStyle(Color.ubeyeInk)
    }

    func ubeyeCard(cornerRadius: CGFloat = 8) -> some View {
        self
            .background(Color.ubeyePanel)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.ubeyeBorder.opacity(0.85), lineWidth: 1)
            )
    }

    func ubeyeMediaCardChrome(cornerRadius: CGFloat = 8) -> some View {
        self
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(.white.opacity(0.16), lineWidth: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.black.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.10), radius: 12, x: 0, y: 6)
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String
    var systemImage: String = "sparkles"

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Color.ubeyeRed)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.ubeyeMuted)
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .ubeyeCard()
    }
}

struct PrimaryButton: View {
    let title: String
    var isLoading = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                }
                Text(title)
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(Color.ubeyeNavy)
            .clipShape(Capsule())
            .foregroundStyle(.white)
        }
        .disabled(isLoading)
    }
}

struct UBEYEWordmark: View {
    var compact = false

    var body: some View {
        Image("UBEYELogo")
            .resizable()
            .scaledToFit()
        .frame(width: compact ? 32 : 38, height: compact ? 32 : 38)
        .accessibilityLabel("UBEYE")
    }
}

struct CircleIconButton: View {
    let systemImage: String
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 36, height: 36)
                .foregroundStyle(Color.ubeyeInk)
                .background(Color.ubeyeSubtle, in: Circle())
        }
        .buttonStyle(.plain)
    }
}

struct RemoteAvatar: View {
    let url: URL?
    var size: CGFloat = 44
    var name: String = ""
    @State private var loadedImage: UIImage?
    @State private var loadedImageURL: URL?

    var body: some View {
        ZStack {
            if let image = MediaImageCache.shared.cachedImage(for: url) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if loadedImageURL == url, let image = loadedImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .task(id: url) {
            await loadImageIfNeeded()
        }
    }

    private var placeholder: some View {
        ZStack {
            Circle().fill(Color.ubeyeRed)
            Text(initials)
                .font(.system(size: max(11, size * 0.32), weight: .black))
                .foregroundStyle(.white)
        }
    }

    private var initials: String {
        let parts = name.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first }
        let value = String(letters).uppercased()
        return value.isEmpty ? "U" : value
    }

    private func loadImageIfNeeded() async {
        guard let url else {
            loadedImage = nil
            loadedImageURL = nil
            return
        }

        if let cached = MediaImageCache.shared.cachedImage(for: url) {
            loadedImage = cached
            loadedImageURL = url
            return
        }

        loadedImage = nil
        loadedImageURL = nil

        if let image = await MediaImageCache.shared.loadImage(for: url) {
            loadedImage = image
            loadedImageURL = url
        } else {
            loadedImage = nil
            loadedImageURL = nil
        }
    }
}

struct TopAvatarSpacer: View {
    var body: some View {
        Color.clear
            .frame(width: UBEYEMetrics.topAvatar, height: UBEYEMetrics.topAvatar)
    }
}

enum MediaPerformance {
    private static let logger = Logger(subsystem: "com.griffinaste.ubeye", category: "media")

    static func mark(_ event: String) {
        logger.info("\(event, privacy: .public)")
    }

    static func measure(_ event: String, since start: Date) {
        let elapsedMs = Int(Date().timeIntervalSince(start) * 1000)
        logger.info("\(event, privacy: .public) \(elapsedMs)ms")
    }
}

enum AppAudioSession {
    static func configureForVideoRecording() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker])
            try session.setPreferredSampleRate(48_000)
            try session.setActive(true)
            MediaPerformance.mark("audio_session_video_recording")
        } catch {
            MediaPerformance.mark("audio_session_video_recording_failed")
        }
    }

    static func configureForVideoPlayback() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .moviePlayback)
            try session.setPreferredSampleRate(48_000)
            try session.setActive(true)
            MediaPerformance.mark("audio_session_video_playback")
        } catch {
            MediaPerformance.mark("audio_session_video_playback_failed")
        }
    }
}

enum MediaDiagnostics {
    static func logCapturedVideo(url: URL) {
        let asset = AVURLAsset(url: url)
        let audioTrack = asset.tracks(withMediaType: .audio).first

        guard let audioTrack else {
            MediaPerformance.mark("capture_audio_missing")
            return
        }

        let dataRate = Int(audioTrack.estimatedDataRate)
        let formatDescription = audioTrack.formatDescriptions.first.map {
            $0 as! CMAudioFormatDescription
        }
        let streamDescription = formatDescription.flatMap {
            CMAudioFormatDescriptionGetStreamBasicDescription($0)
        }
        let sampleRate = Int(streamDescription?.pointee.mSampleRate ?? 0)
        let channels = Int(streamDescription?.pointee.mChannelsPerFrame ?? 0)
        let codec = formatDescription
            .map { fourCharacterCode(CMFormatDescriptionGetMediaSubType($0)) } ??
            "unknown"

        MediaPerformance.mark(
            "capture_audio codec=\(codec) sample_rate=\(sampleRate) channels=\(channels) bitrate=\(dataRate)"
        )
    }

    private static func fourCharacterCode(_ value: FourCharCode) -> String {
        let bytes: [UInt8] = [
            UInt8((value >> 24) & 0xff),
            UInt8((value >> 16) & 0xff),
            UInt8((value >> 8) & 0xff),
            UInt8(value & 0xff),
        ]

        return String(bytes: bytes, encoding: .macOSRoman) ?? "\(value)"
    }
}

@MainActor
final class NetworkQualityMonitor {
    static let shared = NetworkQualityMonitor()

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "ubeye.network-quality")
    private(set) var isConstrained = false
    private(set) var isCellular = false

    var imagePreheatLimit: Int {
        isConstrained || isCellular ? 10 : 24
    }

    var stackPreheatLimit: Int {
        isConstrained || isCellular ? 3 : 6
    }

    var videoPreheatLimit: Int {
        isConstrained || isCellular ? 1 : 2
    }

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isConstrained = path.isConstrained || path.isExpensive
                self?.isCellular = path.usesInterfaceType(.cellular)
            }
        }
        monitor.start(queue: queue)
    }
}

enum MediaFileKind: String {
    case image
    case video
}

private func isHTTPStreamingPlaylist(_ url: URL) -> Bool {
    url.pathExtension.lowercased() == "m3u8"
}

actor MediaFileDiskCache {
    static let shared = MediaFileDiskCache()

    private let rootURL: URL
    private let fileManager = FileManager.default
    private let maxCacheBytes = 512 * 1024 * 1024

    private init() {
        rootURL = fileManager
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("media-cache", isDirectory: true)
    }

    func cachedFileURL(for url: URL) -> URL? {
        let fileURL = fileURL(for: url)

        guard fileManager.fileExists(atPath: fileURL.path) else {
            return nil
        }

        try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: fileURL.path)
        MediaPerformance.mark("media_file_cache_hit url=\(url.lastPathComponent)")
        return fileURL
    }

    func playbackURL(for url: URL) -> URL {
        cachedFileURL(for: url) ?? url
    }

    func supportsPersistence(url: URL, kind: MediaFileKind) -> Bool {
        shouldPersist(url: url, kind: kind)
    }

    func removeAll() {
        try? fileManager.removeItem(at: rootURL)
    }

    @discardableResult
    func cache(url: URL, kind: MediaFileKind) async -> URL? {
        if let cached = cachedFileURL(for: url) {
            return cached
        }

        guard shouldPersist(url: url, kind: kind) else {
            MediaPerformance.mark("media_file_cache_skip kind=\(kind.rawValue) url=\(url.lastPathComponent)")
            return nil
        }

        let startedAt = Date()
        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        request.timeoutInterval = kind == .video ? 60 : 25

        do {
            let (temporaryURL, response) = try await URLSession.shared.download(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode) else {
                return nil
            }

            let finalURL = fileURL(
                for: url,
                contentType: httpResponse.mimeType ?? response.mimeType
            )
            try fileManager.createDirectory(
                at: finalURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try? fileManager.removeItem(at: finalURL)
            try fileManager.moveItem(at: temporaryURL, to: finalURL)
            try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: finalURL.path)
            pruneIfNeeded()
            MediaPerformance.measure("media_file_cache_write kind=\(kind.rawValue) url=\(url.lastPathComponent)", since: startedAt)
            return finalURL
        } catch {
            MediaPerformance.mark("media_file_cache_failed kind=\(kind.rawValue) url=\(url.lastPathComponent)")
            return nil
        }
    }

    private func shouldPersist(url: URL, kind: MediaFileKind) -> Bool {
        if isHTTPStreamingPlaylist(url) {
            return false
        }

        let pathExtension = url.pathExtension.lowercased()

        switch kind {
        case .image:
            return ["jpg", "jpeg", "png", "webp", "heic"].contains(pathExtension) || pathExtension.isEmpty
        case .video:
            return ["mp4", "mov", "m4v"].contains(pathExtension)
        }
    }

    private func fileURL(for url: URL, contentType: String? = nil) -> URL {
        let stableURL = stableCacheURL(for: url)
        let digest = SHA256.hash(data: Data(stableURL.absoluteString.utf8))
        let key = digest.map { String(format: "%02x", $0) }.joined()
        let fileExtension = fileExtension(for: url, contentType: contentType)

        return rootURL.appendingPathComponent("\(key).\(fileExtension)", isDirectory: false)
    }

    private func stableCacheURL(for url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }

        components.queryItems = components.queryItems?
            .filter { $0.name.lowercased() != "token" }
            .sorted { $0.name < $1.name }

        return components.url ?? url
    }

    private func fileExtension(for url: URL, contentType: String?) -> String {
        let pathExtension = url.pathExtension.lowercased()

        if !pathExtension.isEmpty, pathExtension != "m3u8" {
            return pathExtension
        }

        switch contentType?.lowercased() {
        case "image/jpeg":
            return "jpg"
        case "image/png":
            return "png"
        case "image/webp":
            return "webp"
        case "video/mp4":
            return "mp4"
        case "video/quicktime":
            return "mov"
        default:
            return "media"
        }
    }

    private func pruneIfNeeded() {
        guard let files = try? fileManager.contentsOfDirectory(
            at: rootURL,
            includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey]
        ) else {
            return
        }

        let records = files.compactMap { url -> (url: URL, size: Int, modifiedAt: Date) in
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            return (
                url,
                values?.fileSize ?? 0,
                values?.contentModificationDate ?? .distantPast
            )
        }
        var totalBytes = records.reduce(0) { $0 + $1.size }

        guard totalBytes > maxCacheBytes else {
            return
        }

        for record in records.sorted(by: { $0.modifiedAt < $1.modifiedAt }) {
            try? fileManager.removeItem(at: record.url)
            totalBytes -= record.size

            if totalBytes <= maxCacheBytes {
                break
            }
        }
    }
}

@MainActor
final class MediaImageCache {
    static let shared = MediaImageCache()

    private let cache = NSCache<NSURL, UIImage>()
    private let maxDecodedPixelDimension: CGFloat = 1_800

    private init() {
        cache.countLimit = 220
        cache.totalCostLimit = 96 * 1024 * 1024
    }

    func cachedImage(for url: URL?) -> UIImage? {
        guard let url else {
            return nil
        }
        return cache.object(forKey: url as NSURL)
    }

    func loadImage(for url: URL) async -> UIImage? {
        if let cached = cachedImage(for: url) {
            return cached
        }

        if let fileURL = await MediaFileDiskCache.shared.cachedFileURL(for: url),
           let image = await ImageDecodePipeline.decode(contentsOf: fileURL, maxPixelDimension: maxDecodedPixelDimension) {
            cache.setObject(image, forKey: url as NSURL, cost: image.cacheCost)
            return image
        }

        if let fileURL = await MediaFileDiskCache.shared.cache(url: url, kind: .image),
           let image = await ImageDecodePipeline.decode(contentsOf: fileURL, maxPixelDimension: maxDecodedPixelDimension) {
            cache.setObject(image, forKey: url as NSURL, cost: image.cacheCost)
            return image
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        request.timeoutInterval = 20

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse,
               !(200..<300).contains(httpResponse.statusCode) {
                return nil
            }

            guard let image = await ImageDecodePipeline.decode(data: data, maxPixelDimension: maxDecodedPixelDimension) else {
                return nil
            }

            cache.setObject(image, forKey: url as NSURL, cost: image.cacheCost)
            return image
        } catch {
            return nil
        }
    }

    func preheat(_ urls: [URL], limit: Int = 16) {
        var seen = Set<URL>()
        let uniqueUrls = urls.filter { seen.insert($0).inserted }.prefix(limit)

        for url in uniqueUrls {
            Task {
                _ = await loadImage(for: url)
            }
        }
    }
}

private enum ImageDecodePipeline {
    static func decode(contentsOf fileURL: URL, maxPixelDimension: CGFloat) async -> UIImage? {
        await Task.detached(priority: .utility) {
            guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, nil) else {
                return UIImage(contentsOfFile: fileURL.path)
            }

            return downsample(source: source, maxPixelDimension: maxPixelDimension)
        }.value
    }

    static func decode(data: Data, maxPixelDimension: CGFloat) async -> UIImage? {
        await Task.detached(priority: .utility) {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
                return UIImage(data: data)
            }

            return downsample(source: source, maxPixelDimension: maxPixelDimension)
        }.value
    }

    private static func downsample(source: CGImageSource, maxPixelDimension: CGFloat) -> UIImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(maxPixelDimension)
        ]

        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }

        return UIImage(cgImage: cgImage)
    }
}

private extension UIImage {
    var cacheCost: Int {
        guard let cgImage else {
            return 1
        }

        return max(cgImage.bytesPerRow * cgImage.height, 1)
    }
}

@MainActor
final class WarmVideoPlayerPool {
    static let shared = WarmVideoPlayerPool()

    private var players: [URL: AVPlayer] = [:]
    private var order: [URL] = []
    private let maxPlayerCount = 4

    private init() {}

    func prepare(urls: [URL], limit: Int = 2) {
        var seen = Set<URL>()
        let uniqueUrls = urls
            .filter { seen.insert($0).inserted }
            .prefix(limit)

        for url in uniqueUrls where players[url] == nil {
            Task { @MainActor in
                let playbackURL = await MediaFileDiskCache.shared.playbackURL(for: url)
                guard players[url] == nil else {
                    return
                }

                let player = makePlayer(url: playbackURL)
                players[url] = player
                order.append(url)
                prune()
            }
        }
    }

    func takePlayer(for url: URL, playbackURL: URL) -> AVPlayer {
        if let player = players.removeValue(forKey: url) {
            order.removeAll { $0 == url }
            player.pause()
            player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
            return player
        }

        return makePlayer(url: playbackURL)
    }

    private func makePlayer(url: URL) -> AVPlayer {
        let item = AVPlayerItem(url: url)
        let isStreaming = isHTTPStreamingPlaylist(url)

        item.preferredForwardBufferDuration = isStreaming ? 6 : 3

        let player = AVPlayer(playerItem: item)
        player.automaticallyWaitsToMinimizeStalling = isStreaming
        return player
    }

    private func prune() {
        while order.count > maxPlayerCount {
            let url = order.removeFirst()
            players[url]?.pause()
            players.removeValue(forKey: url)
        }
    }
}

struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    let url: URL?
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder
    @State private var loadedImage: UIImage?
    @State private var loadedImageURL: URL?

    init(
        url: URL?,
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.url = url
        self.content = content
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let image = MediaImageCache.shared.cachedImage(for: url) {
                content(Image(uiImage: image))
            } else if loadedImageURL == url, let image = loadedImage {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            await loadImageIfNeeded()
        }
    }

    private func loadImageIfNeeded() async {
        guard let url else {
            loadedImage = nil
            loadedImageURL = nil
            return
        }

        if loadedImageURL == url, loadedImage != nil {
            return
        }

        loadedImage = nil
        loadedImageURL = nil

        if let image = await MediaImageCache.shared.loadImage(for: url) {
            loadedImage = image
            loadedImageURL = url
        }
    }
}

enum MediaPreheater {
    @MainActor
    static func configureURLCache() {
        _ = NetworkQualityMonitor.shared
        URLCache.shared = URLCache(
            memoryCapacity: 64 * 1024 * 1024,
            diskCapacity: 512 * 1024 * 1024,
            directory: nil
        )
    }

    @MainActor
    static func preheat(feed: MobileFeedResponse) {
        let imageUrls = [
            feed.myStory.latestThumbnailUrl,
            feed.myStory.owner.imageUrl
        ] +
        feed.followingProfiles.map(\.imageUrl) +
        feed.suggestedAccounts.map(\.imageUrl) +
        feed.verticalFollowingStories.map { $0.thumbnailUrl ?? ($0.assetKind == .image ? $0.mediaUrl : nil) } +
        feed.followingStories.map { $0.thumbnailUrl ?? ($0.assetKind == .image ? $0.mediaUrl : nil) } +
        feed.discoverTiles.map { $0.thumbnailUrl ?? $0.imageUrl }

        MediaImageCache.shared.preheat(
            imageUrls.compactMap { $0 },
            limit: NetworkQualityMonitor.shared.imagePreheatLimit
        )

        MediaPerformance.mark("feed_media_preheat thumbnails_only")
    }

    @MainActor
    static func preheat(stack: StoryStack, around index: Int = 0) {
        let lowerBound = max(index - 1, 0)
        let upperBound = min(index + 2, max(stack.items.count - 1, 0))

        guard lowerBound <= upperBound else {
            return
        }

        let nearbyItems = Array(stack.items[lowerBound...upperBound])
        let imageUrls = nearbyItems.map { item in
            item.thumbnailUrl ?? (item.assetKind == .image ? item.mediaUrl : nil)
        }
        MediaImageCache.shared.preheat(
            imageUrls.compactMap { $0 },
            limit: min(8, NetworkQualityMonitor.shared.imagePreheatLimit)
        )

        let videoUrls = [stack.items[safe: index], stack.items[safe: index + 1]]
            .compactMap { $0 }
            .filter { $0.assetKind == .video }
            .map(\.mediaUrl)

        preheatVideoStarts(videoUrls, limit: min(2, NetworkQualityMonitor.shared.videoPreheatLimit))
    }

    @MainActor
    private static func preheatVideoStarts(_ urls: [URL], limit: Int) {
        var seen = Set<URL>()
        let uniqueUrls = Array(urls.filter { seen.insert($0).inserted }.prefix(limit))

        guard !uniqueUrls.isEmpty else {
            return
        }

        WarmVideoPlayerPool.shared.prepare(urls: uniqueUrls, limit: limit)
    }
}

struct UBEYEPill: View {
    let title: String
    var systemImage: String?
    var tint: Color = .ubeyeRed

    var body: some View {
        HStack(spacing: 6) {
            if let systemImage {
                Image(systemName: systemImage)
            }
            Text(title)
        }
        .font(.caption.weight(.bold))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .foregroundStyle(tint)
        .background(tint.opacity(0.1), in: Capsule())
    }
}

struct InlineNotice: View {
    let message: String
    var isError = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(isError ? Color.ubeyeRed : Color.green)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.ubeyeInk)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background((isError ? Color.ubeyeRed : Color.green).opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke((isError ? Color.ubeyeRed : Color.green).opacity(0.18), lineWidth: 1)
        )
    }
}
