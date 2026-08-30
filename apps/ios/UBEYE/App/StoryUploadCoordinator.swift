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
                notice.showProcessing()
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
                if result == .failed {
                    if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
                        notice.showPosting()
                    } else {
                        notice.showFailed(
                            message: "We couldn’t finish preparing this story. Your original upload is safe; please try uploading it again."
                        )
                    }
                    StoryUploadDiagnostics.mark("readiness_poll_failed", response: response)
                } else {
                    if pendingUploads?.visibleUploads.contains(where: { !$0.isFailed }) == true {
                        notice.showPosting()
                    } else {
                        notice.showDelayed()
                    }
                    StoryUploadDiagnostics.mark("readiness_poll_timeout", response: response)
                }
                return
            }

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
    case uploading
    case completing
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
    let mediaFileURL: URL
    let thumbnailFileURL: URL?
    let fileName: String
    let mimeType: String?
    let durationMs: Int?
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

    var displayProgress: Double {
        min(max(progress, 0), 1)
    }

    var isFailed: Bool {
        state == .failed
    }

    var statusLabel: String {
        switch state {
        case .queued:
            "Posting"
        case .uploading:
            "Posting \(Int((displayProgress * 100).rounded()))%"
        case .completing:
            "Finishing"
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
    let progress: Double
    let uploads: [PendingStoryUpload]
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

enum StoryUploadFileIO {
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
                try fileManager.copyItem(at: sourceURL, to: destinationURL)

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
    // Story cards are previews of the composed story, not decorative cover
    // art. Keep the entire source visible so the thumbnail never suggests a
    // crop that playback does not apply.
    static let thumbnailContentMode = StoryImageContentMode.fit

    static func build(fileURL: URL) async throws -> LocalImageDerivativeSet {
        try await Task.detached(priority: .userInitiated) {
            guard let displayImage = StoryImageTranscoder.storyCanvasImage(
                fileURL: fileURL,
                width: StoryImageUpload.playbackCanvasWidth,
                height: StoryImageUpload.playbackCanvasHeight,
                contentMode: .fit
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
    @Published private(set) var uploads: [PendingStoryUpload] = []

    private let fileManager: FileManager
    private let rootURL: URL
    private let filesURL: URL
    private let manifestURL: URL
    private let maxVideoDurationSeconds = 120
    private var automaticallyResumedUploadIds = Set<String>()

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        rootURL = fileManager
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("pending-story-uploads", isDirectory: true)
        filesURL = rootURL.appendingPathComponent("files", isDirectory: true)
        manifestURL = rootURL.appendingPathComponent("uploads.json")
        loadPersistedUploads()
    }

    var visibleUploads: [PendingStoryUpload] {
        uploads.sorted { $0.createdAt < $1.createdAt }
    }

    var latestVisibleUpload: PendingStoryUpload? {
        visibleUploads.last
    }

    var latestBatchSummary: PendingStoryUploadBatchSummary? {
        guard let latestBatchUpload = visibleUploads.last(where: { $0.batchId != nil }),
              let batchId = latestBatchUpload.batchId else {
            return nil
        }

        let batchUploads = visibleUploads
            .filter { $0.batchId == batchId }
            .sorted {
                ($0.batchPosition ?? Int.max) < ($1.batchPosition ?? Int.max)
            }
        let totalCount = max(latestBatchUpload.batchCount ?? batchUploads.count, batchUploads.count)
        let completedCount = max(totalCount - batchUploads.count, 0)
        let failedCount = batchUploads.filter(\.isFailed).count
        let remainingProgress = batchUploads.reduce(0) { $0 + $1.displayProgress }
        let progress = totalCount > 0
            ? min(max((Double(completedCount) + remainingProgress) / Double(totalCount), 0), 1)
            : 0

        return PendingStoryUploadBatchSummary(
            id: batchId,
            totalCount: totalCount,
            completedCount: completedCount,
            failedCount: failedCount,
            progress: progress,
            uploads: batchUploads
        )
    }

    func createImageUpload(
        upload: StoryImageUpload,
        contentMode: StoryImageContentMode,
        draft: PendingStoryUploadDraft,
        textOverlays: [StoryTextOverlay],
        batchId: String? = nil,
        batchPosition: Int? = nil,
        batchCount: Int? = nil
    ) throws -> PendingStoryUpload {
        try ensureDirectories()
        let id = Self.makePendingId()
        let fileExtension = (upload.fileName as NSString).pathExtension.isEmpty
            ? "jpg"
            : (upload.fileName as NSString).pathExtension
        let mediaURL = filesURL.appendingPathComponent("\(id).\(fileExtension)")
        try upload.data.write(to: mediaURL, options: .atomic)

        let pending = PendingStoryUpload(
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
        upsert(pending)
        MediaImageCache.shared.preheat([mediaURL], limit: 1)
        return pending
    }

    func createVideoUpload(
        sourceURL: URL,
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
        upsert(pending)
        MediaImageCache.shared.preheat([thumbnailURL].compactMap { $0 }, limit: 1)
        return pending
    }

    func performUpload(
        id: String,
        api: APIClient,
        onVideoPhase: ((StoryVideoUploadPhase) -> Void)? = nil
    ) async throws -> StoryUploadResponse {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            throw APIClientError.invalidResponse
        }

        let backgroundTask = StoryUploadBackgroundTask(name: "story-upload-\(id)")
        defer {
            backgroundTask.end()
        }

        do {
            let response: StoryUploadResponse
            switch upload.pipeline {
            case .imageMultipart:
                response = try await uploadImage(upload, api: api)
            case .imageDirectBlob:
                response = try await uploadDirectImage(upload, api: api)
            case .videoTus:
                response = try await uploadVideo(
                    upload,
                    api: api,
                    onPhase: onVideoPhase
                )
            }

            await cacheUploadedMedia(upload, response: response)
            reconcile(id: id)
            return response
        } catch {
            markFailed(id: id, error: error)
            throw error
        }
    }

    func retry(id: String, api: APIClient) async throws -> StoryUploadResponse {
        update(id: id, state: .queued, progress: 0.04, errorMessage: nil, incrementsRetry: true)
        return try await performUpload(id: id, api: api)
    }

    func resumeInterruptedUploads(api: APIClient) async -> [StoryUploadResponse] {
        let interrupted = uploads.filter {
            $0.isFailed &&
            ($0.errorMessage?.hasPrefix("Upload interrupted.") == true) &&
            !$0.mediaFileURL.path.isEmpty &&
            automaticallyResumedUploadIds.insert($0.id).inserted
        }
        var responses: [StoryUploadResponse] = []

        for upload in interrupted {
            do {
                responses.append(try await retry(id: upload.id, api: api))
            } catch {
                MediaPerformance.mark("background_upload_resume id=\(upload.id) result=failed")
            }
        }

        return responses
    }

    func remove(id: String) {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            return
        }

        removeFiles(for: upload)
        uploads.removeAll { $0.id == id }
        persist()
    }

    func upload(id: String) -> PendingStoryUpload? {
        uploads.first { $0.id == id }
    }

    func normalizeBatch(_ batchId: String, orderedUploadIds: [String]) {
        guard !orderedUploadIds.isEmpty else {
            return
        }

        for (offset, uploadId) in orderedUploadIds.enumerated() {
            guard let index = uploads.firstIndex(where: {
                $0.id == uploadId && $0.batchId == batchId
            }) else {
                continue
            }
            uploads[index].batchPosition = offset + 1
            uploads[index].batchCount = orderedUploadIds.count
            uploads[index].updatedAt = Date()
        }
        persist()
    }

    func feedByMergingPendingUploads(into feed: MobileFeedResponse) -> MobileFeedResponse {
        let pendingCards = visibleUploads.map { upload in
            storyCard(for: upload, owner: feed.myStory.owner)
        }

        guard !pendingCards.isEmpty else {
            return feed
        }

        let mergedItems = feed.myStory.items.filter { item in
            !pendingCards.contains { $0.id == item.id }
        } + pendingCards
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
        let mergedItems = base.items.filter { item in
            !pendingItems.contains { $0.id == item.id }
        } + pendingItems

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
        id.hasPrefix("pending-story-")
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

    private func uploadDirectImage(_ upload: PendingStoryUpload, api: APIClient) async throws -> StoryUploadResponse {
        update(id: upload.id, state: .uploading, progress: 0.12)
        let byteSize = try fileSize(upload.mediaFileURL)
        let preparedUpload = try await api.prepareImageStoryUpload(
            fileName: upload.fileName.isEmpty ? "story-photo.jpg" : upload.fileName,
            contentType: upload.mimeType ?? "image/jpeg",
            byteSize: byteSize,
            displayContentType: "image/avif"
        )
        guard let sourcePart = preparedUpload.source,
              let sourceData = await StoryUploadFileIO.data(at: upload.mediaFileURL),
              !sourceData.isEmpty,
              Int64(sourceData.count) <= sourcePart.maxSizeBytes else {
            throw APIClientError.invalidResponse
        }
        update(id: upload.id, state: .uploading, progress: 0.30)
        _ = try await api.uploadImageData(sourceData, part: sourcePart)
        update(id: upload.id, state: .uploading, progress: 0.88)

        let pixelSize = await StoryUploadFileIO.imagePixelSize(of: sourceData)
        let sourceUpload = PreparedImageDerivativeUpload(
            pathname: sourcePart.pathname,
            contentType: sourcePart.contentType,
            byteSize: Int64(sourceData.count),
            checksum: await StoryUploadFileIO.sha256Hex(of: sourceData),
            width: pixelSize?.width,
            height: pixelSize?.height
        )

        let response = try await api.completeImageStory(
            upload: preparedUpload,
            sourceUpload: sourceUpload,
            contentMode: .fit,
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

    private func uploadVideo(
        _ upload: PendingStoryUpload,
        api: APIClient,
        onPhase: ((StoryVideoUploadPhase) -> Void)? = nil
    ) async throws -> StoryUploadResponse {
        update(id: upload.id, state: .uploading, progress: 0.12)
        guard try await StoryUploadFileIO.hasFastStartMoov(at: upload.mediaFileURL) else {
            throw APIClientError.server(
                "This video is not optimized for streaming. Export it again and retry.",
                400
            )
        }
        let byteSize = try await StoryUploadFileIO.fileSize(at: upload.mediaFileURL)
        var preparedUpload: VideoUploadResponse

        if let resumableUpload = upload.preparedVideoUpload,
           resumableUpload.supportsDirectVideoUpload {
            preparedUpload = try await prepareVideoUpload(
                upload,
                byteSize: byteSize,
                replacing: nil,
                api: api
            )
            MediaPerformance.mark("pending_video_upload_resume uid=\(resumableUpload.uid)")
        } else {
            preparedUpload = try await prepareVideoUpload(
                upload,
                byteSize: byteSize,
                replacing: nil,
                api: api
            )
        }

        for leaseAttempt in 0..<2 {
            do {
                guard let posterPart = preparedUpload.poster,
                      let posterURL = upload.thumbnailFileURL,
                      let posterData = await StoryUploadFileIO.data(at: posterURL),
                      let posterPixelSize = await StoryUploadFileIO.imagePixelSize(of: posterData),
                      !posterData.isEmpty,
                      Int64(posterData.count) <= posterPart.maxSizeBytes else {
                    throw APIClientError.server(
                        "Could not prepare the video poster. Try a different video.",
                        400
                    )
                }

                onPhase?(.thumbnailUpload)
                update(id: upload.id, state: .uploading, progress: 0.18)
                MediaPerformance.mark("pending_video_poster_upload_started uid=\(preparedUpload.uid)")
                let uploadedPoster = PreparedImageDerivativeUpload(
                    pathname: posterPart.pathname,
                    contentType: posterPart.contentType,
                    byteSize: Int64(posterData.count),
                    checksum: await StoryUploadFileIO.sha256Hex(of: posterData),
                    width: posterPixelSize.width,
                    height: posterPixelSize.height
                )
                onPhase?(.videoUpload)
                update(id: upload.id, state: .uploading, progress: 0.22)
                let uploadTarget = preparedUpload
                async let posterUpload = api.uploadImageData(
                    posterData,
                    part: posterPart
                )
                async let sourceChecksum = StoryUploadFileIO.sha256Hex(
                    at: upload.mediaFileURL
                )
                async let videoUpload = api.uploadVideoFile(
                    fileURL: upload.mediaFileURL,
                    upload: uploadTarget,
                    onRetry: { reason in
                        _ = Task { @MainActor [weak self] in
                            self?.recordRetry(id: upload.id, reason: reason)
                        }
                    },
                    maxChunkBytes: videoUploadChunkBytes(),
                    onProgress: { progress in
                        _ = Task { @MainActor [weak self] in
                            self?.update(
                                id: upload.id,
                                state: .uploading,
                                progress: 0.22 + min(max(progress, 0), 1) * 0.68
                            )
                        }
                    }
                )
                let (_, blobUploadId, checksum) = try await (
                    posterUpload,
                    videoUpload,
                    sourceChecksum
                )
                MediaPerformance.mark("pending_video_poster_upload_succeeded uid=\(preparedUpload.uid)")

                onPhase?(.completeStory)
                update(id: upload.id, state: .completing, progress: 0.94)
                let response = try await api.completeVideoStory(
                    upload: preparedUpload,
                    fileURL: upload.mediaFileURL,
                    checksum: checksum,
                    uploadId: blobUploadId,
                    poster: uploadedPoster,
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
                    durationMs: upload.durationMs
                )
                update(id: upload.id, state: .completing, progress: 1)
                return response
            } catch {
                let statusCode = (error as? APIClientError)?.statusCode
                let sessionIsTerminal = statusCode.map { [403, 404, 410].contains($0) } == true
                guard leaseAttempt == 0, sessionIsTerminal else {
                    if sessionIsTerminal {
                        setPreparedVideoUpload(id: upload.id, preparedUpload: nil)
                    }
                    throw error
                }

                let failedSessionId = preparedUpload.uploadSessionId
                recordRetry(id: upload.id, reason: "replace_upload_session")
                setPreparedVideoUpload(id: upload.id, preparedUpload: nil)
                preparedUpload = try await prepareVideoUpload(
                    upload,
                    byteSize: byteSize,
                    replacing: failedSessionId,
                    api: api
                )
            }
        }

        throw APIClientError.server("Could not resume this video upload.", 0)
    }

    private func videoUploadChunkBytes() -> Int64 {
        Int64(MediaControlConfig.shared.uploadChunkBytes)
    }

    private func prepareVideoUpload(
        _ upload: PendingStoryUpload,
        byteSize: Int64,
        replacing uploadSessionId: String?,
        api: APIClient
    ) async throws -> VideoUploadResponse {
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

        setPreparedVideoUpload(id: upload.id, preparedUpload: preparedUpload)
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
        incrementsRetry: Bool = false
    ) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        uploads[index].state = state
        uploads[index].progress = min(max(progress, 0), 1)
        uploads[index].updatedAt = Date()
        uploads[index].errorMessage = errorMessage
        if incrementsRetry {
            uploads[index].retryCount += 1
        }
        persist()
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

    private func setPreparedVideoUpload(id: String, preparedUpload: VideoUploadResponse?) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        uploads[index].preparedVideoUpload = preparedUpload
        uploads[index].updatedAt = Date()
        persist()
    }

    private func markFailed(id: String, error: Error) {
        let message = error.localizedDescription
        update(id: id, state: .failed, progress: uploads.first(where: { $0.id == id })?.displayProgress ?? 0, errorMessage: message)
        MediaPerformance.mark("pending_story_upload_failed id=\(id)")
    }

    private func reconcile(id: String) {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            return
        }

        removeFiles(for: upload)
        uploads.removeAll { $0.id == id }
        persist()
    }

    private func upsert(_ upload: PendingStoryUpload) {
        uploads.removeAll { $0.id == upload.id }
        uploads.append(upload)
        persist()
    }

    private func loadPersistedUploads() {
        guard let data = try? Data(contentsOf: manifestURL),
              let decoded = try? JSONDecoder().decode([PendingStoryUpload].self, from: data) else {
            uploads = []
            return
        }

        uploads = decoded.compactMap { upload in
            guard fileManager.fileExists(atPath: upload.mediaFileURL.path) else {
                return nil
            }

            var restoredUpload = upload
            if restoredUpload.state != .failed {
                restoredUpload.state = .failed
                restoredUpload.errorMessage = "Upload interrupted. Retrying automatically."
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

    private func persist() {
        do {
            try ensureDirectories()
            let data = try JSONEncoder().encode(uploads)
            try data.write(to: manifestURL, options: .atomic)
        } catch {
            MediaPerformance.mark("pending_story_upload_persist_failed")
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
