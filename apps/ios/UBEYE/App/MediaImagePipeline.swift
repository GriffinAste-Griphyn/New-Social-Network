import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import MetricKit
import Network
import os
import SwiftUI
import UIKit

enum MediaFileKind: String {
    case image
    case video
}

func isHTTPStreamingPlaylist(_ url: URL) -> Bool {
    url.pathExtension.lowercased() == "m3u8"
}

actor MediaFileDiskCache {
    static let shared = MediaFileDiskCache()

    private let rootURL: URL
    private let fileManager = FileManager.default
    private let minimumAvailableCapacity: Int64 = 512 * 1024 * 1024
    private var maxCacheBytes: Int {
        MediaControlConfig.shared.mediaFileCacheMaxBytes
    }

    private init() {
        rootURL = fileManager
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("media-cache", isDirectory: true)
    }

    func cachedFileURL(for url: URL) -> URL? {
        let fileURLs = candidateFileURLs(for: url)

        for fileURL in fileURLs where fileManager.fileExists(atPath: fileURL.path) {
            try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: fileURL.path)
            MediaPerformance.mark("media_file_cache_hit url=\(url.lastPathComponent)")
            return fileURL
        }

        return nil
    }

    func hasCachedFile(for url: URL) -> Bool {
        candidateFileURLs(for: url).contains { fileManager.fileExists(atPath: $0.path) }
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
    func storeLocalFile(sourceURL: URL, for url: URL, kind: MediaFileKind) async -> URL? {
        guard canStoreLocalFile(for: url, kind: kind) else {
            MediaPerformance.mark("media_file_cache_skip kind=\(kind.rawValue) url=\(url.lastPathComponent)")
            return nil
        }

        let startedAt = Date()
        let sourceBytes = ((try? sourceURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        guard prepareCapacity(forAdditionalBytes: sourceBytes) else {
            MediaPerformance.mark("media_file_cache_skip kind=\(kind.rawValue) reason=storage_pressure")
            return nil
        }
        let finalURL = fileURL(
            for: url,
            contentType: contentType(forLocalFile: sourceURL, kind: kind)
        )

        do {
            try fileManager.createDirectory(
                at: finalURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try? fileManager.removeItem(at: finalURL)
            try fileManager.copyItem(at: sourceURL, to: finalURL)
            try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: finalURL.path)
            pruneIfNeeded()
            MediaPerformance.measure("media_file_cache_write kind=\(kind.rawValue) url=\(url.lastPathComponent)", since: startedAt)
            return finalURL
        } catch {
            MediaPerformance.mark("media_file_cache_failed kind=\(kind.rawValue) url=\(url.lastPathComponent)")
            return nil
        }
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

            let downloadedBytes = ((try? temporaryURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
            guard prepareCapacity(forAdditionalBytes: downloadedBytes) else {
                MediaPerformance.mark("media_file_cache_skip kind=\(kind.rawValue) reason=storage_pressure")
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
            return ["jpg", "jpeg", "png", "webp", "heic", "avif"].contains(pathExtension) || pathExtension.isEmpty
        case .video:
            return ["mp4", "mov", "m4v"].contains(pathExtension)
        }
    }

    private func canStoreLocalFile(for url: URL, kind: MediaFileKind) -> Bool {
        if isHTTPStreamingPlaylist(url) {
            return false
        }

        let pathExtension = url.pathExtension.lowercased()
        return pathExtension.isEmpty || shouldPersist(url: url, kind: kind)
    }

    private func contentType(forLocalFile sourceURL: URL, kind: MediaFileKind) -> String? {
        switch sourceURL.pathExtension.lowercased() {
        case "jpg", "jpeg":
            return "image/jpeg"
        case "png":
            return "image/png"
        case "webp":
            return "image/webp"
        case "avif":
            return "image/avif"
        case "mp4", "m4v":
            return "video/mp4"
        case "mov":
            return "video/quicktime"
        default:
            switch kind {
            case .image:
                return nil
            case .video:
                return "video/mp4"
            }
        }
    }

    private func fileURL(for url: URL, contentType: String? = nil) -> URL {
        let key = cacheKey(for: url)
        let fileExtension = fileExtension(for: url, contentType: contentType)

        return rootURL.appendingPathComponent("\(key).\(fileExtension)", isDirectory: false)
    }

    private func candidateFileURLs(for url: URL) -> [URL] {
        let defaultURL = fileURL(for: url)
        guard url.pathExtension.isEmpty else {
            return [defaultURL]
        }

        let key = cacheKey(for: url)
        let fallbackExtensions = ["mp4", "mov", "m4v", "jpg", "jpeg", "png", "webp", "heic", "avif", "media"]
        var seen = Set<URL>()
        return ([defaultURL] + fallbackExtensions.map {
            rootURL.appendingPathComponent("\(key).\($0)", isDirectory: false)
        }).filter { seen.insert($0).inserted }
    }

    private func cacheKey(for url: URL) -> String {
        let stableURL = stableCacheURL(for: url)
        let digest = SHA256.hash(data: Data(stableURL.absoluteString.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func stableCacheURL(for url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }

        components.queryItems = components.queryItems?
            .filter {
                let name = $0.name.lowercased()
                return name != "token" && name != "v"
            }
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
        case "image/avif":
            return "avif"
        case "video/mp4":
            return "mp4"
        case "video/quicktime":
            return "mov"
        default:
            return "media"
        }
    }

    private func prepareCapacity(forAdditionalBytes bytes: Int) -> Bool {
        pruneIfNeeded(additionalBytes: bytes)

        guard let values = try? rootURL.deletingLastPathComponent().resourceValues(
            forKeys: [.volumeAvailableCapacityKey]
        ), let availableCapacity = values.volumeAvailableCapacity else {
            return true
        }

        return Int64(availableCapacity) - Int64(max(bytes, 0)) >= minimumAvailableCapacity
    }

    private func pruneIfNeeded(additionalBytes: Int = 0) {
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
        let availableCapacity = try? rootURL.deletingLastPathComponent().resourceValues(
            forKeys: [.volumeAvailableCapacityKey]
        ).volumeAvailableCapacity
        let isUnderStoragePressure = availableCapacity.map {
            Int64($0) - Int64(max(additionalBytes, 0)) < minimumAvailableCapacity
        } ?? false
        let targetBytes = isUnderStoragePressure
            ? min(maxCacheBytes / 2, max(0, maxCacheBytes - additionalBytes))
            : max(0, maxCacheBytes - additionalBytes)

        guard totalBytes > targetBytes else {
            return
        }

        for record in records.sorted(by: { $0.modifiedAt < $1.modifiedAt }) {
            try? fileManager.removeItem(at: record.url)
            totalBytes -= record.size

            if totalBytes <= targetBytes {
                break
            }
        }
    }
}

@MainActor
final class MediaImageCache {
    static let shared = MediaImageCache()

    private struct InFlightLoad {
        let id: UUID
        let task: Task<UIImage?, Never>
    }

    private struct ActivePreheat {
        let id: UUID
        let task: Task<Void, Never>
    }

    private struct ImageKey: Hashable {
        let url: URL
        let pixels: Int
        var cacheKey: NSString { "\(pixels)|\(url.absoluteString)" as NSString }
    }
    private let cache = NSCache<NSString, UIImage>()
    private var inFlightLoads: [ImageKey: InFlightLoad] = [:]
    private var loadConsumers: [ImageKey: Set<UUID>] = [:]
    private var queuedPreheatURLs = Set<URL>()
    private var preheatQueue: [URL] = []
    private var activePreheats: [URL: ActivePreheat] = [:]
    private let maxDecodedPixelDimension: CGFloat
    private let maxCachedImageCost: Int
    private let maxConcurrentPreheats = 4
    private let maxPreheatWorkItems = 16

    private init() {
        let hasProClassMemory = ProcessInfo.processInfo.physicalMemory >= 6 * 1_024 * 1_024 * 1_024
        maxDecodedPixelDimension = min(max(UIScreen.main.nativeBounds.width, UIScreen.main.nativeBounds.height), hasProClassMemory ? 2_560 : 1_920)
        maxCachedImageCost = hasProClassMemory ? 48 * 1_024 * 1_024 : 24 * 1_024 * 1_024
        cache.countLimit = hasProClassMemory ? 200 : 120
        cache.totalCostLimit = hasProClassMemory ? 256 * 1_024 * 1_024 : 96 * 1_024 * 1_024
    }

    func cachedImage(for url: URL?, maxPixelDimension: CGFloat? = nil) -> UIImage? {
        guard let url else {
            return nil
        }
        return cache.object(forKey: imageKey(url: url, pixels: maxPixelDimension).cacheKey)
    }

    private func imageKey(url: URL, pixels: CGFloat?) -> ImageKey {
        let basename = url.lastPathComponent.lowercased()
        let inferred = basename.contains("thumbnail") || basename.hasPrefix("thumb.") ? MediaImagePixelBudget.thumbnail : maxDecodedPixelDimension
        return ImageKey(url: url, pixels: Int(MediaImagePixelBudget.bucket(for: pixels ?? inferred, ceiling: maxDecodedPixelDimension)))
    }

    func loadImage(for url: URL, maxPixelDimension: CGFloat? = nil) async -> UIImage? {
        let key = imageKey(url: url, pixels: maxPixelDimension)
        if let cached = cachedImage(for: url, maxPixelDimension: maxPixelDimension) { return cached }
        guard !Task.isCancelled else { return nil }
        let consumer = UUID()
        loadConsumers[key, default: []].insert(consumer)
        defer { releaseLoadConsumer(consumer, for: key) }
        let load: InFlightLoad
        if let existing = inFlightLoads[key] {
            load = existing
        } else {
            let loadID = UUID()
            let task = Task<UIImage?, Never> { @MainActor [weak self] in
                guard let self, let image = await self.loadUncachedImage(for: url, pixels: CGFloat(key.pixels)),
                      !Task.isCancelled, self.inFlightLoads[key]?.id == loadID else { return nil }
                let cost = image.cacheCost
                if cost <= self.maxCachedImageCost {
                    self.cache.setObject(image, forKey: key.cacheKey, cost: cost)
                }
                return image
            }
            load = InFlightLoad(id: loadID, task: task)
            inFlightLoads[key] = load
        }
        let image = await withTaskCancellationHandler {
            await load.task.value
        } onCancel: {
            Task { @MainActor [weak self] in self?.releaseLoadConsumer(consumer, for: key) }
        }
        return Task.isCancelled ? nil : image
    }

    private func releaseLoadConsumer(_ consumer: UUID, for key: ImageKey) {
        guard loadConsumers[key]?.remove(consumer) != nil else { return }
        if loadConsumers[key]?.isEmpty == true {
            loadConsumers[key] = nil
            inFlightLoads.removeValue(forKey: key)?.task.cancel()
        }
    }

    func prepareForPresentation(
        _ urls: [URL],
        timeout: Duration
    ) async -> MediaImagePreparationResult {
        var seen = Set<URL>()
        let uniqueURLs = urls.filter { seen.insert($0).inserted }
        guard !uniqueURLs.isEmpty else {
            return MediaImagePreparationResult(requestedCount: 0, readyCount: 0, timedOut: false)
        }

        prioritizePreheat(uniqueURLs)
        // Presentation owns a real load consumer. Canceling speculative work
        // during an upload must not cancel thumbnails required by this screen.
        let presentationTask = Task { @MainActor [weak self] in
            for url in uniqueURLs {
                guard !Task.isCancelled, let self else { return }
                _ = await self.loadImage(for: url)
            }
        }
        defer { presentationTask.cancel() }

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        var readyCount = uniqueURLs.reduce(into: 0) { count, url in
            if cachedImage(for: url) != nil {
                count += 1
            }
        }

        while readyCount < uniqueURLs.count, clock.now < deadline, !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(20))
            readyCount = uniqueURLs.reduce(into: 0) { count, url in
                if cachedImage(for: url) != nil {
                    count += 1
                }
            }
        }

        return MediaImagePreparationResult(
            requestedCount: uniqueURLs.count,
            readyCount: readyCount,
            timedOut: readyCount < uniqueURLs.count
        )
    }

    func preheat(_ urls: [URL], limit: Int = 16) {
        guard limit > 0 else {
            return
        }

        var seen = Set<URL>()
        for url in urls where seen.insert(url).inserted {
            guard seen.count <= limit else {
                break
            }
            guard activePreheats.count + preheatQueue.count < maxPreheatWorkItems else {
                break
            }
            guard cachedImage(for: url) == nil,
                  inFlightLoads[imageKey(url: url, pixels: nil)] == nil,
                  activePreheats[url] == nil,
                  queuedPreheatURLs.insert(url).inserted else {
                continue
            }
            preheatQueue.append(url)
        }

        drainPreheatQueue()
    }

    func updatePredictivePreheat(_ urls: [URL], limit: Int = 12) {
        var seen = Set<URL>()
        let orderedURLs = urls
            .prefix(max(limit, 0))
            .filter { seen.insert($0).inserted }
        let desiredURLs = Set(orderedURLs)
        for url in Array(activePreheats.keys) where !desiredURLs.contains(url) {
            activePreheats.removeValue(forKey: url)?.task.cancel()
        }
        preheatQueue.removeAll { url in
            guard !desiredURLs.contains(url) else { return false }
            queuedPreheatURLs.remove(url)
            return true
        }
        prioritizePreheat(Array(orderedURLs))
        MediaPerformance.mark(
            "prefetch_intent kind=image desired=\(desiredURLs.count) queued=\(preheatQueue.count)"
        )
    }

    private func prioritizePreheat(_ urls: [URL]) {
        for url in urls.reversed() {
            guard cachedImage(for: url) == nil,
                  inFlightLoads[imageKey(url: url, pixels: nil)] == nil,
                  activePreheats[url] == nil else {
                continue
            }

            if let queuedIndex = preheatQueue.firstIndex(of: url) {
                preheatQueue.remove(at: queuedIndex)
                preheatQueue.insert(url, at: 0)
                continue
            }

            while activePreheats.count + preheatQueue.count >= maxPreheatWorkItems,
                  let displacedURL = preheatQueue.popLast() {
                queuedPreheatURLs.remove(displacedURL)
            }

            guard activePreheats.count + preheatQueue.count < maxPreheatWorkItems else {
                continue
            }

            queuedPreheatURLs.insert(url)
            preheatQueue.insert(url, at: 0)
        }

        drainPreheatQueue()
    }

    func removeAll() {
        for preheat in activePreheats.values {
            preheat.task.cancel()
        }
        activePreheats.removeAll()
        queuedPreheatURLs.removeAll()
        preheatQueue.removeAll()

        for load in inFlightLoads.values {
            load.task.cancel()
        }
        inFlightLoads.removeAll()
        loadConsumers.removeAll()
        cache.removeAllObjects()
    }

    private func loadUncachedImage(for url: URL, pixels: CGFloat) async -> UIImage? {
        if url.scheme?.lowercased() == "thumbhash",
           let image = Self.image(fromThumbHashURL: url) {
            return image
        }

        if url.scheme?.lowercased() == "data",
           let separator = url.absoluteString.firstIndex(of: ","),
           url.absoluteString[..<separator].lowercased() == "data:image/jpeg;base64",
           let data = Data(base64Encoded: String(url.absoluteString[url.absoluteString.index(after: separator)...])),
           let image = await ImageDecodePipeline.decode(data: data, maxPixelDimension: pixels) {
            return image
        }

        if url.isFileURL,
           let image = await ImageDecodePipeline.decode(contentsOf: url, maxPixelDimension: pixels) {
            return image
        }

        guard !Task.isCancelled else {
            return nil
        }

        if let fileURL = await MediaFileDiskCache.shared.cachedFileURL(for: url),
           let image = await ImageDecodePipeline.decode(contentsOf: fileURL, maxPixelDimension: pixels) {
            return image
        }

        guard !Task.isCancelled else {
            return nil
        }

        if let fileURL = await MediaFileDiskCache.shared.cache(url: url, kind: .image),
           let image = await ImageDecodePipeline.decode(contentsOf: fileURL, maxPixelDimension: pixels) {
            return image
        }

        guard !Task.isCancelled else {
            return nil
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

            guard let image = await ImageDecodePipeline.decode(data: data, maxPixelDimension: pixels) else {
                return nil
            }

            return image
        } catch {
            return nil
        }
    }

    private static func image(fromThumbHashURL url: URL) -> UIImage? {
        let resource = url.absoluteString.dropFirst("thumbhash:".count)
        var encoded = String(resource.split(separator: "?", maxSplits: 1)[0])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while encoded.count.isMultiple(of: 4) == false {
            encoded.append("=")
        }
        guard let hash = Data(base64Encoded: encoded), hash.count >= 5 else {
            return nil
        }
        let (width, height, rgba) = thumbHashToRGBA(hash: hash)
        guard width > 0, height > 0,
              let provider = CGDataProvider(data: rgba as CFData),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let image = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: width * 4,
                space: colorSpace,
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                provider: provider,
                decode: nil,
                shouldInterpolate: true,
                intent: .defaultIntent
              ) else {
            return nil
        }
        return UIImage(cgImage: image)
    }

    func suspendSpeculativePreheats() {
        for (url, preheat) in activePreheats {
            preheat.task.cancel()
            if queuedPreheatURLs.insert(url).inserted { preheatQueue.insert(url, at: 0) }
        }
        activePreheats.removeAll()
    }

    func resumeSpeculativePreheats() { drainPreheatQueue() }

    private func drainPreheatQueue() {
        guard NetworkQualityMonitor.shared.workBudget.images > 0 else { return }
        while activePreheats.count < maxConcurrentPreheats,
              !preheatQueue.isEmpty {
            let url = preheatQueue.removeFirst()
            queuedPreheatURLs.remove(url)

            guard cachedImage(for: url) == nil else {
                continue
            }

            let preheatID = UUID()
            let preheatTask = Task { @MainActor [weak self] in
                guard let self else {
                    return
                }
                _ = await loadImage(for: url)
                finishPreheat(for: url, id: preheatID)
            }
            activePreheats[url] = ActivePreheat(id: preheatID, task: preheatTask)
        }
    }

    private func finishPreheat(for url: URL, id: UUID) {
        guard activePreheats[url]?.id == id else {
            return
        }
        activePreheats[url] = nil
        drainPreheatQueue()
    }
}

struct MediaImagePreparationResult: Equatable {
    let requestedCount: Int
    let readyCount: Int
    let timedOut: Bool

    var isComplete: Bool {
        readyCount == requestedCount
    }
}

enum ImageDecodePipeline {
    static func decode(contentsOf fileURL: URL, maxPixelDimension: CGFloat) async -> UIImage? {
        await Task.detached(priority: .utility) {
            autoreleasepool {
                let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
                guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, sourceOptions) else {
                    return nil
                }

                return downsample(source: source, maxPixelDimension: maxPixelDimension)
            }
        }.value
    }

    static func decode(data: Data, maxPixelDimension: CGFloat) async -> UIImage? {
        await Task.detached(priority: .utility) {
            autoreleasepool {
                let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
                guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
                    return nil
                }

                return downsample(source: source, maxPixelDimension: maxPixelDimension)
            }
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

extension UIImage {
    var cacheCost: Int {
        guard let cgImage else {
            return 1
        }

        return max(cgImage.bytesPerRow * cgImage.height, 1)
    }
}

@MainActor
final class StableImageLoader: ObservableObject {
    private struct DisplayedImage {
        let url: URL
        let image: UIImage
    }
    @Published private var displayed: DisplayedImage?
    var displayedImage: UIImage? { displayed?.image }
    var displayedURL: URL? { displayed?.url }

    // SwiftUI evaluates the new URL before its .task starts. Never present a
    // retained image with a different URL's overlay or other metadata.
    func image(for url: URL?) -> UIImage? {
        guard let url, displayed?.url == url else { return nil }
        return displayed?.image
    }
    private(set) var requestedURL: URL?
    private var requestGeneration = 0

    func load(url: URL?) async {
        await load(
            url: url,
            retryDelays: [.milliseconds(450), .seconds(1), .seconds(2)]
        ) { url in
            await MediaImageCache.shared.loadImage(for: url)
        }
    }

    func load(
        url: URL?,
        retryDelays: [Duration],
        imageLoader: @escaping @MainActor (URL) async -> UIImage?
    ) async {
        requestGeneration &+= 1
        let generation = requestGeneration
        requestedURL = url

        guard let url else {
            displayed = nil
            return
        }

        if displayedURL == url, displayedImage != nil {
            return
        }

        for attempt in 0...retryDelays.count {
            guard !Task.isCancelled,
                  requestGeneration == generation,
                  requestedURL == url else {
                return
            }

            if let image = await imageLoader(url) {
                guard !Task.isCancelled,
                      requestGeneration == generation,
                      requestedURL == url else {
                    return
                }

                let previousURL = displayedURL
                displayed = DisplayedImage(url: url, image: image)
                if let previousURL, previousURL != url {
                    MediaPerformance.mark("thumbnail_generation_swap previous=ready next=ready")
                }
                return
            }

            guard attempt < retryDelays.count else {
                return
            }

            try? await Task.sleep(for: retryDelays[attempt])
        }
    }
}

struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    let url: URL?
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder
    @StateObject private var loader = StableImageLoader()

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
            } else if let image = loader.image(for: url) {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            await loader.load(url: url)
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
            feed.myStory.cardThumbnailUrl,
            feed.myStory.owner.imageUrl
        ] +
        feed.followingProfiles.map(\.imageUrl) +
        feed.suggestedAccounts.map(\.imageUrl) +
        feed.verticalFollowingStories.map(\.cardThumbnailUrl) +
        feed.followingStories.map(\.cardThumbnailUrl) +
        feed.discoverTiles.map { $0.thumbnailUrl ?? $0.imageUrl }

        MediaImageCache.shared.preheat(
            imageUrls.compactMap { $0 },
            limit: NetworkQualityMonitor.shared.imagePreheatLimit
        )

        MediaPerformance.mark("feed_media_preheat thumbnails_only")
    }

    @MainActor
    static func preheat(
        stack: StoryStack,
        around index: Int = 0,
        preheatVideoAssets: Bool = true,
        direction: Int = 1,
        additionalItems: [StoryStackItem] = []
    ) {
        let nearbyItems = orderedNearbyStoryItems(in: stack, around: index, direction: direction) + additionalItems
        let imageUrls = nearbyItems.flatMap { item -> [URL] in
            var urls: [URL] = [item.playbackPlaceholderUrl].compactMap { $0 }
            if let thumbnailUrl = item.playbackThumbnailUrl {
                urls.append(thumbnailUrl)
            }
            if item.assetKind == .image {
                urls.append(item.playbackMediaUrl)
            }
            return urls
        }
        MediaImageCache.shared.updatePredictivePreheat(
            imageUrls,
            limit: min(12, NetworkQualityMonitor.shared.imagePreheatLimit)
        )

        guard preheatVideoAssets,
              UBEYEResourceMonitor.shared.allowsSpeculativeMedia else {
            return
        }

        let videoUrls = nearbyItems
            .filter(\.isPlayableVideo)
            .map(\.playbackMediaUrl)
        let videoLimit = min(NetworkQualityMonitor.shared.persistentVideoPreheatLimit, 4)

        Task {
            await MediaVideoPreheater.shared.preheat(
                videoUrls,
                limit: videoLimit
            )
        }
    }

    @MainActor
    private static func orderedNearbyStoryItems(in stack: StoryStack, around index: Int, direction: Int) -> [StoryStackItem] {
        StoryWarmOrder.indices(active: index, count: stack.items.count, mode: UBEYEResourceMonitor.shared.mode, direction: direction).map { stack.items[$0] }
    }
}

