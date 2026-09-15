import Combine
import CryptoKit
import Foundation
import ImageIO
import SDWebImage
import SDWebImageWebPCoder
import UIKit

enum StoryUploadVisibilityPolicy {
    static func shouldPublishImmediately(moderationStatus: String?) -> Bool {
        moderationStatus == nil ||
            moderationStatus == "approved" ||
            moderationStatus == "pending"
    }
}

enum PendingStoryUploadIDPolicy {
    static func isPending(_ id: String) -> Bool {
        id.hasPrefix("pending-story-")
    }
}

enum PendingStoryMergePolicy {
    static func merge<Item>(
        base: [Item],
        pending: [Item],
        id: (Item) -> String
    ) -> [Item] {
        let pendingIDs = Set(pending.map(id))
        return base.filter { item in
            let itemID = id(item)
            return !PendingStoryUploadIDPolicy.isPending(itemID) &&
                !pendingIDs.contains(itemID)
        } + pending
    }
}

@MainActor
final class StoryUploadCoordinator: ObservableObject {
    @Published private(set) var registrations: [StoryUploadResponse] = []

    private var readinessTasks: [String: Task<Void, Never>] = [:]

    func register(
        _ response: StoryUploadResponse,
        api: APIClient,
        notice: StoryUploadNoticeStore,
        pendingUploads: PendingStoryUploadStore? = nil
    ) {
        StoryUploadDiagnostics.mark("registered", response: response)
        upsertRegistration(response)
        api.invalidateMobileFeedCache()
        preheatUploadThumbnail(response)

        let moderationPending = response.moderationStatus == "pending"
        guard StoryUploadVisibilityPolicy.shouldPublishImmediately(
            moderationStatus: response.moderationStatus
        ) else {
            StoryUploadDiagnostics.mark("under_review", response: response)
            if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
                notice.showPosting()
            } else {
                notice.showReview(reason: response.moderationReason)
            }
            return
        }

        publishRegisteredUpload(response)

        if !moderationPending {
            refreshVisibleStoryState(response, api: api)
        }

        if moderationPending || response.processingStatus != "ready" {
            startReadinessPolling(
                response,
                api: api,
                notice: notice,
                pendingUploads: pendingUploads
            )
            if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
                notice.showPosting()
            } else {
                notice.showProcessing(assetKind: response.asset.assetKind)
            }
        } else if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
            notice.showPosting()
        } else {
            notice.showPosted()
        }
    }

    private func upsertRegistration(_ response: StoryUploadResponse) {
        registrations.removeAll { $0.storyId == response.storyId }
        registrations.append(response)
        if registrations.count > 12 {
            registrations.removeFirst(registrations.count - 12)
        }
    }

    private func preheatUploadThumbnail(_ response: StoryUploadResponse) {
        guard let thumbnailUrl = response.asset.renditions?.playback.thumbnailUrl ?? response.asset.thumbnailUrl else {
            return
        }

        MediaImageCache.shared.preheat([thumbnailUrl], limit: 1)
    }

    private func publishRegisteredUpload(_ response: StoryUploadResponse) {
        Task { @MainActor in
            await Task.yield()
            NotificationCenter.default.post(
                name: .storyUploadDidRegister,
                object: response
            )
        }
    }

    private func refreshVisibleStoryState(_ response: StoryUploadResponse, api: APIClient) {
        api.invalidateStoryStacks(ids: ["my-story", response.storyId])
        api.prefetchStoryStacks(ids: ["my-story", response.storyId], refresh: true, limit: 2)
        NotificationCenter.default.post(name: .storyUploadDidComplete, object: nil)
        StoryUploadDiagnostics.mark("local_visibility_refreshed", response: response)
    }

    private func startReadinessPolling(
        _ response: StoryUploadResponse,
        api: APIClient,
        notice: StoryUploadNoticeStore,
        pendingUploads: PendingStoryUploadStore?
    ) {
        readinessTasks[response.storyId]?.cancel()
        readinessTasks[response.storyId] = Task { @MainActor [weak self, api, notice] in
            StoryUploadDiagnostics.mark("readiness_poll_started", response: response)
            let result = await api.waitForStoryLive(storyId: response.storyId)
            guard !Task.isCancelled else {
                return
            }

            self?.readinessTasks[response.storyId] = nil
            guard result == .live else {
                api.invalidateStoryStacks(ids: ["my-story", response.storyId])
                api.prefetchStoryStacks(ids: ["my-story", response.storyId], refresh: true, limit: 2)
                switch result {
                case .processingFailed:
                    if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
                        notice.showPosting()
                    } else {
                        notice.showFailed(
                            message: "We couldn’t finish preparing this story. Your original upload is safe; please try uploading it again."
                        )
                    }
                    StoryUploadDiagnostics.mark("readiness_poll_failed", response: response)
                case .underReview(let reason):
                    if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
                        notice.showPosting()
                    } else {
                        notice.showReview(reason: reason)
                    }
                    StoryUploadDiagnostics.mark("readiness_poll_under_review", response: response)
                case .rejected(let reason):
                    if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
                        notice.showPosting()
                    } else {
                        notice.showRejected(reason: reason)
                    }
                    StoryUploadDiagnostics.mark("readiness_poll_rejected", response: response)
                case .timedOut:
                    if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
                        notice.showPosting()
                    } else {
                        notice.showDelayed(assetKind: response.asset.assetKind)
                    }
                    StoryUploadDiagnostics.mark("readiness_poll_timeout", response: response)
                case .live:
                    break
                }
                return
            }

            StoryUploadReadinessMeasurements.shared.ready(storyId: response.storyId)
            self?.registrations.removeAll { $0.storyId == response.storyId }
            api.invalidateStoryStacks(ids: ["my-story", response.storyId])
            api.prefetchStoryStacks(ids: ["my-story", response.storyId], refresh: true, limit: 2)
            if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
                notice.showPosting()
            } else {
                notice.showPosted()
            }
            NotificationCenter.default.post(
                name: .storyUploadDidComplete,
                object: response.storyId
            )
            StoryUploadDiagnostics.mark("readiness_poll_live", response: response)
        }
    }
}

enum PendingStoryUploadState: String, Codable, Hashable {
    case queued
    case recovering
    case uploading
    case completing
    case paused
    case failed
}

enum PendingStoryUploadPipeline: String, Codable, Hashable {
    case imageMultipart
    case imageDirectBlob
    case videoTus
}

struct PendingStoryUploadDraft: Codable, Hashable {
    let caption: String
    let brandTags: String
    let textOverlay: String
    let textOverlayPositionX: Double
    let textOverlayPositionY: Double
    let linkLabel: String
    let linkUrl: String
    let linkOverlayPositionX: Double
    let linkOverlayPositionY: Double
    let quoteReplyId: String
    let quoteReplyPositionX: Double
    let quoteReplyPositionY: Double
}

struct PendingStoryUpload: Codable, Hashable, Identifiable {
    let id: String
    let batchId: String?
    var batchPosition: Int?
    var batchCount: Int?
    let assetKind: SocialAssetKind
    let pipeline: PendingStoryUploadPipeline
    var mediaFileURL: URL
    var thumbnailFileURL: URL?
    let fileName: String
    let mimeType: String?
    var durationMs: Int?
    let imageContentMode: StoryImageContentMode?
    let textOverlays: [StoryTextOverlay]
    let draft: PendingStoryUploadDraft
    let createdAt: Date
    var updatedAt: Date
    var state: PendingStoryUploadState
    var progress: Double
    var retryCount: Int
    var errorMessage: String?
    var preparedVideoUpload: VideoUploadResponse?
    var preparedSourceChecksum: String? = nil
    var preparedSourceFingerprint: StoryUploadFileFingerprint? = nil
    var nextRetryAt: Date? = nil
    var estimatedRemainingSeconds: Int? = nil
    var requiresVideoPreparation: Bool? = nil
    var videoSource: StoryVideoUpload.Source? = nil
    var submittedAt: Date? = nil
    var firstBytesReportedAt: Date? = nil
    var transferDurationMs: Int? = nil
    var preuploadedVideoSessionId: String? = nil
    var preuploadedBlobUploadId: String? = nil

    // Only presentation changes should rebuild the local story stack. Checksum,
    // retry bookkeeping and byte-level progress timestamps are not media changes.
    struct Presentation: Equatable {
        let id: String
        let media: URL
        let thumbnail: URL?
        let duration: Int?
        let status: String
    }
    var presentation: Presentation {
        Presentation(id: id, media: mediaFileURL, thumbnail: thumbnailFileURL,
                     duration: durationMs, status: statusLabel)
    }

    var displayProgress: Double {
        min(max(progress, 0), 1)
    }

    var isFailed: Bool {
        state == .failed || state == .paused
    }

    var isRecovering: Bool {
        state == .recovering
    }

    var statusLabel: String {
        switch state {
        case .queued:
            "Preparing"
        case .recovering:
            "Resuming"
        case .uploading:
            estimatedRemainingSeconds.map { "Uploading \(Int((displayProgress * 100).rounded()))% · about \($0)s left" }
                ?? "Uploading \(Int((displayProgress * 100).rounded()))%"
        case .completing:
            "Finishing"
        case .paused:
            "Paused"
        case .failed:
            "Failed"
        }
    }

    var displayErrorMessage: String {
        let message = errorMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return message.isEmpty ? "The video could not be uploaded. Check your connection and try again." : message
    }
}

struct PendingStoryUploadBatchSummary: Equatable {
    let id: String
    let totalCount: Int
    let completedCount: Int
    let failedCount: Int
    let unavailableCount: Int
    let progress: Double
    let uploads: [PendingStoryUpload]
}

struct RecoveredStoryUploadReceipt: Codable {
    let response: StoryUploadResponse
    let completedAt: Date
}

struct LocalImageDerivative {
    let data: Data
    let contentType: String
    let width: Int
    let height: Int

    var byteSize: Int64 {
        Int64(data.count)
    }

    var checksum: String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func metadata(pathname: String) -> PreparedImageDerivativeUpload {
        PreparedImageDerivativeUpload(
            pathname: pathname,
            contentType: contentType,
            byteSize: byteSize,
            checksum: checksum,
            width: width,
            height: height
        )
    }
}

struct LocalImageDerivativeSet {
    let display: LocalImageDerivative
    let thumbnail: LocalImageDerivative
    let thumbHash: String
}

private struct UploadedImageDerivativeSet {
    let display: PreparedImageDerivativeUpload
    let thumbnail: PreparedImageDerivativeUpload
    let thumbHash: String
    let local: LocalImageDerivativeSet
}

struct StoryImagePixelSize: Sendable {
    let width: Int
    let height: Int
}

struct StoryUploadFileFingerprint: Codable, Hashable {
    let byteSize: Int64
    let modificationTime: TimeInterval

    static func read(_ url: URL) async throws -> Self {
        try await Task.detached(priority: .utility) {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard let bytes = attributes[.size] as? NSNumber, bytes.int64Value > 0,
                  let modified = attributes[.modificationDate] as? Date else {
                throw APIClientError.invalidResponse
            }
            return Self(byteSize: bytes.int64Value, modificationTime: modified.timeIntervalSince1970)
        }.value
    }
}

enum StoryUploadFileIO {
    static func stageFile(source: URL, destination: URL) async throws {
        try await Task.detached(priority: .userInitiated) {
            let manager = FileManager.default
            try manager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            do {
                // An interrupted normalization can leave this owned destination
                // beside the still-authoritative raw source.
                if manager.fileExists(atPath: destination.path) { try manager.removeItem(at: destination) }
                do { try manager.linkItem(at: source, to: destination) }
                catch { try manager.copyItem(at: source, to: destination) }
                guard let bytes = try manager.attributesOfItem(atPath: destination.path)[.size] as? NSNumber,
                      bytes.int64Value > 0 else { throw APIClientError.invalidResponse }
            } catch {
                try? manager.removeItem(at: destination)
                throw error
            }
        }.value
    }

    static func stageVideo(
        sourceURL: URL,
        destinationURL: URL,
        thumbnailData: Data,
        thumbnailURL: URL
    ) async throws -> URL {
        try await Task.detached(priority: .userInitiated) {
            let fileManager = FileManager.default
            try fileManager.createDirectory(
                at: destinationURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try? fileManager.removeItem(at: destinationURL)

            do {
                do { try fileManager.linkItem(at: sourceURL, to: destinationURL) }
                catch { try fileManager.copyItem(at: sourceURL, to: destinationURL) }

                guard !thumbnailData.isEmpty else {
                    throw APIClientError.invalidResponse
                }

                try thumbnailData.write(to: thumbnailURL, options: .atomic)
                return thumbnailURL
            } catch {
                try? fileManager.removeItem(at: destinationURL)
                try? fileManager.removeItem(at: thumbnailURL)
                throw error
            }
        }.value
    }

    static func fileSize(at url: URL) async throws -> Int64 {
        try await Task.detached(priority: .utility) {
            guard let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber,
                  size.int64Value > 0 else {
                throw APIClientError.invalidResponse
            }

            return size.int64Value
        }.value
    }

    static func sha256Hex(of data: Data) async -> String {
        await Task.detached(priority: .utility) {
            SHA256.hash(data: data)
                .map { String(format: "%02x", $0) }
                .joined()
        }.value
    }

    static func sha256Hex(at url: URL) async throws -> String {
        try await Task.detached(priority: .utility) {
            let input = try FileHandle(forReadingFrom: url)
            defer {
                try? input.close()
            }

            var hasher = SHA256()
            while true {
                let chunk = try input.read(upToCount: 1024 * 1024) ?? Data()
                if chunk.isEmpty {
                    break
                }
                hasher.update(data: chunk)
            }

            return hasher.finalize()
                .map { String(format: "%02x", $0) }
                .joined()
        }.value
    }

    static func imagePixelSize(of data: Data) async -> StoryImagePixelSize? {
        await Task.detached(priority: .utility) {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                  let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
                  let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
                  width.intValue > 0,
                  height.intValue > 0 else {
                return nil
            }

            let rawOrientation = properties[kCGImagePropertyOrientation] as? NSNumber
            let orientation = rawOrientation
                .flatMap { CGImagePropertyOrientation(rawValue: $0.uint32Value) }
                ?? .up
            let swapsPixelAxes = switch orientation {
            case .left, .leftMirrored, .right, .rightMirrored:
                true
            default:
                false
            }

            return StoryImagePixelSize(
                width: swapsPixelAxes ? height.intValue : width.intValue,
                height: swapsPixelAxes ? width.intValue : height.intValue
            )
        }.value
    }

    static func imagePixelSize(at url: URL) async -> StoryImagePixelSize? {
        await Task.detached(priority: .utility) {
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                  let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
                  let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
                  width.intValue > 0,
                  height.intValue > 0 else {
                return nil
            }

            let rawOrientation = properties[kCGImagePropertyOrientation] as? NSNumber
            let orientation = rawOrientation
                .flatMap { CGImagePropertyOrientation(rawValue: $0.uint32Value) }
                ?? .up
            let swapsPixelAxes = switch orientation {
            case .left, .leftMirrored, .right, .rightMirrored:
                true
            default:
                false
            }

            return StoryImagePixelSize(
                width: swapsPixelAxes ? height.intValue : width.intValue,
                height: swapsPixelAxes ? width.intValue : height.intValue
            )
        }.value
    }

    static func hasFastStartMoov(at url: URL) async throws -> Bool {
        try await Task.detached(priority: .utility) {
            let input = try FileHandle(forReadingFrom: url)
            defer {
                try? input.close()
            }

            let fileSize = try input.seekToEnd()
            var offset: UInt64 = 0
            var sawMediaData = false

            while offset + 8 <= fileSize {
                try input.seek(toOffset: offset)
                guard let header = try input.read(upToCount: 8), header.count == 8 else {
                    return false
                }

                let size32 = header.prefix(4).reduce(UInt32(0)) { value, byte in
                    (value << 8) | UInt32(byte)
                }
                let atomType = String(bytes: header.dropFirst(4), encoding: .ascii)
                var headerSize: UInt64 = 8
                var atomSize = UInt64(size32)

                if size32 == 1 {
                    guard let extendedSize = try input.read(upToCount: 8), extendedSize.count == 8 else {
                        return false
                    }
                    headerSize = 16
                    atomSize = extendedSize.reduce(UInt64(0)) { value, byte in
                        (value << 8) | UInt64(byte)
                    }
                } else if size32 == 0 {
                    atomSize = fileSize - offset
                }

                guard atomSize >= headerSize, atomSize <= fileSize - offset else {
                    return false
                }

                if atomType == "moov" {
                    return !sawMediaData
                }
                if atomType == "mdat" {
                    sawMediaData = true
                }

                offset += atomSize
            }

            return false
        }.value
    }

    static func data(at url: URL?) async -> Data? {
        guard let url else {
            return nil
        }

        return await Task.detached(priority: .utility) {
            try? Data(contentsOf: url, options: .mappedIfSafe)
        }.value
    }

    static func write(_ data: Data, to url: URL) async throws {
        try await Task.detached(priority: .utility) {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: url, options: .atomic)
        }.value
    }

    static func remove(_ urls: Set<URL>) async {
        await Task.detached(priority: .utility) {
            for url in urls {
                try? FileManager.default.removeItem(at: url)
            }
        }.value
    }
}

enum StoryImageDerivativeBuilder {
    static let displayContentMode = StoryImageContentMode.fit
    // Compact cards may crop; full-size playback must preserve the composition.
    static let thumbnailContentMode = StoryImageContentMode.fill

    static func build(fileURL: URL) async throws -> LocalImageDerivativeSet {
        try await Task.detached(priority: .userInitiated) {
            guard let displayImage = StoryImageTranscoder.storyCanvasImage(
                fileURL: fileURL,
                width: StoryImageUpload.playbackCanvasWidth,
                height: StoryImageUpload.playbackCanvasHeight,
                contentMode: displayContentMode
            ),
            let thumbnailImage = StoryImageTranscoder.storyCanvasImage(
                fileURL: fileURL,
                width: StoryImageUpload.thumbnailCanvasWidth,
                height: StoryImageUpload.thumbnailCanvasHeight,
                contentMode: thumbnailContentMode
            ) else {
                throw APIClientError.invalidResponse
            }

            let display: LocalImageDerivative
            if let avif = highestQualityAVIFWithinBudget(
                displayImage,
                qualities: StoryMediaContract.displayAVIFQualityCandidates,
                maxByteSize: StoryMediaContract.maximumImageDisplayDerivativeBytes
            ) {
                display = LocalImageDerivative(
                    data: avif,
                    contentType: "image/avif",
                    width: displayImage.width,
                    height: displayImage.height
                )
            } else if let webp = try highestQualityWebPWithinBudget(
                displayImage,
                qualities: StoryMediaContract.displayWebPQualityCandidates,
                maxByteSize: StoryMediaContract.maximumImageDisplayDerivativeBytes
            ) {
                display = LocalImageDerivative(
                    data: webp,
                    contentType: "image/webp",
                    width: displayImage.width,
                    height: displayImage.height
                )
            } else {
                throw APIClientError.invalidResponse
            }
            guard let thumbnailData = try highestQualityWebPWithinBudget(
                thumbnailImage,
                qualities: StoryMediaContract.thumbnailWebPQualityCandidates,
                maxByteSize: StoryMediaContract.maximumImageThumbnailDerivativeBytes
            ) else {
                throw APIClientError.invalidResponse
            }
            let thumbnail = LocalImageDerivative(
                data: thumbnailData,
                contentType: "image/webp",
                width: thumbnailImage.width,
                height: thumbnailImage.height
            )
            let thumbHash = try encodeThumbHash(thumbnailImage)
            return LocalImageDerivativeSet(
                display: display,
                thumbnail: thumbnail,
                thumbHash: thumbHash
            )
        }.value
    }

    private static func highestQualityAVIFWithinBudget(
        _ image: CGImage,
        qualities: [CGFloat],
        maxByteSize: Int
    ) -> Data? {
        for quality in qualities {
            guard let data = encodeAVIF(image, quality: quality) else {
                return nil
            }

            if data.count <= maxByteSize {
                return data
            }
        }

        return nil
    }