actor MediaVideoPreheater {
    static let shared = MediaVideoPreheater()

    private struct ActivePreheat {
        let id: UUID
        let task: Task<Void, Never>
    }

    private var activePreheats: [URL: ActivePreheat] = [:]
    private var recentlyPreheatedAt: [URL: Date] = [:]
    private var isSuspended = false
    private let recentPreheatWindow: TimeInterval = 90

    func cancelSpeculativePreheats() {
        for preheat in activePreheats.values { preheat.task.cancel() }
        activePreheats.removeAll()
    }

    func suspend() {
        isSuspended = true
        for preheat in activePreheats.values {
            preheat.task.cancel()
        }
        activePreheats.removeAll()
    }

    func resume() {
        isSuspended = false
    }

    func preheat(_ urls: [URL], limit: Int) async {
        guard !isSuspended, limit > 0, await NetworkQualityMonitor.shared.workBudget.persistentVideos > 0 else {
            return
        }

        let now = Date()
        var seen = Set<URL>()
        let candidates = urls
            .filter { seen.insert($0).inserted }
            .filter { url in
                guard activePreheats[url] == nil else {
                    return false
                }

                if let lastPreheatedAt = recentlyPreheatedAt[url],
                   now.timeIntervalSince(lastPreheatedAt) < recentPreheatWindow {
                    return false
                }

                return true
            }
            .prefix(limit)

        guard !candidates.isEmpty else {
            return
        }

        pruneRecentEntries(now: now)

        for url in candidates {
            let preheatID = UUID()
            let task = Task.detached(priority: .utility) { [weak self] in
                let completed = await Self.preheatOne(url)
                await self?.finish(url, id: preheatID, completed: completed)
            }
            activePreheats[url] = ActivePreheat(id: preheatID, task: task)
        }
    }

    private static func preheatOne(_ url: URL) async -> Bool {
        let preheatInterval = MediaPerformance.beginInterval(
            "video_asset_preheated mode=manifest url=\(url.lastPathComponent)"
        )
        guard !Task.isCancelled else {
            MediaPerformance.cancelInterval(preheatInterval, reason: "cancelled")
            return false
        }
        let playbackURL: URL

        if !isHTTPStreamingPlaylist(url) {
            playbackURL = await MediaFileDiskCache.shared.cachedFileURL(for: url) ?? url
        } else {
            playbackURL = url
        }

        let asset = AVURLAsset(url: playbackURL)

        do {
            _ = try await asset.load(.isPlayable)
            _ = try? await asset.load(.duration)
            guard !Task.isCancelled else {
                MediaPerformance.cancelInterval(preheatInterval, reason: "cancelled")
                return false
            }
            MediaPerformance.endInterval(
                preheatInterval,
                event: "video_asset_preheated url=\(url.lastPathComponent)",
                upload: false
            )
            return true
        } catch {
            MediaPerformance.cancelInterval(
                preheatInterval,
                reason: Task.isCancelled ? "cancelled" : "failed"
            )
            MediaPerformance.mark("video_asset_preheat_failed url=\(url.lastPathComponent)")
            return false
        }
    }

    private func finish(_ url: URL, id: UUID, completed: Bool) {
        guard activePreheats[url]?.id == id else {
            return
        }
        activePreheats[url] = nil
        if completed {
            recentlyPreheatedAt[url] = Date()
        }
    }

    private func pruneRecentEntries(now: Date) {
        recentlyPreheatedAt = recentlyPreheatedAt.filter { _, date in
            now.timeIntervalSince(date) < recentPreheatWindow
        }
    }
}