    private static func highestQualityWebPWithinBudget(
        _ image: CGImage,
        qualities: [Double],
        maxByteSize: Int
    ) throws -> Data? {
        for quality in qualities {
            let data = try encodeWebP(image, quality: quality)

            if data.count <= maxByteSize {
                return data
            }
        }

        return nil
    }

    private static func encodeAVIF(_ image: CGImage, quality: CGFloat) -> Data? {
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            "public.avif" as CFString,
            1,
            nil
        ) else {
            return nil
        }
        CGImageDestinationAddImage(
            destination,
            image,
            [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
        )
        guard CGImageDestinationFinalize(destination), output.length > 0 else {
            return nil
        }
        return output as Data
    }

    private static func encodeWebP(_ image: CGImage, quality: Double) throws -> Data {
        guard let data = SDImageWebPCoder.shared.encodedData(
            with: UIImage(cgImage: image),
            format: .webP,
            options: [.encodeCompressionQuality: quality]
        ), !data.isEmpty else {
            throw APIClientError.invalidResponse
        }
        return data
    }

    private static func encodeThumbHash(_ image: CGImage) throws -> String {
        let width = 18
        let height = 32
        var rgba = Data(count: width * height * 4)
        let rendered = rgba.withUnsafeMutableBytes { bytes -> Bool in
            guard let baseAddress = bytes.baseAddress,
                  let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
                  let context = CGContext(
                    data: baseAddress,
                    width: width,
                    height: height,
                    bitsPerComponent: 8,
                    bytesPerRow: width * 4,
                    space: colorSpace,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                  ) else {
                return false
            }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard rendered else {
            throw APIClientError.invalidResponse
        }
        return rgbaToThumbHash(w: width, h: height, rgba: rgba)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

@MainActor
final class PendingStoryUploadStore: ObservableObject {
    static let recoveredCompletionAvailable = Notification.Name("UBEYE.storyUploadRecovered")
    @Published private(set) var uploads: [PendingStoryUpload] = []
    @Published private var batchStates: [String: StoryUploadBatchProgress] = [:]

    private let manifestWriter = StoryUploadManifestWriter()
    private var persistenceTask: Task<Bool, Never>?
    private let fileManager: FileManager
    private let rootURL: URL
    private let filesURL: URL
    private let manifestURL: URL
    private let recoveredReceiptsURL: URL
    private let receiptStore = StoryUploadReceiptStore()
    private let maxVideoDurationSeconds = 120
    private var automaticallyResumedUploadIds = Set<String>()
    private var draftVideoTransfers: [String: StoryDraftVideoTransfer] = [:]
    private let preparationPermits = StoryUploadPermitPool.videoPreparation
    private let videoTransferPermits = StoryUploadPermitPool.videoTransfer
    private let photoTransferPermits = StoryUploadPermitPool(limit: 2)
    private let videoPreparer: (URL, StoryVideoUpload.Source, StoryAdaptiveEncodingContext) async throws -> PreparedStoryVideo

    init(fileManager: FileManager = .default, storageRoot: URL? = nil,
         videoPreparer: ((URL, StoryVideoUpload.Source, StoryAdaptiveEncodingContext) async throws -> PreparedStoryVideo)? = nil) {
        self.videoPreparer = videoPreparer ?? { url, source, context in
            try await StoryVideoUploadNormalizer.prepare(url: url, source: source,
                maxDurationSeconds: StoryMediaContract.maximumVideoDurationSeconds, adaptiveEncoding: context)
        }
        self.fileManager = fileManager
        rootURL = storageRoot ?? fileManager
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("pending-story-uploads", isDirectory: true)
        filesURL = rootURL.appendingPathComponent("files", isDirectory: true)
        manifestURL = rootURL.appendingPathComponent("uploads.json")
        recoveredReceiptsURL = rootURL.appendingPathComponent("recovered-completions.json")
        loadPersistedUploads()
    }

    var visibleUploads: [PendingStoryUpload] {
        uploads.sorted { $0.createdAt < $1.createdAt }
    }

    var latestVisibleUpload: PendingStoryUpload? {
        visibleUploads.last
    }

    var latestBatchSummary: PendingStoryUploadBatchSummary? {
        // A batch remains visible between early completions and the next item
        // being staged. Unstaged items are never inferred to be completed.
        guard let batch = batchStates.values
            .filter({ state in
                !state.preparationFinished || uploads.contains { $0.batchId == state.id }
            })
            .max(by: { $0.createdAt < $1.createdAt }) else { return nil }
        let batchUploads = visibleUploads
            .filter { $0.batchId == batch.id }
            .sorted { ($0.batchPosition ?? Int.max) < ($1.batchPosition ?? Int.max) }
        return PendingStoryUploadBatchSummary(
            id: batch.id,
            totalCount: batch.totalCount,
            completedCount: batch.completedCount,
            failedCount: batchUploads.filter(\.isFailed).count,
            unavailableCount: batch.unavailableCount,
            progress: batch.progress,
            uploads: batchUploads
        )
    }

    func beginBatch(_ batchId: String, totalCount: Int) {
        guard totalCount > 0, batchStates[batchId] == nil else { return }
        batchStates[batchId] = StoryUploadBatchProgress(id: batchId, totalCount: totalCount)
        persist()
    }

    func createImageUpload(
        upload: StoryImageUpload,
        contentMode: StoryImageContentMode,
        draft: PendingStoryUploadDraft,
        textOverlays: [StoryTextOverlay],
        submittedAt: Date? = nil,
        batchId: String? = nil,
        batchPosition: Int? = nil,
        batchCount: Int? = nil
    ) async throws -> PendingStoryUpload {
        try ensureDirectories()
        let id = Self.makePendingId()
        let fileExtension = (upload.fileName as NSString).pathExtension.isEmpty
            ? "jpg"
            : (upload.fileName as NSString).pathExtension
        let mediaURL = filesURL.appendingPathComponent("\(id).\(fileExtension)")
        try await StoryUploadFileIO.write(upload.data, to: mediaURL)

        var pending = PendingStoryUpload(
            id: id,
            batchId: batchId,
            batchPosition: batchPosition,
            batchCount: batchCount,
            assetKind: .image,
            pipeline: .imageDirectBlob,
            mediaFileURL: mediaURL,
            thumbnailFileURL: mediaURL,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            durationMs: nil,
            imageContentMode: contentMode,
            textOverlays: textOverlays,
            draft: draft,
            createdAt: Date(),
            updatedAt: Date(),
            state: .queued,
            progress: 0.05,
            retryCount: 0,
            errorMessage: nil,
            preparedVideoUpload: nil
        )
        pending.submittedAt = submittedAt
        pending.preparedSourceChecksum = upload.sourceChecksum
        do { pending.preparedSourceFingerprint = try await StoryUploadFileFingerprint.read(mediaURL) }
        catch { await StoryUploadFileIO.remove([mediaURL]); throw error }
        guard await upsert(pending).value else {
            remove(id: id)
            throw CocoaError(.fileWriteUnknown)
        }
        guard self.upload(id: id) != nil else { throw CancellationError() }
        MediaImageCache.shared.preheat([mediaURL], limit: 1)
        return pending
    }

    func createVideoUpload(
        sourceURL: URL,
        preparedChecksum: String? = nil,
        thumbnailData: Data,
        durationMs: Int?,
        draft: PendingStoryUploadDraft,
        textOverlays: [StoryTextOverlay],
        batchId: String? = nil,
        batchPosition: Int? = nil,
        batchCount: Int? = nil
    ) async throws -> PendingStoryUpload {
        let id = Self.makePendingId()
        let fileExtension = sourceURL.pathExtension.isEmpty ? "mp4" : sourceURL.pathExtension
        let mediaURL = filesURL.appendingPathComponent("\(id).\(fileExtension)")
        let thumbnailDestinationURL = filesURL.appendingPathComponent("\(id)-thumbnail.jpg")
        let thumbnailURL = try await StoryUploadFileIO.stageVideo(
            sourceURL: sourceURL,
            destinationURL: mediaURL,
            thumbnailData: thumbnailData,
            thumbnailURL: thumbnailDestinationURL
        )

        let pending = PendingStoryUpload(
            id: id,
            batchId: batchId,
            batchPosition: batchPosition,
            batchCount: batchCount,
            assetKind: .video,
            pipeline: .videoTus,
            mediaFileURL: mediaURL,
            thumbnailFileURL: thumbnailURL,
            fileName: sourceURL.lastPathComponent.isEmpty ? "story-video.mp4" : sourceURL.lastPathComponent,
            mimeType: nil,
            durationMs: durationMs,
            imageContentMode: nil,
            textOverlays: textOverlays,
            draft: draft,
            createdAt: Date(),
            updatedAt: Date(),
            state: .queued,
            progress: 0.08,
            retryCount: 0,
            errorMessage: nil,
            preparedVideoUpload: nil
        )
        var verifiedPending = pending
        if let preparedChecksum {
            verifiedPending.preparedSourceChecksum = preparedChecksum
            do { verifiedPending.preparedSourceFingerprint = try await StoryUploadFileFingerprint.read(mediaURL) }
            catch {
                await StoryUploadFileIO.remove([mediaURL, thumbnailURL])
                throw error
            }
        }
        guard await upsert(verifiedPending).value else {
            remove(id: id)
            throw CocoaError(.fileWriteUnknown)
        }
        guard self.upload(id: id) != nil else { throw CancellationError() }
        MediaImageCache.shared.preheat([thumbnailURL].compactMap { $0 }, limit: 1)
        return verifiedPending
    }

    /// Takes ownership before exports, hashing or poster generation. The raw
    /// source and immutable draft survive composer dismissal and process exit.
    func createSubmittedVideoUpload(
        sourceURL: URL, source: StoryVideoUpload.Source,
        preparedVideo: PreparedStoryVideo? = nil,
        draftUpload: StoryDraftVideoUpload? = nil,
        draftTransfer: StoryDraftVideoTransfer? = nil,
        draft: PendingStoryUploadDraft, textOverlays: [StoryTextOverlay],
        submittedAt: Date = Date(), batchId: String? = nil,
        batchPosition: Int? = nil, batchCount: Int? = nil
    ) async throws -> PendingStoryUpload {
        let clientId = draftUpload?.clientUploadId ?? draftTransfer?.clientUploadId
        let id = clientId.map { "pending-story-\($0)" } ?? Self.makePendingId()
        let sourceToStage = preparedVideo?.url ?? sourceURL
        if let draftUpload {
            guard sourceToStage == draftUpload.video.url,
                  try await StoryUploadFileFingerprint.read(sourceToStage) == draftUpload.fingerprint else {
                throw APIClientError.invalidResponse
            }
        }
        if let draftTransfer {
            guard preparedVideo?.url == draftTransfer.video.url,
                  try await StoryUploadFileFingerprint.read(sourceToStage) == draftTransfer.fingerprint else {
                throw APIClientError.invalidResponse
            }
        }
        let destination = filesURL.appendingPathComponent("\(id).\(sourceToStage.pathExtension.isEmpty ? "mp4" : sourceToStage.pathExtension)")
        try await StoryUploadFileIO.stageFile(source: sourceToStage, destination: destination)
        let pending = PendingStoryUpload(
            id: id, batchId: batchId, batchPosition: batchPosition, batchCount: batchCount,
            assetKind: .video, pipeline: .videoTus, mediaFileURL: destination,
            thumbnailFileURL: nil, fileName: sourceToStage.lastPathComponent, mimeType: nil,
            durationMs: preparedVideo?.durationMs, imageContentMode: nil,
            textOverlays: textOverlays, draft: draft, createdAt: Date(), updatedAt: Date(),
            state: .queued, progress: 0.05, retryCount: 0, errorMessage: nil,
            preparedVideoUpload: draftUpload?.upload,
            preparedSourceChecksum: draftUpload?.checksum,
            preparedSourceFingerprint: draftUpload == nil ? nil : try await StoryUploadFileFingerprint.read(destination),
            requiresVideoPreparation: preparedVideo == nil,
            videoSource: source, submittedAt: submittedAt,
            preuploadedVideoSessionId: draftUpload?.upload.uploadSessionId,
            preuploadedBlobUploadId: draftUpload?.blobUploadId
        )
        guard await upsert(pending).value else {
            remove(id: id)
            await StoryUploadFileIO.remove([destination])
            throw CocoaError(.fileWriteUnknown)
        }
        guard self.upload(id: id) != nil else { throw CancellationError() }
        if let draftTransfer {
            draftVideoTransfers[id] = draftTransfer
            draftTransfer.ownership.isSubmitted = true
            draftTransfer.ownership.onProgress = { [weak self] progress in
                self?.update(id: id, state: .uploading, progress: 0.22 + min(max(progress, 0), 1) * 0.68)
            }
            MediaPerformance.mark("video_upload_phase attempt=\(id) phase=draft_handoff bytes=\(draftTransfer.video.byteSize)")
        }
        MediaPerformance.measure("video_upload_phase attempt=\(id) phase=tap_to_staged bytes=\((try? await StoryUploadFileIO.fileSize(at: destination)) ?? 0)", since: submittedAt)
        return pending
    }

    func adoptDraftVideoTransferIfNeeded(id: String, api: APIClient) async throws -> PendingStoryUpload {
        guard let transfer = draftVideoTransfers[id] else {
            guard let pending = upload(id: id) else { throw APIClientError.invalidResponse }
            return pending
        }
        defer {
            draftVideoTransfers[id] = nil
            transfer.ownership.onProgress = nil
            Task { await StoryUploadFileIO.remove([transfer.video.url]) }
        }
        guard api.authToken == transfer.account, api.baseURLString == transfer.origin else {
            transfer.task.cancel()
            _ = try? await transfer.task.value
            throw CancellationError()
        }
        let result: StoryDraftVideoUpload
        do { result = try await transfer.task.value }
        catch {
            // The staged source and UUID remain authoritative. Normal TUS recovery
            // can resume the same partial lease after a path change or interruption.
            try Task.checkCancellation()
            guard api.authToken == transfer.account, api.baseURLString == transfer.origin,
                  let pending = upload(id: id) else { throw CancellationError() }
            return pending
        }
        try Task.checkCancellation()
        guard api.authToken == transfer.account, api.baseURLString == transfer.origin,
              let index = uploads.firstIndex(where: { $0.id == id }),
              result.clientUploadId == Self.clientUploadId(for: id),
              try await StoryUploadFileFingerprint.read(uploads[index].mediaFileURL) == transfer.fingerprint,
              try await StoryUploadFileIO.sha256Hex(at: uploads[index].mediaFileURL) == result.checksum else {
            throw APIClientError.invalidResponse
        }
        let previous = uploads[index]
        uploads[index].preparedVideoUpload = result.upload
        uploads[index].preparedSourceChecksum = result.checksum
        uploads[index].preparedSourceFingerprint = try await StoryUploadFileFingerprint.read(previous.mediaFileURL)
        uploads[index].preuploadedVideoSessionId = result.upload.uploadSessionId
        uploads[index].preuploadedBlobUploadId = result.blobUploadId
        uploads[index].updatedAt = Date()
        let adopted = uploads[index]
        guard await persist().value else {
            if let current = uploads.firstIndex(where: { $0.id == id }) { uploads[current] = previous; persist() }
            throw CocoaError(.fileWriteUnknown)
        }
        guard self.upload(id: id) != nil else { throw CancellationError() }
        MediaPerformance.mark("video_upload_phase attempt=\(id) phase=draft_adopted bytes=\(transfer.video.byteSize)")
        return adopted
    }

    func prepareVideoIfNeeded(id: String) async throws -> PendingStoryUpload {
        try await preparationPermits.acquire()
        defer { preparationPermits.release() }
        guard let original = upload(id: id) else { throw APIClientError.invalidResponse }
        guard original.requiresVideoPreparation == true else { return original }
        let startedAt = Date()
        let prepared = try await videoPreparer(original.mediaFileURL, original.videoSource ?? .library,
                                               StoryAdaptiveEncodingContext.current())
        let destination: URL
        if prepared.url == original.mediaFileURL { destination = original.mediaFileURL }
        else {
            destination = filesURL.appendingPathComponent("\(id)-prepared.\(prepared.url.pathExtension.isEmpty ? "mp4" : prepared.url.pathExtension)")
            do { try await StoryUploadFileIO.stageFile(source: prepared.url, destination: destination) }
            catch { await StoryUploadFileIO.remove([prepared.url]); throw error }
            await StoryUploadFileIO.remove([prepared.url])
        }
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            if destination != original.mediaFileURL { await StoryUploadFileIO.remove([destination]) }
            throw CancellationError()
        }
        uploads[index].mediaFileURL = destination
        uploads[index].durationMs = prepared.durationMs
        uploads[index].requiresVideoPreparation = false
        uploads[index].preparedSourceChecksum = nil
        uploads[index].preparedSourceFingerprint = nil
        uploads[index].updatedAt = Date()
        let result = uploads[index]
        guard await persist().value else {
            if let current = uploads.firstIndex(where: { $0.id == id }) { uploads[current] = original; persist() }
            if destination != original.mediaFileURL { await StoryUploadFileIO.remove([destination]) }
            throw CocoaError(.fileWriteUnknown)
        }
        guard self.upload(id: id)?.mediaFileURL == destination else { throw CancellationError() }
        // Delete the raw pathname only after its replacement is in the manifest.
        if destination != original.mediaFileURL { await StoryUploadFileIO.remove([original.mediaFileURL]) }
        MediaPerformance.measure("video_upload_phase attempt=\(id) phase=local_prepare bytes=\(prepared.byteSize) strategy=\(prepared.strategy.rawValue)", since: startedAt)
        return result
    }

    private var activeUploadIDs = Set<String>()
    private var recoveryInProgress = false
    private var recoveryTask: Task<Void, Never>?
    private var lastProgressPersistAt = Date.distantPast

    func performUpload(
        id: String,
        api: APIClient,
        onVideoUploadPrepared: ((VideoUploadResponse) -> Void)? = nil,
        onVideoRetry: ((String) -> Void)? = nil,
        onVideoPhase: ((StoryVideoUploadPhase) -> Void)? = nil,
        beforeCompletion: (() async throws -> Void)? = nil
    ) async throws -> StoryUploadResponse {
        guard var upload = uploads.first(where: { $0.id == id }) else {
            throw APIClientError.invalidResponse
        }

        guard activeUploadIDs.insert(id).inserted else {
            throw APIClientError.server("This upload is already in progress.", 409)
        }
        let priorityToken = StoryUploadPriority.shared.begin()
        let backgroundTask = StoryUploadBackgroundTask(name: "story-upload-\(id)")
        defer {
            backgroundTask.end()
            activeUploadIDs.remove(id)
            scheduleRecovery(api: api)
            StoryUploadPriority.shared.end(priorityToken)
        }

        do {
            if upload.assetKind == .video {
                upload = try await adoptDraftVideoTransferIfNeeded(id: id, api: api)
                upload = try await prepareVideoIfNeeded(id: id)
            }
            let response: StoryUploadResponse
            switch upload.pipeline {
            case .imageMultipart:
                response = try await uploadImage(upload, api: api)
            case .imageDirectBlob:
                response = try await uploadDirectImage(upload, api: api, beforeCompletion: beforeCompletion)
            case .videoTus:
                response = try await uploadVideo(
                    upload,
                    api: api,
                    onPrepared: onVideoUploadPrepared,
                    onRetry: onVideoRetry,
                    onPhase: onVideoPhase
                )
            }

            upload = self.upload(id: id) ?? upload
            let kind = upload.assetKind == .image ? "image" : "video"
            let submittedAt = upload.submittedAt ?? upload.createdAt
            let bytes = (try? await StoryUploadFileIO.fileSize(at: upload.mediaFileURL)) ?? 0
            MediaPerformance.measure("\(kind)_upload_phase attempt=\(id) phase=tap_to_accepted bytes=\(bytes)", since: submittedAt)
            if kind == "video" {
                let mbps = upload.retryCount == 0 ? upload.transferDurationMs.map { Double(bytes) * 8 / Double(max($0, 1)) / 1000 } : nil
                let mbpsText = mbps.map { String(format: "%.2f", $0) } ?? "unknown"
                MediaPerformance.measure("video_upload_succeeded attempt=\(id) bytes=\(bytes) retries=\(upload.retryCount) protocol=\(upload.preparedVideoUpload?.uploadProtocol ?? "unknown") effective_mbps=\(mbpsText)", since: submittedAt)
            }
            StoryUploadReadinessMeasurements.shared.accept(storyId: response.storyId,
                attempt: id, kind: upload.assetKind, submittedAt: submittedAt, bytes: bytes,
                alreadyReady: response.processingStatus == "ready" && response.moderationStatus != "pending"
                    && StoryUploadVisibilityPolicy.shouldPublishImmediately(moderationStatus: response.moderationStatus))
            MediaPerformance.flushUploadEvents()
            await cacheUploadedMedia(upload, response: response)
            reconcile(id: id)
            return response
        } catch {
            if upload.assetKind == .video {
                MediaPerformance.measure("video_upload_failed attempt=\(id) bytes=\((try? await StoryUploadFileIO.fileSize(at: upload.mediaFileURL)) ?? 0) reason=\(StoryVideoUploadAttempt.sanitizedDiagnostic(error.localizedDescription))", since: upload.submittedAt ?? upload.createdAt)
                MediaPerformance.flushUploadEvents()
            }
            markFailed(id: id, error: error)
            throw error
        }
    }

    func retry(id: String, api: APIClient) async throws -> StoryUploadResponse {
        guard !activeUploadIDs.contains(id) else { throw APIClientError.server("This upload is already in progress.", 409) }
        if let index = uploads.firstIndex(where: { $0.id == id }) { uploads[index].nextRetryAt = nil }
        automaticallyResumedUploadIds.remove(id)
        update(id: id, state: .queued, progress: 0.04, errorMessage: nil, incrementsRetry: true)
        return try await performUpload(id: id, api: api)
    }

    func resumeInterruptedUploads(api: APIClient) async -> [StoryUploadResponse] {
        guard !recoveryInProgress, NetworkQualityMonitor.shared.isConnected else { return [] }
        recoveryInProgress = true
        defer { recoveryInProgress = false; scheduleRecovery(api: api) }
        await BackgroundTusUploadTransport.shared.prepareForRecovery()
        let interrupted = uploads.filter {
            ($0.state == .recovering ||
                $0.state == .paused ||
                ($0.state == .failed && $0.errorMessage?.hasPrefix("Upload interrupted.") == true)) &&
            !activeUploadIDs.contains($0.id) && ($0.nextRetryAt ?? .distantPast) <= Date() &&
            !$0.mediaFileURL.path.isEmpty &&
            automaticallyResumedUploadIds.insert($0.id).inserted
        }
        var responses: [StoryUploadResponse] = []

        for upload in interrupted {
            update(
                id: upload.id,
                state: .recovering,
                progress: upload.displayProgress,
                errorMessage: nil,
                incrementsRetry: true
            )
            do {
                let response = try await performUpload(id: upload.id, api: api)
                responses.append(response)
                await recordRecoveredCompletion(response)
            } catch {
                automaticallyResumedUploadIds.remove(upload.id)
                // performUpload already classifies and persists the failure. A
                // rejected/invalid upload must never become an automatic retry.
                MediaPerformance.mark("background_upload_resume id=\(upload.id) result=failed")
            }
        }

        return responses
    }

    func waitForActiveUploadsToSettle() async {
        for _ in 0..<100 {
            let hasActiveUpload = uploads.contains {
                $0.state == .recovering || $0.state == .uploading || $0.state == .completing
            }
            guard hasActiveUpload else {
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
    }

    func takeRecoveredCompletions() async -> [StoryUploadResponse] {
        await receiptStore.take(from: recoveredReceiptsURL)
    }

    func remove(id: String) {
        Task { await BackgroundTusUploadTransport.shared.cancelTransfer(attemptID: id) }
        guard let upload = uploads.first(where: { $0.id == id }) else {
            return
        }

        if let transfer = draftVideoTransfers.removeValue(forKey: id) {
            transfer.ownership.onProgress = nil
            transfer.task.cancel()
            Task { _ = try? await transfer.task.value; await StoryUploadFileIO.remove([transfer.video.url]) }
        }
        if let batchId = upload.batchId { batchStates[batchId]?.remove(upload.id) }
        removeFiles(for: upload)
        automaticallyResumedUploadIds.remove(id)
        uploads.removeAll { $0.id == id }
        persist()
    }

    func upload(id: String) -> PendingStoryUpload? {
        uploads.first { $0.id == id }
    }

    func finishBatchPreparation(_ batchId: String) {
        // Positions and the selected total stay fixed after transfers start.
        batchStates[batchId]?.preparationFinished = true
        persist()
    }

    func feedByMergingPendingUploads(into feed: MobileFeedResponse) -> MobileFeedResponse {
        let pendingCards = visibleUploads.map { upload in
            storyCard(for: upload, owner: feed.myStory.owner)
        }

        guard !pendingCards.isEmpty else {
            return feed
        }

        let mergedItems = PendingStoryMergePolicy.merge(
            base: feed.myStory.items,
            pending: pendingCards,
            id: \StoryCard.id
        )
        let latestItem = mergedItems.last
        let latestThumbnailUrl = latestItem?.cardThumbnailUrl
        let myStory = MyStorySummary(
            owner: feed.myStory.owner,
            hasActiveStory: true,
            liveCount: max(feed.myStory.liveCount, mergedItems.count),
            latestThumbnailUrl: latestThumbnailUrl,
            latestAssetKind: latestItem?.assetKind,
            latestTextOverlays: latestItem?.textOverlays ?? [],
            expiresSoonLabel: feed.myStory.expiresSoonLabel,
            items: mergedItems
        )

        return MobileFeedResponse(
            ok: feed.ok,
            session: feed.session,
            followingProfiles: feed.followingProfiles,
            followingStories: feed.followingStories,
            followingTimelineStories: feed.followingTimelineStories,
            nextCursor: feed.nextCursor,
            discoverTiles: feed.discoverTiles,
            initialStoryStacks: feed.initialStoryStacks,
            suggestedAccounts: feed.suggestedAccounts,
            myStory: myStory
        )
    }

    func storyStackByMergingPendingUploads(
        into stack: StoryStack?,
        account: MobileAccount?
    ) -> StoryStack? {
        guard stack != nil || !visibleUploads.isEmpty else {
            return nil
        }

        let base = stack ?? StoryStack(
            id: "my-story",
            creatorId: account?.email ?? "me",
            creator: account?.displayName ?? "My Story",
            handle: account?.handle ?? "",
            avatarUrl: account?.avatarUrl,
            items: []
        )
        let pendingItems = visibleUploads.map(stackItem(for:))
        let mergedItems = PendingStoryMergePolicy.merge(
            base: base.items,
            pending: pendingItems,
            id: \StoryStackItem.id
        )

        return StoryStack(
            id: base.id,
            creatorId: base.creatorId,
            creator: base.creator,
            handle: base.handle,
            avatarUrl: base.avatarUrl,
            items: mergedItems
        )
    }

    static func isPendingStoryId(_ id: String) -> Bool {
        PendingStoryUploadIDPolicy.isPending(id)
    }

    private func uploadImage(_ upload: PendingStoryUpload, api: APIClient) async throws -> StoryUploadResponse {
        update(id: upload.id, state: .uploading, progress: 0.18)
        guard let imageUpload = await StoryImageUpload.prepare(
            fileURL: upload.mediaFileURL,
            fallbackFileName: upload.fileName
        ) else {
            throw APIClientError.invalidResponse
        }

        let response = try await api.uploadImageStory(
            upload: imageUpload,
            caption: upload.draft.caption,
            brandTags: upload.draft.brandTags,
            textOverlay: upload.draft.textOverlay,
            textOverlayPositionX: upload.draft.textOverlayPositionX,
            textOverlayPositionY: upload.draft.textOverlayPositionY,
            linkLabel: upload.draft.linkLabel,
            linkUrl: upload.draft.linkUrl,
            linkOverlayPositionX: upload.draft.linkOverlayPositionX,
            linkOverlayPositionY: upload.draft.linkOverlayPositionY,
            quoteReplyId: upload.draft.quoteReplyId,
            quoteReplyPositionX: upload.draft.quoteReplyPositionX,
            quoteReplyPositionY: upload.draft.quoteReplyPositionY
        )
        update(id: upload.id, state: .completing, progress: 1)
        return response
    }

    private func uploadDirectImage(_ upload: PendingStoryUpload, api: APIClient,
                                   beforeCompletion: (() async throws -> Void)? = nil) async throws -> StoryUploadResponse {
        try await photoTransferPermits.acquire()
        var holdsTransferPermit = true
        defer { if holdsTransferPermit { photoTransferPermits.release() } }
        let startedAt = Date()
        var phase = "prepare"
        do {
            update(id: upload.id, state: .uploading, progress: 0.12)
            let byteSize = try fileSize(upload.mediaFileURL)
            let prepareStartedAt = Date()
            let preparedUpload = try await api.prepareImageStoryUpload(
                fileName: upload.fileName.isEmpty ? "story-photo.jpg" : upload.fileName,
                contentType: upload.mimeType ?? "image/jpeg",
                byteSize: byteSize,
                displayContentType: "image/avif"
            )
            let provider = preparedUpload.storageProvider ?? "vercel-blob"
            MediaPerformance.measure(
                "image_upload_phase attempt=\(upload.id) phase=prepare bytes=\(byteSize) provider=\(provider)",
                since: prepareStartedAt
            )
            guard let sourcePart = preparedUpload.source,
                  byteSize <= sourcePart.maxSizeBytes else {
                throw APIClientError.invalidResponse
            }

            phase = "source_upload"
            update(id: upload.id, state: .uploading, progress: 0.30)
            let transferStartedAt = Date()
            async let uploadResult = api.uploadImageFile(
                upload.mediaFileURL,
                byteSize: byteSize,
                part: sourcePart,
                onFirstBytesSent: { [weak self] in
                    Task { @MainActor in self?.recordFirstBytes(id: upload.id) }
                }
            )
            async let checksum = verifiedSourceChecksum(for: upload)
            async let pixelSize = StoryUploadFileIO.imagePixelSize(at: upload.mediaFileURL)
            let (_, resolvedChecksum, resolvedPixelSize) = try await (
                uploadResult,
                checksum,
                pixelSize
            )
            let transferDurationMs = max(
                Int(Date().timeIntervalSince(transferStartedAt) * 1_000),
                1
            )
            let effectiveMbps = Double(byteSize) * 8 / Double(transferDurationMs) / 1_000
            let effectiveMbpsText = String(format: "%.2f", effectiveMbps)
            MediaPerformance.measure(
                "image_upload_phase attempt=\(upload.id) phase=source_upload bytes=\(byteSize) provider=\(provider) effective_mbps=\(effectiveMbpsText)",
                since: transferStartedAt
            )
            update(id: upload.id, state: .uploading, progress: 0.88)

            let sourceUpload = PreparedImageDerivativeUpload(
                pathname: sourcePart.pathname,
                contentType: sourcePart.contentType,
                byteSize: byteSize,
                checksum: resolvedChecksum,
                width: resolvedPixelSize?.width,
                height: resolvedPixelSize?.height
            )

            phase = "complete"
            photoTransferPermits.release()
            holdsTransferPermit = false
            try await beforeCompletion?()
            let completionStartedAt = Date()
            let response = try await api.completeImageStory(
                upload: preparedUpload,
                sourceUpload: sourceUpload,
                contentMode: upload.imageContentMode ?? .fill,
                caption: upload.draft.caption,
                brandTags: upload.draft.brandTags,
                textOverlay: upload.draft.textOverlay,
                textOverlayPositionX: upload.draft.textOverlayPositionX,
                textOverlayPositionY: upload.draft.textOverlayPositionY,
                linkLabel: upload.draft.linkLabel,
                linkUrl: upload.draft.linkUrl,
                linkOverlayPositionX: upload.draft.linkOverlayPositionX,
                linkOverlayPositionY: upload.draft.linkOverlayPositionY,
                quoteReplyId: upload.draft.quoteReplyId,
                quoteReplyPositionX: upload.draft.quoteReplyPositionX,
                quoteReplyPositionY: upload.draft.quoteReplyPositionY
            )
            MediaPerformance.measure(
                "image_upload_phase attempt=\(upload.id) phase=complete bytes=\(byteSize) provider=\(provider)",
                since: completionStartedAt
            )
            MediaPerformance.measure(
                "image_upload_succeeded attempt=\(upload.id) bytes=\(byteSize) provider=\(provider) effective_mbps=\(effectiveMbpsText)",
                since: startedAt
            )
            MediaPerformance.flushUploadEvents()
            update(id: upload.id, state: .completing, progress: 1)
            return response
        } catch {
            MediaPerformance.measure(
                "image_upload_failed phase=\(phase) reason=\(StoryVideoUploadAttempt.sanitizedDiagnostic(error.localizedDescription))",
                since: startedAt
            )
            MediaPerformance.flushUploadEvents()
            throw error
        }
    }

    private func uploadVideo(
        _ upload: PendingStoryUpload,
        api: APIClient,
        onPrepared: ((VideoUploadResponse) -> Void)? = nil,
        onRetry: ((String) -> Void)? = nil,
        onPhase: ((StoryVideoUploadPhase) -> Void)? = nil
    ) async throws -> StoryUploadResponse {
        try await videoTransferPermits.acquire()
        defer { videoTransferPermits.release() }
        update(id: upload.id, state: .uploading, progress: 0.12)
        // Only submitted, durably staged files acquire a lease. Overlap its
        // authorization with local streamability verification; no bytes are
        // transferred until verification succeeds.
        async let hasFastStart = StoryUploadFileIO.hasFastStartMoov(at: upload.mediaFileURL)
        let byteSize = try await StoryUploadFileIO.fileSize(at: upload.mediaFileURL)
        let preparedUploadInitial = try await prepareVideoUpload(
            upload,
            byteSize: byteSize,
            replacing: nil,
            api: api
        )
        guard try await hasFastStart else {
            throw APIClientError.server(
                "This video is not optimized for streaming. Export it again and retry.",
                400
            )
        }
        var preparedUpload = preparedUploadInitial
        if let resumableUpload = upload.preparedVideoUpload,
           resumableUpload.supportsDirectVideoUpload {
            MediaPerformance.mark("pending_video_upload_resume uid=\(resumableUpload.uid)")
        }
        onPrepared?(preparedUpload)

        for leaseAttempt in 0..<2 {
            do {
                if preparedUpload.poster != nil {
                    onPhase?(.thumbnailUpload)
                    update(id: upload.id, state: .uploading, progress: 0.18)
                }

                onPhase?(.videoUpload)
                update(id: upload.id, state: .uploading, progress: 0.22)
                let uploadTarget = preparedUpload
                let posterPart = uploadTarget.poster
                let uploadUid = uploadTarget.uid
                async let uploadedPoster: PreparedImageDerivativeUpload? = prepareAndUploadVideoPoster(
                    upload: upload, part: posterPart, uploadUid: uploadUid, api: api
                )
                async let sourceChecksum = verifiedSourceChecksum(for: upload)
                let networkClass = NetworkQualityMonitor.shared.telemetryNetworkClass
                let adaptiveChunks = MediaControlConfig.shared.adaptiveUploadChunksEnabled
                let configuredLimit = Int64(MediaControlConfig.shared.uploadChunkBytes)
                let maximum = NetworkQualityMonitor.shared.isConstrained ? min(configuredLimit, 5 * 1024 * 1024)
                    : NetworkQualityMonitor.shared.isLimitedPath ? min(configuredLimit, 20 * 1024 * 1024) : configuredLimit
                let controller = AdaptiveTusChunkController(
                    maximum: adaptiveChunks ? maximum : videoUploadChunkBytes(),
                    initial: adaptiveChunks ? StoryUploadInitialChunkPolicy.bytes(maximum: maximum,
                        measuredBitsPerSecond: StoryUploadMeasurements.shared.estimate(network: networkClass))
                        : videoUploadChunkBytes(), enabled: adaptiveChunks,
                    onAccepted: { bytes, seconds in
                        Task { @MainActor in
                            if NetworkQualityMonitor.shared.telemetryNetworkClass == networkClass {
                                StoryUploadMeasurements.shared.record(bytes: bytes, seconds: seconds, network: networkClass)
                            }
                            MediaPerformance.measure("video_upload_chunk attempt=\(upload.id) bytes=\(bytes) network_class=\(networkClass)", since: Date().addingTimeInterval(-seconds))
                        }
                    }
                )
                async let videoUpload = transferVideoFile(
                    attemptId: upload.id,
                    api: api,
                    fileURL: upload.mediaFileURL,
                    upload: uploadTarget,
                    onRetry: { reason in
                        _ = Task { @MainActor [weak self] in
                            self?.recordRetry(id: upload.id, reason: reason)
                            onRetry?(reason)
                        }
                    },
                    maxChunkBytes: videoUploadChunkBytes(),
                    chunkController: controller,
                    onFirstBytesSent: { [weak self] in
                        Task { @MainActor in self?.recordFirstBytes(id: upload.id) }
                    },
                    onProgress: { progress in
                        _ = Task { @MainActor [weak self] in
                            let rate = StoryUploadMeasurements.shared.estimate(network: networkClass)
                            let remaining = rate.map { Int(ceil(Double(byteSize) * (1 - min(max(progress, 0), 1)) * 8 / $0)) }
                            self?.update(
                                id: upload.id,
                                state: .uploading,
                                progress: 0.22 + min(max(progress, 0), 1) * 0.68,
                                estimatedRemainingSeconds: remaining
                            )
                        }
                    }
                )
                let (blobUploadId, checksum, poster) = try await (
                    videoUpload,
                    sourceChecksum,
                    uploadedPoster
                )

                onPhase?(.completeStory)
                let completionStartedAt = Date()
                update(id: upload.id, state: .completing, progress: 0.94)
                let response = try await api.completeVideoStory(
                    upload: preparedUpload,
                    fileURL: upload.mediaFileURL,
                    checksum: checksum,
                    uploadId: blobUploadId,
                    poster: poster,
                    caption: upload.draft.caption,
                    brandTags: upload.draft.brandTags,
                    textOverlay: upload.draft.textOverlay,
                    textOverlayPositionX: upload.draft.textOverlayPositionX,
                    textOverlayPositionY: upload.draft.textOverlayPositionY,
                    linkLabel: upload.draft.linkLabel,
                    linkUrl: upload.draft.linkUrl,
                    linkOverlayPositionX: upload.draft.linkOverlayPositionX,
                    linkOverlayPositionY: upload.draft.linkOverlayPositionY,
                    quoteReplyId: upload.draft.quoteReplyId,
                    quoteReplyPositionX: upload.draft.quoteReplyPositionX,
                    quoteReplyPositionY: upload.draft.quoteReplyPositionY,
                    durationMs: upload.durationMs,
                    draftSubmittedAt: upload.preuploadedVideoSessionId == nil ? nil : upload.submittedAt
                )
                MediaPerformance.measure("video_upload_phase attempt=\(upload.id) phase=complete bytes=\(byteSize)", since: completionStartedAt)
                update(id: upload.id, state: .completing, progress: 1)
                return response
            } catch {
                let statusCode = (error as? APIClientError)?.statusCode
                let sessionIsTerminal = statusCode.map { [403, 404, 410].contains($0) } == true
                guard leaseAttempt == 0, sessionIsTerminal else {
                    if sessionIsTerminal {
                        try await setPreparedVideoUpload(id: upload.id, preparedUpload: nil)
                    }
                    throw error
                }

                let failedSessionId = preparedUpload.uploadSessionId
                update(id: upload.id, state: .recovering, progress: 0.12)
                recordRetry(id: upload.id, reason: "replace_upload_session")
                onRetry?("replace_upload_session")
                try await setPreparedVideoUpload(id: upload.id, preparedUpload: nil)
                preparedUpload = try await prepareVideoUpload(
                    upload,
                    byteSize: byteSize,
                    replacing: failedSessionId,
                    api: api
                )
                onPrepared?(preparedUpload)
            }
        }

        throw APIClientError.server("Could not resume this video upload.", 0)
    }

    private func transferVideoFile(attemptId: String, api: APIClient, fileURL: URL,
                                   upload: VideoUploadResponse, onRetry: ((String) -> Void)?,
                                   maxChunkBytes: Int64, chunkController: AdaptiveTusChunkController,
                                   onFirstBytesSent: (@Sendable () -> Void)?, onProgress: ((Double) -> Void)?) async throws -> String? {
        let startedAt = Date()
        if let pending = self.upload(id: attemptId),
           let preuploadedSession = pending.preuploadedVideoSessionId,
           preuploadedSession == upload.uploadSessionId,
           let fingerprint = pending.preparedSourceFingerprint,
           try await StoryUploadFileFingerprint.read(fileURL) == fingerprint {
            MediaPerformance.mark("video_upload_draft_reused attempt=\(attemptId)")
            return pending.preuploadedBlobUploadId
        }
        let result = try await api.uploadVideoFile(fileURL: fileURL, upload: upload, onRetry: onRetry,
            maxChunkBytes: maxChunkBytes, chunkController: chunkController,
            attemptId: attemptId,
            onFirstBytesSent: onFirstBytesSent, onProgress: onProgress)
        let duration = max(Int(Date().timeIntervalSince(startedAt) * 1000), 1)
        if let index = uploads.firstIndex(where: { $0.id == attemptId }) { uploads[index].transferDurationMs = duration }
        let bytes = (try? await StoryUploadFileIO.fileSize(at: fileURL)) ?? 0
        MediaPerformance.measure("video_upload_phase attempt=\(attemptId) phase=transfer bytes=\(bytes)", since: startedAt)
        return result
    }

    private func recordFirstBytes(id: String) {
        guard let index = uploads.firstIndex(where: { $0.id == id }),
              uploads[index].firstBytesReportedAt == nil else { return }
        uploads[index].firstBytesReportedAt = Date()
        let upload = uploads[index]
        let kind = upload.assetKind == .image ? "image" : "video"
        let bytes = upload.preparedSourceFingerprint?.byteSize ?? (try? fileSize(upload.mediaFileURL)) ?? 0
        MediaPerformance.measure("\(kind)_upload_phase attempt=\(id) phase=tap_to_first_bytes bytes=\(bytes)", since: upload.submittedAt ?? upload.createdAt)
        persist()
    }

    private func prepareAndUploadVideoPoster(upload: PendingStoryUpload, part: ImageUploadPart?,
                                             uploadUid: String, api: APIClient) async throws -> PreparedImageDerivativeUpload? {
        guard part != nil else { return nil }
        let fileURL = try await ensureVideoPoster(for: upload)
        return try await uploadVideoPoster(fileURL: fileURL, part: part, uploadUid: uploadUid, api: api)
    }

    private func ensureVideoPoster(for upload: PendingStoryUpload) async throws -> URL {
        if let url = upload.thumbnailFileURL, fileManager.fileExists(atPath: url.path) { return url }
        let url = filesURL.appendingPathComponent("\(upload.id)-thumbnail.jpg")
        let startedAt = Date()
        let data = try await StoryVideoThumbnailGenerator.posterData(for: upload.mediaFileURL)
        try await StoryUploadFileIO.write(data, to: url)
        guard let index = uploads.firstIndex(where: { $0.id == upload.id }) else {
            await StoryUploadFileIO.remove([url]); throw CancellationError()
        }
        uploads[index].thumbnailFileURL = url
        guard await persist().value else { throw CocoaError(.fileWriteUnknown) }
        guard uploads.first(where: { $0.id == upload.id })?.thumbnailFileURL == url else {
            throw CancellationError()
        }
        MediaPerformance.measure("video_upload_phase attempt=\(upload.id) phase=poster_generate", since: startedAt)
        return url
    }

    private func uploadVideoPoster(
        fileURL: URL?,
        part: ImageUploadPart?,
        uploadUid: String,
        api: APIClient
    ) async throws -> PreparedImageDerivativeUpload? {
        guard let part else {
            return nil
        }
        guard let fileURL,
              let data = await StoryUploadFileIO.data(at: fileURL),
              !data.isEmpty,
              Int64(data.count) <= part.maxSizeBytes else {
            throw APIClientError.server(
                "Could not prepare the video poster. Try a different video.",
                400
            )
        }

        let startedAt = Date()
        MediaPerformance.mark("pending_video_poster_upload_started uid=\(uploadUid)")
        async let pixelSize = StoryUploadFileIO.imagePixelSize(of: data)
        async let checksum = StoryUploadFileIO.sha256Hex(of: data)
        async let uploadResult = api.uploadImageData(data, part: part)
        let (resolvedPixelSize, resolvedChecksum, _) = try await (
            pixelSize,
            checksum,
            uploadResult
        )
        guard let resolvedPixelSize else {
            throw APIClientError.server(
                "Could not read the video poster dimensions.",
                400
            )
        }
        let provider = part.provider ?? "vercel-blob"
        MediaPerformance.measure(
            "video_upload_phase phase=poster_upload uid=\(uploadUid) bytes=\(data.count) provider=\(provider)",
            since: startedAt
        )
        MediaPerformance.mark("pending_video_poster_upload_succeeded uid=\(uploadUid)")
        return PreparedImageDerivativeUpload(
            pathname: part.pathname,
            contentType: part.contentType,
            byteSize: Int64(data.count),
            checksum: resolvedChecksum,
            width: resolvedPixelSize.width,
            height: resolvedPixelSize.height
        )
    }

    private func verifiedSourceChecksum(for upload: PendingStoryUpload) async throws -> String {
        if let checksum = upload.preparedSourceChecksum,
           let fingerprint = upload.preparedSourceFingerprint,
           try await StoryUploadFileFingerprint.read(upload.mediaFileURL) == fingerprint {
            return checksum
        }
        let fingerprint = try await StoryUploadFileFingerprint.read(upload.mediaFileURL)
        let checksum = try await StoryUploadFileIO.sha256Hex(at: upload.mediaFileURL)
        guard try await StoryUploadFileFingerprint.read(upload.mediaFileURL) == fingerprint else {
            throw APIClientError.server("The submitted media changed during upload. Please try again.", 400)
        }
        if let index = uploads.firstIndex(where: { $0.id == upload.id && $0.mediaFileURL == upload.mediaFileURL }) {
            uploads[index].preparedSourceChecksum = checksum
            uploads[index].preparedSourceFingerprint = fingerprint
            persist()
        }
        return checksum
    }

    private func videoUploadChunkBytes() -> Int64 {
        let configured = Int64(MediaControlConfig.shared.uploadChunkBytes)
        return NetworkQualityMonitor.shared.isLimitedPath
            ? min(configured, TusUploadChunkPolicy.minimum)
            : configured
    }

    private func prepareVideoUpload(
        _ upload: PendingStoryUpload,
        byteSize: Int64,
        replacing uploadSessionId: String?,
        api: APIClient
    ) async throws -> VideoUploadResponse {
        let prepareStartedAt = Date()
        let preparedUpload = try await api.prepareVideoUpload(
            fileName: upload.fileName.isEmpty ? "story-video.mp4" : upload.fileName,
            byteSize: byteSize,
            maxDurationSeconds: maxVideoDurationSeconds,
            clientUploadId: Self.clientUploadId(for: upload.id),
            replaceUploadSessionId: uploadSessionId
        )

        guard preparedUpload.supportsDirectVideoUpload else {
            throw APIClientError.server("The media service did not provide a supported private upload.", 0)
        }

        MediaPerformance.measure("video_upload_phase attempt=\(upload.id) phase=prepare_lease bytes=\(byteSize)", since: prepareStartedAt)
        try await setPreparedVideoUpload(id: upload.id, preparedUpload: preparedUpload)
        return preparedUpload
    }

    private func cacheUploadedMedia(_ upload: PendingStoryUpload, response: StoryUploadResponse) async {
        guard upload.assetKind == .video else {
            // Image playback URLs point at generated or uploaded derivatives. The raw
            // original is not byte-equivalent and must never be cached under those keys.
            return
        }

        let mediaUrl = response.asset.renditions?.playback.mediaUrl ?? response.asset.mediaUrl
        await MediaFileDiskCache.shared.storeLocalFile(
            sourceURL: upload.mediaFileURL,
            for: mediaUrl,
            kind: .video
        )

        guard let thumbnailUrl = response.asset.renditions?.playback.thumbnailUrl ?? response.asset.thumbnailUrl,
              let localThumbnailURL = upload.thumbnailFileURL else {
            return
        }

        await MediaFileDiskCache.shared.storeLocalFile(
            sourceURL: localThumbnailURL,
            for: thumbnailUrl,
            kind: .image
        )

    }

    private func cacheUploadedImageDerivatives(
        _ derivatives: UploadedImageDerivativeSet,
        response: StoryUploadResponse
    ) async {
        let playback = response.asset.renditions?.playback
        let candidates: [(derivative: LocalImageDerivative, url: URL?)] = [
            (derivatives.local.display, playback?.mediaUrl ?? response.asset.mediaUrl),
            (derivatives.local.thumbnail, playback?.thumbnailUrl ?? response.asset.thumbnailUrl),
        ]
        var cachedURLs: Set<URL> = []

        for candidate in candidates {
            guard let url = candidate.url, cachedURLs.insert(url).inserted else {
                continue
            }

            let temporaryURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("story-cache-\(UUID().uuidString.lowercased())")
            do {
                try await StoryUploadFileIO.write(candidate.derivative.data, to: temporaryURL)
                await MediaFileDiskCache.shared.storeLocalFile(
                    sourceURL: temporaryURL,
                    for: url,
                    kind: .image
                )
            } catch {
                MediaPerformance.mark("image_derivative_cache_failed")
            }
            await StoryUploadFileIO.remove([temporaryURL])
        }
    }

    private func storyCard(for upload: PendingStoryUpload, owner: MyStorySummary.Owner) -> StoryCard {
        StoryCard(
            id: upload.id,
            creator: owner.name,
            handle: owner.handle,
            assetKind: upload.assetKind,
            mediaUrl: upload.mediaFileURL,
            thumbnailUrl: upload.assetKind == .image ? upload.mediaFileURL : upload.thumbnailFileURL,
            placeholderUrl: upload.assetKind == .image ? upload.mediaFileURL : upload.thumbnailFileURL,
            renditions: nil,
            title: upload.statusLabel,
            processingStatus: nil,
            textOverlays: upload.textOverlays,
            durationSeconds: upload.durationMs.map { Double($0) / 1_000 },
            lastUploadedAt: nil,
            progressPercent: upload.displayProgress * 100,
            timelineSegmentCount: nil
        )
    }

    private func stackItem(for upload: PendingStoryUpload) -> StoryStackItem {
        StoryStackItem(
            id: upload.id,
            assetKind: upload.assetKind,
            mediaUrl: upload.mediaFileURL,
            thumbnailUrl: upload.assetKind == .image ? upload.mediaFileURL : upload.thumbnailFileURL,
            placeholderUrl: upload.assetKind == .image ? upload.mediaFileURL : upload.thumbnailFileURL,
            renditions: nil,
            title: upload.statusLabel,
            processingStatus: nil,
            textOverlays: upload.textOverlays,
            postedAt: upload.statusLabel,
            durationSeconds: upload.durationMs.map { Double($0) / 1_000 },
            captionVerticalPercent: nil,
            stats: nil
        )
    }

    private func update(
        id: String,
        state: PendingStoryUploadState,
        progress: Double,
        errorMessage: String? = nil,
        incrementsRetry: Bool = false,
        estimatedRemainingSeconds: Int? = nil
    ) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        guard StoryUploadStateMachine.allows(from: uploads[index].state, to: state) else { return }
        var next = uploads[index]
        let phaseChanged = next.state != state
        next.state = state
        next.estimatedRemainingSeconds = state == .uploading ? estimatedRemainingSeconds : nil
        next.progress = min(max(progress, 0), 1)
        next.updatedAt = Date()
        next.errorMessage = errorMessage
        if incrementsRetry { next.retryCount += 1 }
        if let batchId = next.batchId {
            batchStates[batchId]?.recordProgress(id, progress: next.displayProgress)
        }
        // One publication per progress tick, instead of one for every field.
        uploads[index] = next
        if phaseChanged || incrementsRetry || state != .uploading || progress >= 1 {
            persist()
            lastProgressPersistAt = Date()
        } else if Date().timeIntervalSince(lastProgressPersistAt) >= 1 {
            persist()
            lastProgressPersistAt = Date()
        }
    }

    private func recordRetry(id: String, reason: String) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        uploads[index].retryCount += 1
        uploads[index].updatedAt = Date()
        persist()
        MediaPerformance.mark("pending_story_upload_retry id=\(id) reason=\(reason)")
    }

    private func setPreparedVideoUpload(id: String, preparedUpload: VideoUploadResponse?) async throws {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        uploads[index].preparedVideoUpload = preparedUpload
        uploads[index].updatedAt = Date()
        guard await persist().value else { throw CocoaError(.fileWriteUnknown) }
        guard upload(id: id) != nil else { throw CancellationError() }
    }

    private func markFailed(id: String, error: Error) {
        let transient = StoryUploadRecoveryPolicy.isTransient(error)
        if let index = uploads.firstIndex(where: { $0.id == id }) {
            uploads[index].nextRetryAt = transient ? Date().addingTimeInterval(StoryUploadRecoveryPolicy.delay(attempt: uploads[index].retryCount + 1)) : nil
        }
        let message = transient ? "Upload paused. We’ll resume when your connection is ready." : error.localizedDescription
        update(id: id, state: transient ? .paused : .failed, progress: uploads.first(where: { $0.id == id })?.displayProgress ?? 0, errorMessage: message)
        MediaPerformance.mark("pending_story_upload_failed id=\(id)")
    }

    private func scheduleRecovery(api: APIClient) {
        guard !recoveryInProgress else { return }
        recoveryTask?.cancel()
        guard NetworkQualityMonitor.shared.isConnected,
              let due = uploads.filter({ $0.state == .paused && !activeUploadIDs.contains($0.id) })
                .compactMap(\.nextRetryAt).min() else { return }
        recoveryTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(max(1, due.timeIntervalSinceNow))) }
            catch { return }
            guard !Task.isCancelled, let self else { return }
            _ = await self.resumeInterruptedUploads(api: api)
        }
    }

    private func reconcile(id: String) {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            return
        }

        if let batchId = upload.batchId { batchStates[batchId]?.complete(upload.id) }
        removeFiles(for: upload)
        automaticallyResumedUploadIds.remove(id)
        uploads.removeAll { $0.id == id }
        persist()
    }

    @discardableResult
    private func upsert(_ upload: PendingStoryUpload) -> Task<Bool, Never> {
        if let batchId = upload.batchId {
            if batchStates[batchId] == nil {
                batchStates[batchId] = StoryUploadBatchProgress(
                    id: batchId, totalCount: upload.batchCount ?? 1, createdAt: upload.createdAt
                )
                batchStates[batchId]?.preparationFinished = true
            }
            batchStates[batchId]?.register(upload.id, progress: upload.displayProgress)
        }
        uploads.removeAll { $0.id == upload.id }
        uploads.append(upload)
        return persist()
    }

    private func loadPersistedUploads() {
        guard let data = try? Data(contentsOf: manifestURL) else { return }
        let decoded: [PendingStoryUpload]
        if let manifest = try? JSONDecoder().decode(PendingStoryUploadManifest.self, from: data) {
            decoded = manifest.uploads
            batchStates = manifest.batches
        } else if let legacy = try? JSONDecoder().decode([PendingStoryUpload].self, from: data) {
            decoded = legacy
            // Older manifests contain no completion receipts. Do not credit
            // missing items as successful uploads during migration.
            for upload in legacy {
                guard let batchId = upload.batchId else { continue }
                if batchStates[batchId] == nil {
                    batchStates[batchId] = StoryUploadBatchProgress(
                        id: batchId, totalCount: upload.batchCount ?? 1, createdAt: upload.createdAt
                    )
                }
                batchStates[batchId]?.register(upload.id, progress: upload.displayProgress)
            }
        } else { return }
        // Composer preparation cannot resume after a process exit. Keep every
        // durable staged item, while reporting unstaged items as unavailable.
        for batchId in Array(batchStates.keys) { batchStates[batchId]?.preparationFinished = true }

        uploads = decoded.compactMap { upload in
            guard fileManager.fileExists(atPath: upload.mediaFileURL.path) else {
                if let batchId = upload.batchId { batchStates[batchId]?.remove(upload.id) }
                return nil
            }

            var restoredUpload = upload
            if restoredUpload.state != .failed && restoredUpload.state != .paused {
                restoredUpload.state = .recovering
                restoredUpload.errorMessage = nil
                restoredUpload.updatedAt = Date()
                let prepared = restoredUpload.preparedVideoUpload == nil ? "false" : "true"
                MediaPerformance.mark(
                    "background_upload_resume id=\(restoredUpload.id) pipeline=\(restoredUpload.pipeline.rawValue) prepared=\(prepared)"
                )
            }
            return restoredUpload
        }
        persist()
    }

    @discardableResult
    private func persist() -> Task<Bool, Never> {
        let retainedBatches = batchStates.filter { batchId, state in
            !state.preparationFinished || uploads.contains { $0.batchId == batchId }
        }
        if retainedBatches.count != batchStates.count { batchStates = retainedBatches }
        let manifest = PendingStoryUploadManifest(uploads: uploads, batches: retainedBatches)
        let previous = persistenceTask, writer = manifestWriter, url = manifestURL
        // Capture the predecessor before leaving the main actor. Task scheduling
        // order cannot allow an old checkpoint to overwrite a newer transition.
        let task = Task.detached(priority: .utility) {
            if let previous { _ = await previous.value }
            return writer.write(manifest, to: url, wait: true)
        }
        persistenceTask = task
        return task
    }

    /// A durability barrier for lifecycle transitions and deterministic recovery tests.
    func flushPersistence() async -> Bool {
        await persistenceTask?.value ?? true
    }

    private func recordRecoveredCompletion(_ response: StoryUploadResponse) async {
        if await receiptStore.append(response, to: recoveredReceiptsURL) {
            NotificationCenter.default.post(name: Self.recoveredCompletionAvailable, object: nil)
        } else {
            MediaPerformance.mark("recovered_story_upload_persist_failed")
        }
    }

    private func ensureDirectories() throws {
        try fileManager.createDirectory(at: filesURL, withIntermediateDirectories: true)
    }

    private func removeFiles(for upload: PendingStoryUpload) {
        try? fileManager.removeItem(at: upload.mediaFileURL)
        if let thumbnailFileURL = upload.thumbnailFileURL, thumbnailFileURL != upload.mediaFileURL {
            try? fileManager.removeItem(at: thumbnailFileURL)
        }
    }

    private func fileSize(_ url: URL) throws -> Int64 {
        guard let size = try fileManager.attributesOfItem(atPath: url.path)[.size] as? NSNumber,
              size.int64Value > 0 else {
            throw APIClientError.invalidResponse
        }

        return size.int64Value
    }

    private static func makePendingId() -> String {
        "pending-story-\(UUID().uuidString.lowercased())"
    }

    private static func clientUploadId(for pendingId: String) -> String {
        let prefix = "pending-story-"
        guard pendingId.hasPrefix(prefix) else {
            return pendingId
        }

        return String(pendingId.dropFirst(prefix.count))
    }
}

private final class StoryUploadBackgroundTask {
    private var identifier = UIBackgroundTaskIdentifier.invalid

    init(name: String) {
        identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            self?.end()
        }
    }

    func end() {
        guard identifier != .invalid else {
            return
        }

        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }

    deinit {
        end()
    }
}

enum StoryUploadDiagnostics {
    static func mark(_ event: String, response: StoryUploadResponse? = nil) {
        let metadata = [
            "event=\(event)",
            response.map { "storyId=\($0.storyId)" },
            response.map { "asset=\($0.asset.assetKind.rawValue)" },
            response?.processingStatus.map { "processing=\($0)" },
            response?.moderationStatus.map { "moderation=\($0)" },
        ]
            .compactMap { $0 }
            .joined(separator: " ")

        MediaPerformance.mark("story_upload \(metadata)")
    }
}
