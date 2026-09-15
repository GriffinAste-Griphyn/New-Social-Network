import AVFoundation
import CryptoKit
import ImageIO
import Photos
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum PickedStoryMedia {
    case image(StoryImageUpload)
    case video(StoryVideoUpload)
}

struct StoryVideoUpload {
    enum Source: String, Codable {
        case cameraFront
        case cameraBack
        case library
    }

    let url: URL
    let source: Source
}

struct StoryImageUpload: Equatable, @unchecked Sendable {
    static let maximumUploadBytes = StoryMediaContract.maximumImageUploadBytes
    static let preferredUploadJPEGQuality: CGFloat = 0.88
    static let maximumTranscodedPixelDimension = 4_096
    static let maximumPreviewPixelDimension = 2_560
    static let transcodedJPEGQuality: CGFloat = 0.95
    static let playbackCanvasWidth = Int(StoryCanvasLayout.playbackPixelSize.width)
    static let playbackCanvasHeight = Int(StoryCanvasLayout.playbackPixelSize.height)
    static let playbackJPEGQuality: CGFloat = 0.78
    static let thumbnailCanvasWidth = Int(StoryCanvasLayout.thumbnailPixelSize.width)
    static let thumbnailCanvasHeight = Int(StoryCanvasLayout.thumbnailPixelSize.height)

    let image: UIImage
    let data: Data
    let fileName: String
    let mimeType: String
    let contentMode: StoryImageContentMode
    let sourceChecksum: String
    private let sourceData: Data

    static func prepare(
        data: Data,
        fallbackFileName: String = "story-photo",
        displayImage: UIImage? = nil,
        contentMode: StoryImageContentMode = StoryMediaContract.defaultImageContentMode
    ) async -> StoryImageUpload? {
        await Task.detached(priority: .userInitiated) {
            StoryImageUpload(
                data: data,
                fallbackFileName: fallbackFileName,
                displayImage: displayImage,
                contentMode: contentMode
            )
        }.value
    }

    static func prepare(
        fileURL: URL,
        fallbackFileName: String = "story-photo",
        contentMode: StoryImageContentMode = StoryMediaContract.defaultImageContentMode
    ) async -> StoryImageUpload? {
        await Task.detached(priority: .userInitiated) {
            StoryImageUpload(
                fileURL: fileURL,
                fallbackFileName: fallbackFileName,
                contentMode: contentMode
            )
        }.value
    }

    init?(
        data: Data,
        fallbackFileName: String = "story-photo",
        displayImage: UIImage? = nil,
        contentMode: StoryImageContentMode = StoryMediaContract.defaultImageContentMode
    ) {
        guard let source = StoryImageTranscoder.normalizedJPEG(
            data: data,
            maxPixelDimension: Self.maximumTranscodedPixelDimension,
            quality: Self.transcodedJPEGQuality
        ) else {
            return nil
        }
        self.init(
            sourceData: source.data,
            fallbackFileName: fallbackFileName,
            displayImage: displayImage,
            contentMode: contentMode
        )
    }

    init?(
        fileURL: URL,
        fallbackFileName: String = "story-photo",
        contentMode: StoryImageContentMode = StoryMediaContract.defaultImageContentMode
    ) {
        guard let source = StoryImageTranscoder.normalizedJPEG(
            fileURL: fileURL,
            maxPixelDimension: Self.maximumTranscodedPixelDimension,
            quality: Self.transcodedJPEGQuality
        ) else {
            return nil
        }
        self.init(
            sourceData: source.data,
            fallbackFileName: fallbackFileName,
            contentMode: contentMode
        )
    }

    private init?(
        sourceData: Data,
        fallbackFileName: String,
        displayImage: UIImage? = nil,
        contentMode: StoryImageContentMode
    ) {
        guard let normalized = StoryImageTranscoder.storyCanvasJPEG(
            data: sourceData,
            width: Self.playbackCanvasWidth,
            height: Self.playbackCanvasHeight,
            quality: Self.preferredUploadJPEGQuality,
            contentMode: contentMode
        ), normalized.data.count <= Self.maximumUploadBytes,
              let previewImage = StoryImageTranscoder.previewImage(
                data: normalized.data,
                maxPixelDimension: Self.maximumPreviewPixelDimension
              ) ?? displayImage else {
            return nil
        }

        image = previewImage
        data = normalized.data
        sourceChecksum = SHA256.hash(data: normalized.data).map { String(format: "%02x", $0) }.joined()
        fileName = Self.normalizedFileName(fallbackFileName, fileExtension: "jpg")
        mimeType = "image/jpeg"
        self.contentMode = contentMode
        self.sourceData = sourceData
    }

    func reframed(to contentMode: StoryImageContentMode) async -> StoryImageUpload? {
        if contentMode == self.contentMode {
            return self
        }
        return await Task.detached(priority: .userInitiated) {
            StoryImageUpload(
                sourceData: sourceData,
                fallbackFileName: fileName,
                contentMode: contentMode
            )
        }.value
    }

    private static func normalizedFileName(_ value: String, fileExtension: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? "story-photo" : trimmed

        if base.lowercased().hasSuffix(".\(fileExtension)") ||
            (fileExtension == "jpg" && base.lowercased().hasSuffix(".jpeg")) {
            return base
        }

        let stem = (base as NSString).deletingPathExtension
        return "\(stem.isEmpty ? "story-photo" : stem).\(fileExtension)"
    }

    static func == (lhs: StoryImageUpload, rhs: StoryImageUpload) -> Bool {
        lhs.data == rhs.data &&
            lhs.fileName == rhs.fileName &&
            lhs.mimeType == rhs.mimeType &&
            lhs.contentMode == rhs.contentMode
    }
}

struct StoryJPEGEncoding {
    let data: Data
    let width: Int
    let height: Int
}

enum StoryImageTranscoder {
    static func previewImage(
        data: Data,
        maxPixelDimension: Int
    ) -> UIImage? {
        autoreleasepool {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions),
                  let cgImage = downsampledImage(
                    source: source,
                    maxPixelDimension: maxPixelDimension
                  ) else {
                return nil
            }

            return UIImage(cgImage: cgImage)
        }
    }

    static func previewImage(
        fileURL: URL,
        maxPixelDimension: Int
    ) -> UIImage? {
        autoreleasepool {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, sourceOptions),
                  let cgImage = downsampledImage(
                    source: source,
                    maxPixelDimension: maxPixelDimension
                  ) else {
                return nil
            }

            return UIImage(cgImage: cgImage)
        }
    }

    static func normalizedJPEG(
        data: Data,
        maxPixelDimension: Int,
        quality: CGFloat = 0.9
    ) -> StoryJPEGEncoding? {
        autoreleasepool {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
                return nil
            }

            return encodeJPEG(
                source: source,
                maxPixelDimension: maxPixelDimension,
                quality: quality
            )
        }
    }

    static func normalizedJPEG(
        fileURL: URL,
        maxPixelDimension: Int,
        quality: CGFloat = 0.9
    ) -> StoryJPEGEncoding? {
        autoreleasepool {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, sourceOptions) else {
                return nil
            }

            return encodeJPEG(
                source: source,
                maxPixelDimension: maxPixelDimension,
                quality: quality
            )
        }
    }

    static func jpegDerivative(
        data: Data,
        maxPixelDimension: Int,
        quality: CGFloat
    ) -> StoryJPEGEncoding? {
        normalizedJPEG(
            data: data,
            maxPixelDimension: maxPixelDimension,
            quality: quality
        )
    }

    static func jpegDerivative(
        fileURL: URL,
        maxPixelDimension: Int,
        quality: CGFloat
    ) -> StoryJPEGEncoding? {
        normalizedJPEG(
            fileURL: fileURL,
            maxPixelDimension: maxPixelDimension,
            quality: quality
        )
    }

    static func storyCanvasJPEG(
        data: Data,
        width: Int,
        height: Int,
        quality: CGFloat,
        contentMode: StoryImageContentMode = StoryMediaContract.defaultImageContentMode
    ) -> StoryJPEGEncoding? {
        autoreleasepool {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
                return nil
            }

            return encodeStoryCanvas(
                source: source,
                width: width,
                height: height,
                quality: quality,
                contentMode: contentMode
            )
        }
    }

    static func storyCanvasImage(
        fileURL: URL,
        width: Int,
        height: Int,
        contentMode: StoryImageContentMode = StoryMediaContract.defaultImageContentMode
    ) -> CGImage? {
        autoreleasepool {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, sourceOptions) else {
                return nil
            }
            return renderStoryCanvas(
                source: source,
                width: width,
                height: height,
                contentMode: contentMode
            )
        }
    }

    static func storyCanvasJPEG(
        fileURL: URL,
        width: Int,
        height: Int,
        quality: CGFloat,
        contentMode: StoryImageContentMode = StoryMediaContract.defaultImageContentMode
    ) -> StoryJPEGEncoding? {
        autoreleasepool {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, sourceOptions) else {
                return nil
            }

            return encodeStoryCanvas(
                source: source,
                width: width,
                height: height,
                quality: quality,
                contentMode: contentMode
            )
        }
    }

    private static func encodeJPEG(
        source: CGImageSource,
        maxPixelDimension: Int,
        quality: CGFloat
    ) -> StoryJPEGEncoding? {
        guard let cgImage = downsampledImage(
            source: source,
            maxPixelDimension: maxPixelDimension
        ) else {
            return nil
        }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            return nil
        }

        let destinationOptions: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: min(max(quality, 0), 1),
        ]
        CGImageDestinationAddImage(destination, cgImage, destinationOptions as CFDictionary)
        guard CGImageDestinationFinalize(destination), output.length > 0 else {
            return nil
        }

        return StoryJPEGEncoding(
            data: output as Data,
            width: cgImage.width,
            height: cgImage.height
        )
    }

    private static func encodeStoryCanvas(
        source: CGImageSource,
        width: Int,
        height: Int,
        quality: CGFloat,
        contentMode: StoryImageContentMode
    ) -> StoryJPEGEncoding? {
        guard let renderedImage = renderStoryCanvas(
            source: source,
            width: width,
            height: height,
            contentMode: contentMode
        ) else {
            return nil
        }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            return nil
        }

        let destinationOptions: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: min(max(quality, 0), 1),
        ]
        CGImageDestinationAddImage(
            destination,
            renderedImage,
            destinationOptions as CFDictionary
        )
        guard CGImageDestinationFinalize(destination), output.length > 0 else {
            return nil
        }

        return StoryJPEGEncoding(data: output as Data, width: width, height: height)
    }

    private static func renderStoryCanvas(
        source: CGImageSource,
        width: Int,
        height: Int,
        contentMode: StoryImageContentMode
    ) -> CGImage? {
        guard width > 0,
              height > 0,
              let sourceImage = downsampledImage(
                source: source,
                maxPixelDimension: max(
                    StoryImageUpload.maximumTranscodedPixelDimension,
                    max(width, height)
                )
              ) else {
            return nil
        }

        let sourceSize = CGSize(width: sourceImage.width, height: sourceImage.height)
        let targetSize = CGSize(width: width, height: height)
        let widthScale = targetSize.width / sourceSize.width
        let heightScale = targetSize.height / sourceSize.height
        let scale = contentMode == .fill
            ? max(widthScale, heightScale)
            : min(widthScale, heightScale)
        let fittedSize = CGSize(
            width: sourceSize.width * scale,
            height: sourceSize.height * scale
        )
        let fittedRect = CGRect(
            x: (targetSize.width - fittedSize.width) / 2,
            y: (targetSize.height - fittedSize.height) / 2,
            width: fittedSize.width,
            height: fittedSize.height
        )
        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
              ) else {
            return nil
        }

        context.interpolationQuality = .high
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.fill(CGRect(origin: .zero, size: targetSize))
        context.draw(sourceImage, in: fittedRect)
        return context.makeImage()
    }

    private static func downsampledImage(
        source: CGImageSource,
        maxPixelDimension: Int
    ) -> CGImage? {
        guard maxPixelDimension > 0 else {
            return nil
        }

        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelDimension,
        ]

        return CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            thumbnailOptions as CFDictionary
        )
    }
}

private struct StoryThumbnailOverlaySpec {
    let label: String
    let positionX: Double
    let positionY: Double
    let isLink: Bool
    var isQuoteReply = false
    var actorName: String?
    var actorHandle: String?
}

private final class StoryVideoThumbnailGenerationBox: @unchecked Sendable {
    private let lock = NSLock()
    private var generator: AVAssetImageGenerator?

    func set(_ generator: AVAssetImageGenerator) {
        lock.lock()
        self.generator = generator
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        let generator = self.generator
        lock.unlock()
        generator?.cancelAllCGImageGeneration()
    }
}

enum StoryVideoThumbnailGenerator {
    static let requestedTime = CMTime.zero
    // Allow at most one common video-frame interval after zero so assets whose
    // first presentation timestamp is slightly positive still produce a poster.
    static let requestedTimeToleranceAfter = CMTime(
        seconds: 0.04,
        preferredTimescale: 600
    )

    static func posterData(for url: URL) async throws -> Data {
        let work = Task.detached(priority: .userInitiated) {
            let frame = try await firstFrame(for: url)
            let image = UIImage(cgImage: frame)
            for quality: CGFloat in [0.9, 0.82] {
                if let data = image.jpegData(compressionQuality: quality), !data.isEmpty, data.count <= 2 * 1024 * 1024 {
                    return data
                }
            }
            throw APIClientError.server("Could not prepare video thumbnail. Try a different video.", 400)
        }
        return try await withThrowingTaskGroup(of: Data.self) { group in
            group.addTask {
                try await withTaskCancellationHandler { try await work.value } onCancel: { work.cancel() }
            }
            group.addTask {
                try await Task.sleep(for: .seconds(3))
                throw APIClientError.server("Could not prepare video thumbnail. Try a different video.", 400)
            }
            defer { group.cancelAll() }
            guard let data = try await group.next() else { throw APIClientError.invalidResponse }
            return data
        }
    }

    static func firstFrame(for url: URL) async throws -> CGImage {
        let generationBox = StoryVideoThumbnailGenerationBox()

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let asset = AVURLAsset(url: url)
                let generator = AVAssetImageGenerator(asset: asset)
                generator.appliesPreferredTrackTransform = true
                generator.maximumSize = CGSize(width: 1080, height: 1920)
                generator.requestedTimeToleranceBefore = .zero
                generator.requestedTimeToleranceAfter = requestedTimeToleranceAfter
                generationBox.set(generator)

                let lock = NSLock()
                var didResume = false

                func finish(_ result: Result<CGImage, Error>) {
                    lock.lock()
                    guard !didResume else {
                        lock.unlock()
                        return
                    }
                    didResume = true
                    lock.unlock()
                    continuation.resume(with: result)
                }

                generator.generateCGImagesAsynchronously(
                    forTimes: [NSValue(time: requestedTime)]
                ) { _, image, _, result, error in
                    switch result {
                    case .succeeded:
                        if let image {
                            finish(.success(image))
                        } else {
                            finish(.failure(
                                error ?? APIClientError.server(
                                    "Could not prepare video thumbnail. Try a different video.",
                                    0
                                )
                            ))
                        }
                    case .failed, .cancelled:
                        finish(.failure(
                            error ?? APIClientError.server(
                                "Could not prepare video thumbnail. Try a different video.",
                                0
                            )
                        ))
                    @unknown default:
                        finish(.failure(
                            error ?? APIClientError.server(
                                "Could not prepare video thumbnail. Try a different video.",
                                0
                            )
                        ))
                    }
                }
            }
        } onCancel: {
            generationBox.cancel()
        }
    }
}

private enum ComposerOverlayInputMode: Identifiable {
    case text
    case link

    var id: String {
        switch self {
        case .text: "text"
        case .link: "link"
        }
    }
}

private enum StoryComposerLimits {
    static let caption = 220
    static let textOverlay = 220
    static let linkLabel = 64
    static let linkURL = 320
    static let brandTag = 32
    static let brandTagsInput = 320
}

private struct StoryComposerTextDraft: Codable {
    let caption: String
    let brandTags: String
    let textOverlay: String
    let textOverlayPositionX: Double
    let textOverlayPositionY: Double
    let linkUrl: String
    let linkLabel: String
    let linkOverlayPositionX: Double
    let linkOverlayPositionY: Double
    let quotedReply: QuotedStoryReply?
    let quoteReplyPositionX: Double
    let quoteReplyPositionY: Double

    var isEmpty: Bool {
        caption.isEmpty &&
            brandTags.isEmpty &&
            textOverlay.isEmpty &&
            linkUrl.isEmpty &&
            linkLabel.isEmpty &&
            quotedReply == nil
    }
}

private func storyTextPrefix(_ value: String, maximumUTF16Length: Int) -> String {
    guard value.utf16.count > maximumUTF16Length else {
        return value
    }

    var result = ""
    var length = 0
    for character in value {
        let characterLength = String(character).utf16.count
        guard length + characterLength <= maximumUTF16Length else {
            break
        }
        result.append(character)
        length += characterLength
    }
    return result
}

@MainActor
final class StoryComposerStore: ObservableObject {
    private let maxVideoDurationSeconds = StoryMediaContract.maximumVideoDurationSeconds
    private static let textDraftKey = "ubeye.story-composer-text-draft.v1"
    private static let earlyUploadPreferenceKey = "ubeye.story-composer-early-upload.v1"
    private let preferences: UserDefaults


    @Published var caption = ""
    @Published var brandTags = ""
    @Published var textOverlay = ""
    @Published var textOverlayPositionX: Double = 50
    @Published var textOverlayPositionY: Double = 68
    @Published var linkUrl = ""
    @Published var linkLabel = ""
    @Published var linkOverlayPositionX: Double = 50
    @Published var linkOverlayPositionY: Double = 78
    @Published var quotedReply: QuotedStoryReply?
    @Published var quoteReplyPositionX: Double = 50
    @Published var quoteReplyPositionY: Double = 58
    @Published var selectedMedia: PickedStoryMedia? {
        didSet {
            guard !isUploading else { return }
            prepareSelectionLocally(selectedMedia.map { [$0] } ?? [])
        }
    }
    private struct LocalVideoPreparation {
        let video: PreparedStoryVideo
        let fingerprint: StoryUploadFileFingerprint
    }
    private struct PreparationEntry {
        let source: String
        let durationLimit: Int
        let adaptiveEncodingEnabled: Bool
        let fingerprint: StoryUploadFileFingerprint
        let task: Task<LocalVideoPreparation, Error>
    }
    private var localPreparations: [URL: PreparationEntry] = [:]
    private var selectionPreparationTask: Task<Void, Never>?
    private var readyPreparations: [URL: LocalVideoPreparation] = [:]
    @Published private(set) var uploadWhileEditing = false
    private var draftUploadAPI: APIClient?
    private var draftUploads: [URL: StoryDraftVideoTransfer] = [:]
    private var readyDraftUploads: [URL: StoryDraftVideoUpload] = [:]

    func setUploadWhileEditing(_ enabled: Bool, api: APIClient, media: [PickedStoryMedia]) {
        preferences.set(enabled, forKey: Self.earlyUploadPreferenceKey)
        configureEarlyUpload(enabled, api: api, media: media)
    }

    func resumeEarlyUpload(api: APIClient, media: [PickedStoryMedia]) {
        configureEarlyUpload((preferences.object(forKey: Self.earlyUploadPreferenceKey) as? Bool ?? true), api: api, media: media)
    }

    func suspendEarlyUpload(api: APIClient) {
        // Dismissal cancels private work, but does not revoke a saved preference.
        configureEarlyUpload(false, api: api, media: [])
    }

    private func configureEarlyUpload(_ enabled: Bool, api: APIClient, media: [PickedStoryMedia]) {
        uploadWhileEditing = enabled
        draftUploadAPI = enabled ? api : nil
        if !enabled { for url in Array(draftUploads.keys) { discardDraftUpload(for: url, api: api) } }
        prepareSelectionLocally(media)
    }

    private func discardDraftUpload(for url: URL, api: APIClient) {
        readyDraftUploads[url] = nil
        guard let entry = draftUploads.removeValue(forKey: url) else { return }
        entry.task.cancel()
        Task {
            if let result = try? await entry.task.value {
                if api.authToken == entry.account, api.baseURLString == entry.origin, let session = result.upload.uploadSessionId {
                    try? await api.cancelPrivateVideoUpload(clientUploadId: entry.clientUploadId, uploadSessionId: session)
                }
                await StoryUploadFileIO.remove([result.video.url])
            }
        }
    }

    private func startDraftUpload(for video: StoryVideoUpload, prepared: PreparedStoryVideo) async {
        guard uploadWhileEditing, let api = draftUploadAPI, let account = api.authToken,
              NetworkQualityMonitor.shared.isConnected, !NetworkQualityMonitor.shared.isLimitedPath,
              UBEYEResourceMonitor.shared.mode == .standard,
              draftUploads[video.url] == nil, !Task.isCancelled else { return }
        let id = UUID().uuidString.lowercased()
        let origin = api.baseURLString
        let owned = FileManager.default.temporaryDirectory.appendingPathComponent("story-draft-upload-\(id).\(prepared.url.pathExtension)")
        let originalFingerprint: StoryUploadFileFingerprint
        let fingerprint: StoryUploadFileFingerprint
        do {
            originalFingerprint = try await StoryUploadFileFingerprint.read(video.url)
            try await StoryUploadFileIO.stageFile(source: prepared.url, destination: owned)
            fingerprint = try await StoryUploadFileFingerprint.read(owned)
            try Task.checkCancellation()
        } catch {
            await StoryUploadFileIO.remove([owned])
            return
        }
        let ownership = StoryDraftVideoOwnership()
        let task = Task { [weak self] () throws -> StoryDraftVideoUpload in
            var lease: VideoUploadResponse?
            do {
                guard try await StoryUploadFileIO.hasFastStartMoov(at: owned) else { throw APIClientError.invalidResponse }
                try Task.checkCancellation()
                guard api.authToken == account, api.baseURLString == origin else { throw CancellationError() }
                try await StoryUploadPermitPool.videoTransfer.acquire()
                defer { StoryUploadPermitPool.videoTransfer.release() }
                let upload = try await api.prepareVideoUpload(fileName: owned.lastPathComponent,
                    byteSize: prepared.byteSize, maxDurationSeconds: StoryMediaContract.maximumVideoDurationSeconds,
                    clientUploadId: id)
                lease = upload
                try Task.checkCancellation()
                async let checksumWork = StoryUploadFileIO.sha256Hex(at: owned)
                let receipt = try await api.uploadVideoFile(fileURL: owned, upload: upload,
                    maxChunkBytes: Int64(MediaControlConfig.shared.uploadChunkBytes),
                    attemptId: "draft-\(id)", unmeteredOnly: true,
                    onProgress: { progress in Task { @MainActor in ownership.onProgress?(progress) } })
                let checksum = try await checksumWork
                try Task.checkCancellation()
                guard api.authToken == account, api.baseURLString == origin,
                      try await StoryUploadFileFingerprint.read(owned) == fingerprint else { throw CancellationError() }
                if !ownership.isSubmitted {
                    guard try await StoryUploadFileFingerprint.read(video.url) == originalFingerprint else { throw CancellationError() }
                }
                let result = StoryDraftVideoUpload(clientUploadId: id,
                    video: PreparedStoryVideo(url: owned, durationMs: prepared.durationMs, byteSize: prepared.byteSize,
                        strategy: prepared.strategy, inspection: prepared.inspection),
                    upload: upload, blobUploadId: receipt, checksum: checksum,
                    fingerprint: fingerprint, originalFingerprint: originalFingerprint)
                if self?.draftUploads[video.url]?.clientUploadId == id { self?.readyDraftUploads[video.url] = result }
                return result
            } catch {
                // Unstructured cleanup can finish even when speculative work is cancelled.
                let failedLease = lease
                if !ownership.isSubmitted, self?.draftUploads[video.url]?.clientUploadId == id {
                    self?.draftUploads[video.url] = nil
                    self?.readyDraftUploads[video.url] = nil
                }
                Task {
                    if !ownership.isSubmitted, api.authToken == account, api.baseURLString == origin, let session = failedLease?.uploadSessionId {
                        try? await api.cancelPrivateVideoUpload(clientUploadId: id, uploadSessionId: session)
                    }
                    await StoryUploadFileIO.remove([owned])
                }
                throw error
            }
        }
        draftUploads[video.url] = StoryDraftVideoTransfer(clientUploadId: id, account: account, origin: origin,
            video: PreparedStoryVideo(url: owned, durationMs: prepared.durationMs, byteSize: prepared.byteSize,
                strategy: prepared.strategy, inspection: prepared.inspection),
            fingerprint: fingerprint, originalFingerprint: originalFingerprint, ownership: ownership, task: task)
        // The task records its receipt. Preparing the next selected clip must
        // not wait for this transfer; the shared transfer permit still serializes bytes.
    }

    private func readyDraftUpload(for video: StoryVideoUpload) async -> StoryDraftVideoUpload? {
        guard let result = readyDraftUploads[video.url],
              draftUploadAPI?.authToken == draftUploads[video.url]?.account,
              draftUploadAPI?.baseURLString == draftUploads[video.url]?.origin,
              let original = try? await StoryUploadFileFingerprint.read(video.url), original == result.originalFingerprint,
              let uploaded = try? await StoryUploadFileFingerprint.read(result.video.url), uploaded == result.fingerprint else { return nil }
        return result
    }

    private func transferableDraftUpload(for video: StoryVideoUpload) async -> StoryDraftVideoTransfer? {
        guard let entry = draftUploads[video.url],
              draftUploadAPI?.authToken == entry.account, draftUploadAPI?.baseURLString == entry.origin,
              let original = try? await StoryUploadFileFingerprint.read(video.url), original == entry.originalFingerprint,
              let uploaded = try? await StoryUploadFileFingerprint.read(entry.video.url), uploaded == entry.fingerprint else { return nil }
        return entry
    }

    private func finishDraftAdoption(for url: URL) {
        guard let result = readyDraftUploads.removeValue(forKey: url) else { return }
        draftUploads[url] = nil
        Task { await StoryUploadFileIO.remove([result.video.url]) }
    }

    /// Private speculative transfer respects the saved choice and unmetered-path guard.
    func prepareSelectionLocally(_ media: [PickedStoryMedia]) {
        selectionPreparationTask?.cancel()
        let videos = media.prefix(10).compactMap { item -> StoryVideoUpload? in
            guard case .video(let video) = item else { return nil }
            return video
        }
        let retained = Set(videos.map(\.url))
        for url in Array(localPreparations.keys) where !retained.contains(url) {
            discardLocalPreparation(for: url)
        }
        if let api = draftUploadAPI {
            for url in Array(draftUploads.keys) where !retained.contains(url) { discardDraftUpload(for: url, api: api) }
        }
        guard UBEYEResourceMonitor.shared.mode != .critical else { return }
        selectionPreparationTask = Task { [weak self] in
            // Serial preparation avoids competing exports for a multi-item draft.
            for video in videos {
                guard !Task.isCancelled, let self else { return }
                if let prepared = try? await self.preparedVideo(for: video) {
                    await self.startDraftUpload(for: video, prepared: prepared)
                }
            }
        }
    }

    private func discardLocalPreparation(for url: URL) {
        readyPreparations[url] = nil
        guard let entry = localPreparations.removeValue(forKey: url) else { return }
        entry.task.cancel()
        Task {
            if let result = try? await entry.task.value, result.video.url != url {
                await StoryUploadFileIO.remove([result.video.url])
            }
        }
    }

    deinit {
        selectionPreparationTask?.cancel()
        for entry in draftUploads.values {
            entry.task.cancel()
            let api = draftUploadAPI
            Task { @MainActor in
                if let result = try? await entry.task.value {
                    if let api, api.authToken == entry.account, api.baseURLString == entry.origin, let session = result.upload.uploadSessionId {
                        try? await api.cancelPrivateVideoUpload(clientUploadId: entry.clientUploadId, uploadSessionId: session)
                    }
                    await StoryUploadFileIO.remove([result.video.url])
                }
            }
        }
        for (url, entry) in localPreparations {
            entry.task.cancel()
            Task {
                if let result = try? await entry.task.value, result.video.url != url {
                    await StoryUploadFileIO.remove([result.video.url])
                }
            }
        }
    }
    @Published var uploadStatus: String?
    @Published var error: String?
    @Published var lastUploadReport: String?
    @Published var isUploading = false

    init(preferences: UserDefaults = .standard) {
        self.preferences = preferences
        uploadWhileEditing = (preferences.object(forKey: Self.earlyUploadPreferenceKey) as? Bool ?? true)
        guard let data = preferences.data(forKey: Self.textDraftKey),
              let draft = try? JSONDecoder().decode(StoryComposerTextDraft.self, from: data) else {
            return
        }

        caption = draft.caption
        brandTags = draft.brandTags
        textOverlay = draft.textOverlay
        textOverlayPositionX = draft.textOverlayPositionX
        textOverlayPositionY = draft.textOverlayPositionY
        linkUrl = draft.linkUrl
        linkLabel = draft.linkLabel
        linkOverlayPositionX = draft.linkOverlayPositionX
        linkOverlayPositionY = draft.linkOverlayPositionY
        quotedReply = draft.quotedReply
        quoteReplyPositionX = draft.quoteReplyPositionX
        quoteReplyPositionY = draft.quoteReplyPositionY
    }

    func beginPresentation() {
        uploadStatus = nil
    }

    func persistTextDraft() {
        let draft = StoryComposerTextDraft(
            caption: caption,
            brandTags: brandTags,
            textOverlay: textOverlay,
            textOverlayPositionX: textOverlayPositionX,
            textOverlayPositionY: textOverlayPositionY,
            linkUrl: linkUrl,
            linkLabel: linkLabel,
            linkOverlayPositionX: linkOverlayPositionX,
            linkOverlayPositionY: linkOverlayPositionY,
            quotedReply: quotedReply,
            quoteReplyPositionX: quoteReplyPositionX,
            quoteReplyPositionY: quoteReplyPositionY
        )

        if draft.isEmpty {
            UserDefaults.standard.removeObject(forKey: Self.textDraftKey)
        } else if let data = try? JSONEncoder().encode(draft) {
            UserDefaults.standard.set(data, forKey: Self.textDraftKey)
        }
    }

    func preparedVideo(for video: StoryVideoUpload) async throws -> PreparedStoryVideo {
        let fingerprint = try await StoryUploadFileFingerprint.read(video.url)
        try Task.checkCancellation()
        let source = video.source.diagnosticName
        let durationLimit = maxVideoDurationSeconds
        let adaptiveEncoding = StoryAdaptiveEncodingContext.current()
        if let entry = localPreparations[video.url],
           entry.source == source, entry.durationLimit == durationLimit,
           entry.adaptiveEncodingEnabled == adaptiveEncoding.enabled,
           entry.fingerprint == fingerprint {
            do {
                let prepared = try await entry.task.value
                if try await StoryUploadFileFingerprint.read(prepared.video.url) == prepared.fingerprint {
                    MediaPerformance.mark("video_local_preparation_reused")
                    return prepared.video
                }
            } catch is CancellationError { throw CancellationError() }
            catch { /* A failed speculative preparation gets a fresh Post attempt. */ }
        }
        discardLocalPreparation(for: video.url)
        let task = Task { [weak self] () throws -> LocalVideoPreparation in
            guard let self else { throw CancellationError() }
            try await StoryUploadPermitPool.videoPreparation.acquire()
            defer { StoryUploadPermitPool.videoPreparation.release() }
            let prepared = try await StoryVideoUploadNormalizer.prepare(
                url: video.url, source: video.source, maxDurationSeconds: durationLimit,
                adaptiveEncoding: adaptiveEncoding
            )
            do {
                try Task.checkCancellation()
                let result = try await LocalVideoPreparation(
                    video: prepared, fingerprint: StoryUploadFileFingerprint.read(prepared.url)
                )
                try Task.checkCancellation()
                guard try await StoryUploadFileFingerprint.read(video.url) == fingerprint else {
                    throw APIClientError.server("The selected video changed. Please select it again.", 0)
                }
                self.readyPreparations[video.url] = result
                return result
            } catch {
                if prepared.url != video.url { await StoryUploadFileIO.remove([prepared.url]) }
                throw error
            }
        }
        localPreparations[video.url] = PreparationEntry(
            source: source, durationLimit: durationLimit, adaptiveEncodingEnabled: adaptiveEncoding.enabled, fingerprint: fingerprint, task: task
        )
        return try await task.value.video
    }

    private func preparedVideoIfReady(for video: StoryVideoUpload) async -> PreparedStoryVideo? {
        guard let result = readyPreparations[video.url],
              let entry = localPreparations[video.url],
              let sourceFingerprint = try? await StoryUploadFileFingerprint.read(video.url),
              sourceFingerprint == entry.fingerprint,
              let preparedFingerprint = try? await StoryUploadFileFingerprint.read(result.video.url),
              preparedFingerprint == result.fingerprint else { return nil }
        return result.video
    }

    private var thumbnailOverlaySpecs: [StoryThumbnailOverlaySpec] {
        var overlays: [StoryThumbnailOverlaySpec] = []
        let normalizedText = normalizedStoryOverlayText(textOverlay)
        if !normalizedText.isEmpty {
            overlays.append(
                StoryThumbnailOverlaySpec(
                    label: normalizedText,
                    positionX: textOverlayPositionX,
                    positionY: textOverlayPositionY,
                    isLink: false
                )
            )
        }

        if let quotedReply {
            overlays.append(
                StoryThumbnailOverlaySpec(
                    label: quotedReply.message,
                    positionX: quoteReplyPositionX,
                    positionY: quoteReplyPositionY,
                    isLink: false,
                    isQuoteReply: true,
                    actorName: quotedReply.actorName,
                    actorHandle: quotedReply.actorHandle
                )
            )
        }

        let trimmedLinkLabel = linkLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLinkLabel.isEmpty, !normalizedLinkUrl.isEmpty {
            overlays.append(
                StoryThumbnailOverlaySpec(
                    label: trimmedLinkLabel,
                    positionX: linkOverlayPositionX,
                    positionY: linkOverlayPositionY,
                    isLink: true
                )
            )
        }

        return overlays
    }

    private var pendingUploadDraft: PendingStoryUploadDraft {
        PendingStoryUploadDraft(
            caption: caption,
            brandTags: brandTags,
            textOverlay: normalizedStoryOverlayText(textOverlay),
            textOverlayPositionX: textOverlayPositionX,
            textOverlayPositionY: textOverlayPositionY,
            linkLabel: linkLabel,
            linkUrl: normalizedLinkUrl,
            linkOverlayPositionX: linkOverlayPositionX,
            linkOverlayPositionY: linkOverlayPositionY,
            quoteReplyId: quotedReply?.id ?? "",
            quoteReplyPositionX: quoteReplyPositionX,
            quoteReplyPositionY: quoteReplyPositionY
        )
    }

    private var pendingTextOverlays: [StoryTextOverlay] {
        var overlays: [StoryTextOverlay] = []
        let normalizedText = normalizedStoryOverlayText(textOverlay)
        if !normalizedText.isEmpty {
            overlays.append(
                StoryTextOverlay(
                    id: "pending-text-\(UUID().uuidString.lowercased())",
                    label: normalizedText,
                    positionX: textOverlayPositionX,
                    positionY: textOverlayPositionY,
                    kind: "text",
                    href: nil,
                    sourceInteractionId: nil,
                    sourceActorName: nil,
                    sourceActorHandle: nil,
                    sourceActorAvatarUrl: nil
                )
            )
        }

        if let quotedReply {
            overlays.append(
                StoryTextOverlay(
                    id: "pending-quote-\(quotedReply.id)",
                    label: quotedReply.message,
                    positionX: quoteReplyPositionX,
                    positionY: quoteReplyPositionY,
                    kind: "quote_reply",
                    href: nil,
                    sourceInteractionId: quotedReply.id,
                    sourceActorName: quotedReply.actorName,
                    sourceActorHandle: quotedReply.actorHandle,
                    sourceActorAvatarUrl: quotedReply.actorAvatarUrl
                )
            )
        }

        let trimmedLinkLabel = linkLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLinkLabel.isEmpty,
           !normalizedLinkUrl.isEmpty,
           let url = URL(string: normalizedLinkUrl) {
            overlays.append(
                StoryTextOverlay(
                    id: "pending-link-\(UUID().uuidString.lowercased())",
                    label: trimmedLinkLabel,
                    positionX: linkOverlayPositionX,
                    positionY: linkOverlayPositionY,
                    kind: "link",
                    href: url,
                    sourceInteractionId: nil,
                    sourceActorName: nil,
                    sourceActorHandle: nil,
                    sourceActorAvatarUrl: nil
                )
            )
        }

        return overlays
    }

    func upload(
        api: APIClient,
        pendingUploads: PendingStoryUploadStore,
        onPendingUploadStarted: (PendingStoryUpload) -> Void
    ) async -> StoryUploadResponse? {
        guard let selectedMedia else {
            error = "Capture or choose story media first."
            return nil
        }

        error = nil
        lastUploadReport = nil
        normalizeLinkDraft()
        if let validationMessage = draftValidationMessage {
            error = validationMessage
            return nil
        }

        selectionPreparationTask?.cancel()
        isUploading = true
        uploadStatus = "Preparing upload"
        var uploadResponse: StoryUploadResponse?
        var didCreatePendingUpload = false

        do {
            switch selectedMedia {
            case .image(let upload):
                guard MediaControlConfig.shared.storyImageUploadsAvailable else {
                    throw APIClientError.server(
                        "Photo uploads are temporarily unavailable. Video stories still work.",
                        503
                    )
                }
                uploadStatus = "Posting"
                let pendingUpload = try await pendingUploads.createImageUpload(
                    upload: upload,
                    contentMode: upload.contentMode,
                    draft: pendingUploadDraft,
                    textOverlays: pendingTextOverlays,
                    submittedAt: Date()
                )
                didCreatePendingUpload = true
                onPendingUploadStarted(pendingUpload)
                clearUploadedDraft()
                uploadResponse = try await pendingUploads.performUpload(id: pendingUpload.id, api: api)
            case .video(let video):
                uploadResponse = try await uploadVideoStory(
                    video: video,
                    api: api,
                    pendingUploads: pendingUploads,
                    onPendingUploadStarted: { pendingUpload in
                        didCreatePendingUpload = true
                        onPendingUploadStarted(pendingUpload)
                    }
                )
            }

            uploadStatus = uploadResponse?.processingStatus == "ready" ? "Story posted" : "Upload complete"
            api.invalidateMobileFeedCache()
            api.invalidateStoryStacks(ids: ["my-story"])
            clearUploadedDraft()
        } catch {
            uploadStatus = nil
            if didCreatePendingUpload {
                self.error = nil
            } else {
                self.error = error.localizedDescription
            }
            if let lastUploadReport {
                MediaPerformance.mark("video_upload_failed report=\(lastUploadReport)")
            }
        }

        isUploading = false
        if self.selectedMedia == nil { prepareSelectionLocally([]) }
        return uploadResponse
    }

    func uploadBatch(
        media: [PickedStoryMedia],
        api: APIClient,
        pendingUploads: PendingStoryUploadStore,
        onPendingBatchStarted: () -> Void,
        onUploadRegistered: @escaping (StoryUploadResponse) -> Void
    ) async -> Bool {
        guard (2...10).contains(media.count) else {
            error = "Choose between two and ten items for a batch."
            return false
        }

        error = nil
        lastUploadReport = nil
        normalizeLinkDraft()
        if let validationMessage = draftValidationMessage {
            error = validationMessage
            return false
        }

        selectionPreparationTask?.cancel()
        isUploading = true
        let submittedAt = Date()
        let batchId = UUID().uuidString.lowercased()
        pendingUploads.beginBatch(batchId, totalCount: media.count)
        var stagedUploads: [PendingStoryUpload] = []
        var failedPreparationCount = 0
        let transfers = StoryBatchTransferQueue(maxConcurrentPhotos:
            NetworkQualityMonitor.shared.isLimitedPath || UBEYEResourceMonitor.shared.mode != .standard ? 1 : 2)
        let batchDraft = pendingUploadDraft
        let batchTextOverlays = pendingTextOverlays

        for (offset, item) in media.enumerated() {
            uploadStatus = "Saving your stories…"
            do {
                let pendingUpload = try await createPendingBatchUpload(
                    item,
                    batchId: batchId,
                    batchPosition: offset + 1,
                    batchCount: media.count,
                    draft: batchDraft,
                    textOverlays: batchTextOverlays,
                    submittedAt: submittedAt,
                    pendingUploads: pendingUploads
                )
                stagedUploads.append(pendingUpload)
                // The durable manifest owns this item before network work starts.
                // Prepared metadata is resolved by the upload store after the
                // original and draft have become durable.
                transfers.enqueue(assetKind: pendingUpload.assetKind) { beforeCompletion in
                    do {
                        let response = try await pendingUploads.performUpload(
                            id: pendingUpload.id,
                            api: api,
                            beforeCompletion: beforeCompletion
                        )
                        // Root's registration callback navigates home. Keep the
                        // producer visible until every selected item is staged.
                        transfers.registerAfterPreparation {
                            onUploadRegistered(response)
                        }
                    } catch {
                        MediaPerformance.mark(
                            "story_batch_upload_failed id=\(pendingUpload.id) error=\(error.localizedDescription)"
                        )
                    }
                }
            } catch {
                failedPreparationCount += 1
                if case .video(let video) = item {
                    await StoryUploadFileIO.remove([video.url])
                }
                MediaPerformance.mark(
                    "story_batch_prepare_failed position=\(offset + 1) error=\(error.localizedDescription)"
                )
            }
        }

        pendingUploads.finishBatchPreparation(batchId)
        guard !stagedUploads.isEmpty else {
            isUploading = false
            uploadStatus = nil
            error = MediaControlConfig.shared.storyImageUploadsAvailable
                ? "Could not prepare those stories. Try different photos or videos."
                : "Photo uploads are temporarily unavailable. Video stories still work."
            return false
        }

        clearUploadedDraft()
        isUploading = false
        prepareSelectionLocally([])
        uploadStatus = nil
        onPendingBatchStarted()
        transfers.finishPreparation()

        if failedPreparationCount > 0 {
            MediaPerformance.mark(
                "story_batch_prepare_partial prepared=\(stagedUploads.count) failed=\(failedPreparationCount)"
            )
        }

        return true
    }

    private func createPendingBatchUpload(
        _ media: PickedStoryMedia,
        batchId: String,
        batchPosition: Int,
        batchCount: Int,
        draft: PendingStoryUploadDraft,
        textOverlays: [StoryTextOverlay],
        submittedAt: Date,
        pendingUploads: PendingStoryUploadStore
    ) async throws -> PendingStoryUpload {
        switch media {
        case .image(let upload):
            guard MediaControlConfig.shared.storyImageUploadsAvailable else {
                throw APIClientError.server(
                    "Photo uploads are temporarily unavailable. Video stories still work.",
                    503
                )
            }
            return try await pendingUploads.createImageUpload(
                upload: upload,
                contentMode: upload.contentMode,
                draft: draft,
                textOverlays: textOverlays,
                submittedAt: submittedAt,
                batchId: batchId,
                batchPosition: batchPosition,
                batchCount: batchCount
            )
        case .video(let video):
            let draftUpload = await readyDraftUpload(for: video)
            let transfer = draftUpload == nil ? await transferableDraftUpload(for: video) : nil
            let localReady = await preparedVideoIfReady(for: video)
            let ready = draftUpload?.video ?? transfer?.video ?? localReady
            let pending = try await pendingUploads.createSubmittedVideoUpload(
                sourceURL: video.url, source: video.source, preparedVideo: ready,
                draftUpload: draftUpload, draftTransfer: transfer,
                draft: draft, textOverlays: textOverlays, submittedAt: submittedAt,
                batchId: batchId, batchPosition: batchPosition, batchCount: batchCount
            )
            if draftUpload != nil { finishDraftAdoption(for: video.url) }
            else if transfer != nil { draftUploads[video.url] = nil; readyDraftUploads[video.url] = nil }
            else if let api = draftUploadAPI { discardDraftUpload(for: video.url, api: api) }
            discardLocalPreparation(for: video.url)
            await StoryUploadFileIO.remove([video.url])
            return pending
        }
    }

    private func uploadVideoStory(
        video: StoryVideoUpload, api: APIClient, pendingUploads: PendingStoryUploadStore,
        onPendingUploadStarted: (PendingStoryUpload) -> Void
    ) async throws -> StoryUploadResponse {
        let submittedAt = Date()
        let draftUpload = await readyDraftUpload(for: video)
        let transfer = draftUpload == nil ? await transferableDraftUpload(for: video) : nil
        let localReady = await preparedVideoIfReady(for: video)
        let ready = draftUpload?.video ?? transfer?.video ?? localReady
        let pending = try await pendingUploads.createSubmittedVideoUpload(
            sourceURL: video.url, source: video.source, preparedVideo: ready,
            draftUpload: draftUpload, draftTransfer: transfer,
            draft: pendingUploadDraft, textOverlays: pendingTextOverlays, submittedAt: submittedAt
        )
        if draftUpload != nil { finishDraftAdoption(for: video.url) }
        else if transfer != nil { draftUploads[video.url] = nil; readyDraftUploads[video.url] = nil }
        else if let api = draftUploadAPI { discardDraftUpload(for: video.url, api: api) }
        discardLocalPreparation(for: video.url)
        await StoryUploadFileIO.remove([video.url])
        onPendingUploadStarted(pending)
        clearUploadedDraft()
        return try await pendingUploads.performUpload(id: pending.id, api: api)
    }

    private func videoThumbnailData(
        for url: URL,
        overlays: [StoryThumbnailOverlaySpec]
    ) async throws -> Data {
        do {
            return try await withThrowingTaskGroup(of: Data.self) { group in
                group.addTask {
                    try await self.generateVideoThumbnailData(
                        for: url,
                        overlays: overlays
                    )
                }
                group.addTask {
                    try await Task.sleep(nanoseconds: 3_000_000_000)
                    throw APIClientError.server("Could not prepare video thumbnail. Try a different video.", 0)
                }

                guard let data = try await group.next() else {
                    throw APIClientError.server("Could not prepare video thumbnail. Try a different video.", 0)
                }

                group.cancelAll()
                return data
            }
        } catch {
            MediaPerformance.mark("video_thumbnail_generation_failed")
            throw error
        }
    }

    private func generateVideoThumbnailData(
        for url: URL,
        overlays: [StoryThumbnailOverlaySpec]
    ) async throws -> Data {
        let image = try await StoryVideoThumbnailGenerator.firstFrame(for: url)
        // Story overlays are rendered by the viewer. Keeping this fallback image
        // clean prevents the thumbnail caption from appearing underneath the
        // live caption while a video is loading.
        let thumbnail = UIImage(cgImage: image)

        let maxThumbnailBytes = 2 * 1024 * 1024
        let preferredData = thumbnail.jpegData(compressionQuality: 0.9)
        let fallbackData = thumbnail.jpegData(compressionQuality: 0.82)
        let data = [preferredData, fallbackData]
            .compactMap { $0 }
            .first { !$0.isEmpty && $0.count <= maxThumbnailBytes }

        guard let data else {
            throw APIClientError.server("Could not prepare video thumbnail. Try a different video.", 0)
        }

        return data
    }

    private func compositedThumbnailImage(
        baseImage: UIImage,
        overlays: [StoryThumbnailOverlaySpec]
    ) -> UIImage {
        let visibleOverlays = overlays.filter {
            !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        guard !visibleOverlays.isEmpty else {
            return baseImage
        }

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let size = baseImage.size
        let renderer = UIGraphicsImageRenderer(size: size, format: format)

        return renderer.image { context in
            baseImage.draw(in: CGRect(origin: .zero, size: size))

            for overlay in visibleOverlays.prefix(2) {
                drawThumbnailOverlay(overlay, in: size, context: context.cgContext)
            }
        }
    }

    private func drawThumbnailOverlay(
        _ overlay: StoryThumbnailOverlaySpec,
        in canvasSize: CGSize,
        context: CGContext
    ) {
        let scale = max(canvasSize.width / 390, 1)
        if overlay.isQuoteReply {
            drawThumbnailQuoteReplyOverlay(overlay, in: canvasSize, scale: scale, context: context)
            return
        }

        let fontSize = min(max(StoryTextOverlayAppearance.fontSize * scale, 22), 40)
        let horizontalPadding = StoryTextOverlayAppearance.horizontalPadding * scale
        let verticalPadding = StoryTextOverlayAppearance.verticalPadding * scale
        let maxTextWidth = max(canvasSize.width - 72 * scale, 120)
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .center
        paragraphStyle.lineBreakMode = .byWordWrapping
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: fontSize, weight: .regular),
            .kern: StoryTextOverlayAppearance.letterSpacing * scale,
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle,
        ]
        let label = overlay.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = overlay.isLink ? "\(label)" : label
        let textRect = (text as NSString).boundingRect(
            with: CGSize(width: maxTextWidth, height: canvasSize.height),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attributes,
            context: nil
        )
        let chipSize = CGSize(
            width: min(max(textRect.width + horizontalPadding * 2, 70 * scale), canvasSize.width - 32 * scale),
            height: textRect.height + verticalPadding * 2
        )
        let rawCenter = CGPoint(
            x: canvasSize.width * CGFloat(min(max(overlay.positionX, 0), 100) / 100),
            y: canvasSize.height * CGFloat(min(max(overlay.positionY, 0), 100) / 100)
        )
        let center = CGPoint(
            x: min(max(rawCenter.x, chipSize.width / 2 + 8 * scale), canvasSize.width - chipSize.width / 2 - 8 * scale),
            y: min(max(rawCenter.y, chipSize.height / 2 + 8 * scale), canvasSize.height - chipSize.height / 2 - 8 * scale)
        )
        let chipRect = CGRect(
            x: center.x - chipSize.width / 2,
            y: center.y - chipSize.height / 2,
            width: chipSize.width,
            height: chipSize.height
        )

        context.saveGState()
        UIColor.black.withAlphaComponent(0.46).setFill()
        UIBezierPath(
            roundedRect: chipRect,
            cornerRadius: StoryTextOverlayAppearance.cornerRadius * scale
        ).fill()
        context.restoreGState()

        let labelRect = CGRect(
            x: chipRect.minX + horizontalPadding,
            y: chipRect.minY + verticalPadding,
            width: chipRect.width - horizontalPadding * 2,
            height: chipRect.height - verticalPadding * 2
        )
        (text as NSString).draw(with: labelRect, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
    }

    private func drawThumbnailQuoteReplyOverlay(
        _ overlay: StoryThumbnailOverlaySpec,
        in canvasSize: CGSize,
        scale: CGFloat,
        context: CGContext
    ) {
        let name = (overlay.actorName ?? "Reply").trimmingCharacters(in: .whitespacesAndNewlines)
        let handle = overlay.actorHandle?.trimmingCharacters(in: .whitespacesAndNewlines)
        let message = overlay.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let cardWidth = min(max(canvasSize.width * 0.72, 240 * scale), canvasSize.width - 32 * scale)
        let horizontalPadding = 12 * scale
        let verticalPadding = 10 * scale
        let avatarSize = 22 * scale
        let titleFont = min(max(11 * scale, 14), 25)
        let handleFont = min(max(9 * scale, 12), 20)
        let messageFont = min(max(13 * scale, 17), 30)
        let textWidth = cardWidth - horizontalPadding * 2
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .left
        paragraphStyle.lineBreakMode = .byTruncatingTail
        let nameAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: titleFont, weight: .semibold),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle,
        ]
        let handleAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: handleFont, weight: .regular),
            .foregroundColor: UIColor.white.withAlphaComponent(0.72),
            .paragraphStyle: paragraphStyle,
        ]
        let messageAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: messageFont, weight: .medium),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle,
        ]
        let messageRect = (message as NSString).boundingRect(
            with: CGSize(width: textWidth, height: messageFont * 2.5),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: messageAttributes,
            context: nil
        )
        let headerHeight = max(avatarSize, titleFont + (handle?.isEmpty == false ? handleFont : 0) + 2 * scale)
        let cardHeight = verticalPadding * 2 + headerHeight + 8 * scale + messageRect.height
        let rawCenter = CGPoint(
            x: canvasSize.width * CGFloat(min(max(overlay.positionX, 0), 100) / 100),
            y: canvasSize.height * CGFloat(min(max(overlay.positionY, 0), 100) / 100)
        )
        let center = CGPoint(
            x: min(max(rawCenter.x, cardWidth / 2 + 8 * scale), canvasSize.width - cardWidth / 2 - 8 * scale),
            y: min(max(rawCenter.y, cardHeight / 2 + 8 * scale), canvasSize.height - cardHeight / 2 - 8 * scale)
        )
        let cardRect = CGRect(
            x: center.x - cardWidth / 2,
            y: center.y - cardHeight / 2,
            width: cardWidth,
            height: cardHeight
        )

        context.saveGState()
        UIColor.black.withAlphaComponent(0.68).setFill()
        UIBezierPath(roundedRect: cardRect, cornerRadius: 8 * scale).fill()
        UIColor.white.withAlphaComponent(0.18).setStroke()
        UIBezierPath(roundedRect: cardRect, cornerRadius: 8 * scale).stroke()
        UIColor(red: 224 / 255, green: 22 / 255, blue: 22 / 255, alpha: 1).setFill()
        UIBezierPath(ovalIn: CGRect(
            x: cardRect.minX + horizontalPadding,
            y: cardRect.minY + verticalPadding,
            width: avatarSize,
            height: avatarSize
        )).fill()
        context.restoreGState()

        let initial = name.first.map { String($0).uppercased() } ?? "R"
        let initialAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: max(avatarSize * 0.48, 10), weight: .black),
            .foregroundColor: UIColor.white,
        ]
        let avatarRect = CGRect(
            x: cardRect.minX + horizontalPadding,
            y: cardRect.minY + verticalPadding,
            width: avatarSize,
            height: avatarSize
        )
        let initialSize = (initial as NSString).size(withAttributes: initialAttributes)
        (initial as NSString).draw(
            at: CGPoint(x: avatarRect.midX - initialSize.width / 2, y: avatarRect.midY - initialSize.height / 2),
            withAttributes: initialAttributes
        )

        let titleX = avatarRect.maxX + 7 * scale
        let titleWidth = cardRect.maxX - horizontalPadding - titleX
        (name as NSString).draw(
            with: CGRect(x: titleX, y: cardRect.minY + verticalPadding - 1 * scale, width: titleWidth, height: titleFont + 3 * scale),
            options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
            attributes: nameAttributes,
            context: nil
        )
        if let handle, !handle.isEmpty {
            ("@\(handle)" as NSString).draw(
                with: CGRect(x: titleX, y: cardRect.minY + verticalPadding + titleFont + 1 * scale, width: titleWidth, height: handleFont + 3 * scale),
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                attributes: handleAttributes,
                context: nil
            )
        }

        (message as NSString).draw(
            with: CGRect(
                x: cardRect.minX + horizontalPadding,
                y: cardRect.minY + verticalPadding + headerHeight + 8 * scale,
                width: textWidth,
                height: messageRect.height
            ),
            options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
            attributes: messageAttributes,
            context: nil
        )
    }

    var normalizedLinkUrl: String {
        normalizedUrlString(linkUrl)
    }

    func normalizeLinkDraft() {
        linkUrl = normalizedLinkUrl
        if linkLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            linkLabel = linkHostLabel(from: linkUrl)
        }
    }

    private var draftValidationMessage: String? {
        if caption.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > StoryComposerLimits.caption {
            return "Captions must be \(StoryComposerLimits.caption) characters or fewer."
        }

        if textOverlay.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > StoryComposerLimits.textOverlay {
            return "Story text must be \(StoryComposerLimits.textOverlay) characters or fewer."
        }

        let resolvedLinkURL = normalizedLinkUrl
        if !resolvedLinkURL.isEmpty {
            if resolvedLinkURL.utf16.count > StoryComposerLimits.linkURL || URL(string: resolvedLinkURL) == nil {
                return "Enter a valid link up to \(StoryComposerLimits.linkURL) characters."
            }
            if linkLabel.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > StoryComposerLimits.linkLabel {
                return "Link labels must be \(StoryComposerLimits.linkLabel) characters or fewer."
            }
        }

        let rawBrandTags = brandTags.components(
            separatedBy: CharacterSet(charactersIn: ",\n")
        ).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter {
            !$0.isEmpty
        }
        for rawBrandTag in rawBrandTags {
            let normalizedBrandTag = rawBrandTag
                .lowercased()
                .replacingOccurrences(
                    of: "^[@#]+",
                    with: "",
                    options: .regularExpression
                )
                .replacingOccurrences(
                    of: "[^a-z0-9._-]+",
                    with: "-",
                    options: .regularExpression
                )
                .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
            guard (2...StoryComposerLimits.brandTag).contains(normalizedBrandTag.utf16.count) else {
                return "Each brand tag must be 2–\(StoryComposerLimits.brandTag) characters."
            }
        }

        return nil
    }

    func applyQuotedReply(_ quote: QuotedStoryReply?) {
        guard quotedReply != quote else {
            return
        }

        quotedReply = quote
        quoteReplyPositionX = 50
        quoteReplyPositionY = 58
    }

    func clearQuotedReply() {
        quotedReply = nil
        quoteReplyPositionX = 50
        quoteReplyPositionY = 58
    }

    private func clearUploadedDraft() {
        caption = ""
        brandTags = ""
        textOverlay = ""
        textOverlayPositionX = 50
        textOverlayPositionY = 68
        linkUrl = ""
        linkLabel = ""
        linkOverlayPositionX = 50
        linkOverlayPositionY = 78
        clearQuotedReply()
        selectedMedia = nil
        UserDefaults.standard.removeObject(forKey: Self.textDraftKey)
    }

    private func normalizedUrlString(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return ""
        }

        if trimmed.contains("://") {
            return trimmed
        }

        return "https://\(trimmed)"
    }

    private func linkHostLabel(from value: String) -> String {
        guard let url = URL(string: value),
              let host = url.host?.replacingOccurrences(of: "www.", with: ""),
              !host.isEmpty else {
            return "Link"
        }

        return host
    }
}

private enum StoryComposerChromeAppearance {
    static let controlSize: CGFloat = 42
    static let controlBackgroundOpacity = 0.30
    static let pillBackgroundOpacity = 0.36
    static let borderOpacity = 0.16
    static let borderWidth: CGFloat = 0.75
}

private struct StoryComposerCircularChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(.white.opacity(0.94))
            .frame(
                width: StoryComposerChromeAppearance.controlSize,
                height: StoryComposerChromeAppearance.controlSize
            )
            .background(
                .black.opacity(StoryComposerChromeAppearance.controlBackgroundOpacity),
                in: Circle()
            )
            .overlay(
                Circle()
                    .stroke(
                        .white.opacity(StoryComposerChromeAppearance.borderOpacity),
                        lineWidth: StoryComposerChromeAppearance.borderWidth
                    )
            )
            .contentShape(Circle())
    }
}

private struct StoryComposerPillChrome: ViewModifier {
    let backgroundOpacity: Double

    func body(content: Content) -> some View {
        content
            .background(.black.opacity(backgroundOpacity), in: Capsule())
            .overlay(
                Capsule()
                    .stroke(
                        .white.opacity(StoryComposerChromeAppearance.borderOpacity),
                        lineWidth: StoryComposerChromeAppearance.borderWidth
                    )
            )
    }
}

private extension View {
    func storyComposerCircularChrome() -> some View {
        modifier(StoryComposerCircularChrome())
    }

    func storyComposerPillChrome(
        backgroundOpacity: Double = StoryComposerChromeAppearance.pillBackgroundOpacity
    ) -> some View {
        modifier(StoryComposerPillChrome(backgroundOpacity: backgroundOpacity))
    }
}

struct StoryComposerView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var pendingStoryUploads: PendingStoryUploadStore
    @StateObject private var camera = CameraController()
    @StateObject private var store = StoryComposerStore()
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @StateObject private var librarySelection = StoryLibrarySelectionLoader()
    @State private var selectedBatchMedia: [PickedStoryMedia] = []
    @State private var overlayInputMode: ComposerOverlayInputMode?
    @State private var recordingStartedAt = Date()
    @State private var recordingElapsed: TimeInterval = 0
    @State private var latestLibraryThumbnail: UIImage?
    @State private var stagedMedia: PickedStoryMedia?
    @State private var composerKeyboardHeight: CGFloat = 0
    @State private var overlayFocusRequestAt: Date?
    @FocusState private var isOverlayInputFocused: Bool
    let isActive: Bool
    let quotedReply: QuotedStoryReply?
    var clearQuotedReply: () -> Void = {}
    var onPendingUploadStarted: () -> Void = {}
    var onUploadRegistered: (StoryUploadResponse) -> Void = { _ in }

    private let maxVideoSegments = 6
    private let videoSegmentDuration: TimeInterval = 10
    private let footerSideControlSize: CGFloat = 58
    private let footerShutterSlotSize: CGFloat = 88
    private var maxRecordingDuration: TimeInterval { TimeInterval(maxVideoSegments) * videoSegmentDuration }
    private let recordingTimer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.ignoresSafeArea()

                mediaPreview
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
                    .overlay(Color.black.opacity(0.18))
                    .overlay {
                        positionedComposerOverlay(in: geometry.size)
                    }
                    .simultaneousGesture(cameraZoomGesture)

                VStack(spacing: 0) {
                    ZStack(alignment: .top) {
                        Label(
                            selectedBatchMedia.count > 1
                                ? "\(selectedBatchMedia.count) stories"
                                : "Story",
                            systemImage: "camera"
                        )
                            .font(.system(size: 15, weight: .regular))
                            .padding(.horizontal, 14)
                            .frame(height: 38)
                            .storyComposerPillChrome(backgroundOpacity: 0.30)

                        HStack(alignment: .top) {
                            if hasSelectedMedia || librarySelection.isLoading {
                                Button {
                                    UBEYEFeedback.selection()
                                    resetCapture(clearQuote: true)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 18, weight: .medium))
                                        .storyComposerCircularChrome()
                                }
                                .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
                                .accessibilityLabel("Discard captured story")
                                .transition(.scale.combined(with: .opacity))
                            }

                            Spacer()

                            VStack(spacing: 8) {
                                TopAvatarSpacer()

                                if stagedMedia == nil {
                                    Button {
                                        UBEYEFeedback.impact(.light)
                                        camera.switchCamera()
                                    } label: {
                                        Image(systemName: "camera.rotate")
                                            .font(.system(size: 17, weight: .medium))
                                            .storyComposerCircularChrome()
                                    }
                                    .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
                                    .disabled(camera.isRecording || camera.isCapturingPhoto)
                                } else if selectedBatchMedia.count <= 1 {
                                    composerToolRail
                                }
                            }
                        }
                    }
                    .padding(.horizontal, UBEYEMetrics.screenInset)
                    .padding(.top, 14)

                    Spacer()

                    if librarySelection.isLoading {
                        HStack(spacing: 8) {
                            ProgressView().tint(.white)
                            Text(librarySelection.totalCount > 1
                                 ? "Loading media \(min(librarySelection.completedCount + 1, librarySelection.totalCount)) of \(librarySelection.totalCount)"
                                 : "Loading selected media")
                        }
                        .font(.system(size: 14))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .storyComposerPillChrome()
                        .padding(.bottom, 16)
                    } else if let uploadStatus = store.uploadStatus {
                        Text(uploadStatus)
                            .font(.system(size: 13, weight: .regular))
                            .tracking(0.1)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .storyComposerPillChrome()
                            .padding(.bottom, 16)
                    } else if let error = store.error ?? (stagedMedia == nil ? camera.error : nil) {
                        Text(error)
                            .font(.system(size: 14, weight: .medium))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.ubeyeRed.opacity(0.9), in: Capsule())
                            .padding(.horizontal, 22)
                            .padding(.bottom, 16)
                    } else if camera.isCapturingPhoto {
                        Text("Preparing photo")
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(.white.opacity(0.76))
                            .padding(.bottom, 24)
                    } else if stagedMedia == nil {
                        Text("Tap for photo, hold for video")
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(.white.opacity(0.72))
                            .padding(.bottom, 24)
                    }

                    composerFooter
                        .padding(.horizontal, 28)
                        .padding(.bottom, 28)
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .foregroundStyle(.white)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .task {
            store.beginPresentation()
            store.applyQuotedReply(quotedReply)
            if isActive {
                store.resumeEarlyUpload(api: api, media: selectedBatchMedia.isEmpty ? store.selectedMedia.map { [$0] } ?? [] : selectedBatchMedia)
                await camera.requestAccessAndConfigure()
            }
            await refreshLatestLibraryThumbnail()
            applyLayoutFixtureIfRequested()
        }
        .onChange(of: isActive) { _, nextIsActive in
            if nextIsActive {
                store.beginPresentation()
                store.resumeEarlyUpload(api: api, media: selectedBatchMedia.isEmpty ? store.selectedMedia.map { [$0] } ?? [] : selectedBatchMedia)
                camera.start()
            } else {
                librarySelection.cancel()
                store.suspendEarlyUpload(api: api)
                camera.stop()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NetworkQualityMonitor.playbackBudgetChanged)) { _ in
            guard isActive, !store.isUploading else { return }
            store.resumeEarlyUpload(api: api, media: framingMedia)
        }
        .onChange(of: quotedReply) { _, quote in
            store.applyQuotedReply(quote)
        }
        .onDisappear {
            librarySelection.cancel()
            store.suspendEarlyUpload(api: api)
            store.persistTextDraft()
            camera.stop()
        }
        .onReceive(store.objectWillChange) { _ in
            Task { @MainActor in
                await Task.yield()
                store.persistTextDraft()
            }
        }
        .onChange(of: photoPickerItems) { _, items in
            guard !items.isEmpty else { return }
            loadPickedItems(items)
            // Clear only this submitted picker selection, never a newer request
            // from an older import task's deferred completion.
            photoPickerItems = []
        }
        .onChange(of: camera.capturedPhoto) { _, photo in
            if let photo {
                enterComposer(with: .image(photo))
            }
        }
        .onChange(of: camera.capturedVideoURL) { _, url in
            if let url {
                let source: StoryVideoUpload.Source = camera.capturedVideoCameraPosition == .front ? .cameraFront : .cameraBack
                enterComposer(with: .video(StoryVideoUpload(url: url, source: source)))
                recordingElapsed = 0
            }
        }
        .onReceive(recordingTimer) { now in
            updateRecordingProgress(now: now)
        }
        .onChange(of: isOverlayInputFocused) { _, isFocused in
            if !isFocused {
                finishOverlayInput()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
            updateComposerKeyboard(from: notification)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { notification in
            updateComposerKeyboard(from: notification, forcedHeight: 0)
        }
    }

    @ViewBuilder
    private var composerFooter: some View {
        VStack(spacing: 12) {
            Group {
                if stagedMedia == nil {
                    captureFooter
                } else {
                    selectedMediaFooter
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: footerShutterSlotSize)
    }

    private var captureFooter: some View {
        HStack {
            PhotosPicker(
                selection: $photoPickerItems,
                maxSelectionCount: quotedReply == nil ? 10 : 1,
                selectionBehavior: .ordered,
                matching: .any(of: [.images, .videos]),
                preferredItemEncoding: .current
            ) {
                LibraryPickerThumbnail(image: latestLibraryThumbnail)
            }
            .disabled(store.isUploading || camera.isCapturingPhoto || camera.isRecording)

            Spacer()

            StoryShutterButton(
                isRecording: camera.isRecording,
                progress: recordingProgress,
                segmentCount: recordingSegmentCount,
                maxSegments: maxVideoSegments,
                capturePhoto: capturePhoto,
                startRecording: startRecording,
                stopRecording: stopRecording
            )
            .disabled(store.isUploading || librarySelection.isLoading)

            Spacer()

            footerPlaceholder(size: footerSideControlSize)
        }
    }

    private var cameraZoomGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                guard stagedMedia == nil,
                      store.selectedMedia == nil,
                      camera.authorizationStatus == .authorized else {
                    return
                }

                camera.updateZoomGesture(magnification: value.magnification)
            }
            .onEnded { _ in
                camera.endZoomGesture()
            }
    }

    private var selectedMediaFooter: some View {
        HStack(spacing: 0) {
            if selectedBatchMedia.count > 1 {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(selectedBatchMedia.count) separate stories")
                        .font(.system(size: 14, weight: .medium))
                    Text("They’ll upload in the background")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.white.opacity(0.68))
                }
            }

            Spacer(minLength: 0)
            uploadStoryButton
        }
    }

    private var framingMedia: [PickedStoryMedia] {
        if !selectedBatchMedia.isEmpty {
            return selectedBatchMedia
        }
        return (stagedMedia ?? store.selectedMedia).map { [$0] } ?? []
    }

    private var hasSelectedMedia: Bool {
        (stagedMedia ?? store.selectedMedia) != nil
    }

    private func footerPlaceholder(size: CGFloat) -> some View {
        Color.clear
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    private var uploadStoryButton: some View {
        Button {
            UBEYEFeedback.impact(.medium)
            Task {
                await uploadSelectedMedia()
            }
        } label: {
            HStack(spacing: 7) {
                uploadButtonIcon
                if selectedBatchMedia.count > 1 {
                    Text("Post \(selectedBatchMedia.count)")
                        .font(.system(size: 14, weight: .medium))
                }
            }
            .foregroundStyle(.white)
            .frame(
                width: selectedBatchMedia.count > 1 ? 104 : footerSideControlSize,
                height: footerSideControlSize
            )
            .storyComposerPillChrome(backgroundOpacity: 0.42)
        }
        .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
        .disabled(store.isUploading)
        .accessibilityLabel(
            selectedBatchMedia.count > 1
                ? "Upload \(selectedBatchMedia.count) separate stories"
                : "Upload story"
        )
        .accessibilityIdentifier("story-composer-upload-button")
    }

    private var uploadButtonIcon: some View {
        Image(systemName: store.isUploading ? "hourglass" : "paperplane")
            .font(.system(size: 20, weight: .medium))
    }

    private var composerToolRail: some View {
        VStack(spacing: 8) {
            Button {
                UBEYEFeedback.selection()
                openOverlayInput(.text)
            } label: {
                Text("Aa")
                    .font(.system(size: 18, weight: .regular))
                    .tracking(-0.25)
                    .storyComposerCircularChrome()
            }
            .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
            .accessibilityLabel("Add text overlay")

            Button {
                UBEYEFeedback.selection()
                openOverlayInput(.link)
            } label: {
                Image(systemName: "link")
                    .font(.system(size: 18, weight: .regular))
                    .storyComposerCircularChrome()
            }
            .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
            .accessibilityLabel("Add link overlay")
        }
    }

    @ViewBuilder
    private var composerOverlayLayer: some View {
        if stagedMedia != nil {
            GeometryReader { proxy in
                if overlayInputMode == .text || !store.textOverlay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    EditableStoryOverlayChip(
                        text: $store.textOverlay,
                        maximumLength: StoryComposerLimits.textOverlay,
                        normalizesWhitespace: true,
                        placeholder: "Text",
                        systemImage: nil,
                        positionX: store.textOverlayPositionX,
                        positionY: store.textOverlayPositionY,
                        size: proxy.size,
                        displayText: nil,
                        isEditing: overlayInputMode == .text,
                        isFocused: $isOverlayInputFocused,
                        keyboardType: .default,
                        autocapitalization: .sentences,
                        autocorrectionDisabled: false,
                        keyboardHeight: composerKeyboardHeight,
                        onSubmit: finishOverlayInput,
                        onTapToEdit: {
                            openOverlayInput(.text)
                        }
                    ) { x, y in
                        store.textOverlayPositionX = x
                        store.textOverlayPositionY = y
                    }
                }

                if overlayInputMode == .link || !store.normalizedLinkUrl.isEmpty {
                    EditableStoryOverlayChip(
                        text: $store.linkUrl,
                        maximumLength: StoryComposerLimits.linkURL,
                        normalizesWhitespace: false,
                        placeholder: "Paste link",
                        systemImage: "link",
                        positionX: store.linkOverlayPositionX,
                        positionY: store.linkOverlayPositionY,
                        size: proxy.size,
                        displayText: store.linkLabel.isEmpty ? nil : store.linkLabel,
                        isEditing: overlayInputMode == .link,
                        isFocused: $isOverlayInputFocused,
                        keyboardType: .URL,
                        autocapitalization: .never,
                        autocorrectionDisabled: true,
                        keyboardHeight: composerKeyboardHeight,
                        onSubmit: finishOverlayInput,
                        onTapToEdit: {
                            openOverlayInput(.link)
                        }
                    ) { x, y in
                        store.linkOverlayPositionX = x
                        store.linkOverlayPositionY = y
                    }
                }

                if let quotedReply = store.quotedReply {
                    DraggableQuoteReplyOverlay(
                        quote: quotedReply,
                        positionX: store.quoteReplyPositionX,
                        positionY: store.quoteReplyPositionY,
                        size: proxy.size,
                        clear: clearCurrentQuotedReply
                    ) { x, y in
                        store.quoteReplyPositionX = x
                        store.quoteReplyPositionY = y
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func positionedComposerOverlay(in containerSize: CGSize) -> some View {
        if hasSelectedMedia {
            let canvasLayout = StoryCanvasLayout(containerSize: containerSize)
            composerOverlayLayer
                .storyCanvasFrame(canvasLayout)
        } else {
            composerOverlayLayer
        }
    }

    private func openOverlayInput(_ mode: ComposerOverlayInputMode) {
        guard stagedMedia != nil else {
            return
        }

        overlayInputMode = mode
        overlayFocusRequestAt = Date()
        UBEYEFeedback.prepare(.selection)
        Task {
            try? await Task.sleep(for: .milliseconds(120))
            await MainActor.run {
                isOverlayInputFocused = true
            }
        }
    }

    private func finishOverlayInput() {
        let finishingMode = overlayInputMode
        let finishingFocusRequestAt = overlayFocusRequestAt
        isOverlayInputFocused = false

        // Resigning the first responder can deliver one final TextField binding
        // update (autocorrection, smart spacing, or a deletion). Keep the editor
        // alive through that update before snapshotting the draft for upload.
        Task { @MainActor in
            await Task.yield()
            guard overlayInputMode == finishingMode,
                  overlayFocusRequestAt == finishingFocusRequestAt else {
                return
            }
            if finishingMode == .link {
                store.normalizeLinkDraft()
            }
            store.persistTextDraft()
            overlayInputMode = nil
        }
    }

    private func updateComposerKeyboard(
        from notification: Notification,
        forcedHeight: CGFloat? = nil
    ) {
        let measuredHeight: CGFloat
        if let forcedHeight {
            measuredHeight = forcedHeight
        } else if let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
            measuredHeight = max(0, UIScreen.main.bounds.maxY - frame.minY)
        } else {
            return
        }

        let height = measuredHeight > 1 ? measuredHeight : 0
        if height > 0, let overlayFocusRequestAt {
            MediaPerformance.measure(
                "keyboard_latency surface=story_composer phase=will_change_frame",
                since: overlayFocusRequestAt
            )
            self.overlayFocusRequestAt = nil
        }
        let duration = (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
        withAnimation(.easeOut(duration: duration)) {
            composerKeyboardHeight = height
        }
    }

    private func clearCurrentQuotedReply() {
        store.clearQuotedReply()
        clearQuotedReply()
    }

    @ViewBuilder
    private var mediaStage: some View {
        ZStack(alignment: .bottom) {
            mediaPreview
                .frame(height: 520)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color.ubeyeBorder, lineWidth: 1)
                )

            HStack(spacing: 18) {
                PhotosPicker(
                    selection: $photoPickerItems,
                    maxSelectionCount: quotedReply == nil ? 10 : 1,
                    selectionBehavior: .ordered,
                    matching: .any(of: [.images, .videos]),
                    preferredItemEncoding: .current
                ) {
                    Image(systemName: "photo.on.rectangle")
                        .font(.title2)
                        .frame(width: 54, height: 54)
                        .background(.black.opacity(0.45), in: Circle())
                }

                Button {
                    camera.capturePhoto()
                    if let photo = camera.capturedPhoto {
                        store.selectedMedia = .image(photo)
                    }
                } label: {
                    Circle()
                        .strokeBorder(.white, lineWidth: 4)
                        .frame(width: 72, height: 72)
                        .overlay(Circle().fill(.white).padding(9))
                }

                Button {
                    if camera.isRecording {
                        camera.stopRecording()
                    } else {
                        camera.startRecording()
                    }
                } label: {
                    Image(systemName: camera.isRecording ? "stop.fill" : "video.fill")
                        .font(.title2)
                        .frame(width: 54, height: 54)
                        .background(camera.isRecording ? Color.ubeyeRed : .black.opacity(0.45), in: Circle())
                }

                Button {
                    store.selectedMedia = nil
                    camera.capturedPhoto = nil
                    camera.capturedVideoURL = nil
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.title2)
                        .frame(width: 54, height: 54)
                        .background(.black.opacity(0.45), in: Circle())
                }
            }
            .foregroundStyle(.white)
            .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var mediaPreview: some View {
        switch stagedMedia ?? store.selectedMedia {
        case .image(let upload):
            storyImagePreview(upload.image)
        case .video(let video):
            storyVideoPreview(
                url: video.url,
                mirrorsHorizontally: false
            )
        case nil:
            if librarySelection.isLoading {
                Color.black
            } else if let photo = camera.capturedPhoto {
                storyImagePreview(photo.image)
                    .onAppear {
                        enterComposer(with: .image(photo))
                    }
            } else if let photoPreview = camera.capturedPhotoPreview {
                storyImagePreview(photoPreview)
            } else if let videoURL = camera.capturedVideoURL {
                storyVideoPreview(
                    url: videoURL,
                    mirrorsHorizontally: false
                )
                    .onAppear {
                        let source: StoryVideoUpload.Source = camera.capturedVideoCameraPosition == .front ? .cameraFront : .cameraBack
                        enterComposer(with: .video(StoryVideoUpload(url: videoURL, source: source)))
                    }
            } else if camera.authorizationStatus == .authorized {
                CameraPreview(
                    session: camera.session,
                    cameraPosition: camera.cameraPosition,
                    device: camera.activeVideoDevice
                )
            } else {
                EmptyStateView(title: "Camera unavailable", message: "Enable camera access or choose media from your library.", systemImage: "camera")
            }
        }
    }

    private func storyImagePreview(_ image: UIImage) -> some View {
        GeometryReader { proxy in
            let canvasLayout = StoryCanvasLayout(containerSize: proxy.size)

            StoryCanvasImage(image: Image(uiImage: image))
                .storyCanvasFrame(canvasLayout)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private func storyVideoPreview(url: URL, mirrorsHorizontally: Bool) -> some View {
        GeometryReader { proxy in
            let canvasLayout = StoryCanvasLayout(containerSize: proxy.size)

            StoryVideoPreview(
                url: url,
                mirrorsHorizontally: mirrorsHorizontally
            )
            .storyCanvasFrame(canvasLayout)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private var metadataFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Story details")
                .font(.headline)
            composerTextField(
                "Caption",
                text: $store.caption,
                maximumLength: StoryComposerLimits.caption
            )
            composerTextField(
                "Brand tags",
                text: $store.brandTags,
                maximumLength: StoryComposerLimits.brandTagsInput
            )
            composerTextField(
                "Text overlay",
                text: $store.textOverlay,
                maximumLength: StoryComposerLimits.textOverlay
            )
        }
        .padding(14)
        .ubeyeCard()
    }

    private func composerTextField(
        _ title: String,
        text: Binding<String>,
        maximumLength: Int
    ) -> some View {
        TextField(
            title,
            text: Binding(
                get: { text.wrappedValue },
                set: {
                    text.wrappedValue = storyTextPrefix(
                        $0,
                        maximumUTF16Length: maximumLength
                    )
                }
            )
        )
            .padding()
            .frame(height: 52)
            .background(Color.ubeyeSubtle)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .textInputAutocapitalization(.sentences)
            .foregroundStyle(Color.ubeyeInk)
    }

    private func loadPickedItems(_ items: [PhotosPickerItem]) {
        stagedMedia = nil
        selectedBatchMedia = []
        store.selectedMedia = nil
        store.error = nil
        store.uploadStatus = nil
        overlayInputMode = nil
        isOverlayInputFocused = false
        camera.capturedPhoto = nil
        camera.capturedPhotoPreview = nil
        camera.capturedVideoURL = nil

        librarySelection.load(count: items.count, importItem: { index in
            let item = items[index]
            if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                guard let video = try await item.loadTransferable(type: PickedVideo.self) else { return nil }
                return .video(StoryVideoUpload(url: video.url, source: .library))
            }
            // Some Photos providers expose image bytes rather than a file. A
            // failed file representation must not leave a supported image blank.
            if let image = try? await item.loadTransferable(type: PickedImage.self) {
                return .image(image.upload)
            }
            guard let data = try await item.loadTransferable(type: Data.self),
                  let image = await StoryImageUpload.prepare(data: data) else { return nil }
            return .image(image)
        }, onMediaLoaded: { media in
            if media.count == 1, let first = media.first { enterComposer(with: first) }
            selectedBatchMedia = media.count > 1 ? media : []
        }, onComplete: { media, failedItemCount in
            guard !media.isEmpty else {
                store.error = "Could not load that media. Try another photo or video."
                return
            }
            UBEYEFeedback.success()
            selectedBatchMedia = media.count > 1 ? media : []
            store.prepareSelectionLocally(media)
            if failedItemCount > 0 {
                store.error = failedItemCount == 1
                    ? "One item couldn’t be loaded. The others are ready."
                    : "\(failedItemCount) items couldn’t be loaded. The others are ready."
            }
        })
    }

    private func refreshLatestLibraryThumbnail() async {
        latestLibraryThumbnail = await latestAuthorizedPhotoLibraryThumbnail()
    }

    private func latestAuthorizedPhotoLibraryThumbnail() async -> UIImage? {
        await Task.detached(priority: .userInitiated) {
            let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)

            guard status == .authorized || status == .limited else {
                return nil
            }

            let fetchOptions = PHFetchOptions()
            fetchOptions.fetchLimit = 1
            fetchOptions.sortDescriptors = [
                NSSortDescriptor(key: "creationDate", ascending: false)
            ]

            let assets = PHAsset.fetchAssets(with: .image, options: fetchOptions)
            guard let asset = assets.firstObject else {
                return nil
            }

            let requestOptions = PHImageRequestOptions()
            requestOptions.deliveryMode = .opportunistic
            requestOptions.resizeMode = .fast
            requestOptions.isNetworkAccessAllowed = true
            requestOptions.isSynchronous = true

            var thumbnail: UIImage?
            PHImageManager.default().requestImage(
                for: asset,
                targetSize: CGSize(width: 180, height: 180),
                contentMode: .aspectFill,
                options: requestOptions
            ) { image, _ in
                thumbnail = image
            }

            return thumbnail
        }.value
    }

    private var recordingProgress: Double {
        guard camera.isRecording else {
            return 0
        }

        let segmentElapsed = recordingElapsed.truncatingRemainder(dividingBy: videoSegmentDuration)
        return min(max(segmentElapsed / videoSegmentDuration, 0), 1)
    }

    private var recordingSegmentCount: Int {
        guard camera.isRecording else {
            return 0
        }

        return min(Int(recordingElapsed / videoSegmentDuration) + 1, maxVideoSegments)
    }

    private func capturePhoto() {
        guard !camera.isRecording, !camera.isCapturingPhoto, !store.isUploading else {
            return
        }

        resetCapture()
        UBEYEFeedback.impact(.rigid, intensity: 1)
        camera.capturePhoto()
    }

    private func startRecording() {
        guard !camera.isRecording, !camera.isCapturingPhoto, !store.isUploading else {
            return
        }

        resetCapture()
        recordingElapsed = 0
        recordingStartedAt = Date()
        UBEYEFeedback.impact(.heavy, intensity: 0.95)
        camera.startRecording()
    }

    private func stopRecording() {
        guard camera.isRecording else {
            return
        }

        UBEYEFeedback.impact(.medium)
        camera.stopRecording()
    }

    private func uploadSelectedMedia() async {
        guard !store.isUploading, !librarySelection.isLoading else {
            return
        }

        if selectedBatchMedia.count > 1 {
            let didStart = await store.uploadBatch(
                media: selectedBatchMedia,
                api: api,
                pendingUploads: pendingStoryUploads,
                onPendingBatchStarted: {
                    selectedBatchMedia = []
                    stagedMedia = nil
                    onPendingUploadStarted()
                },
                onUploadRegistered: onUploadRegistered
            )
            if didStart {
                UBEYEFeedback.success()
                selectedBatchMedia = []
                stagedMedia = nil
            }
            return
        }

        if let response = await store.upload(
            api: api,
            pendingUploads: pendingStoryUploads,
            onPendingUploadStarted: { _ in
                stagedMedia = nil
                onPendingUploadStarted()
            }
        ) {
            UBEYEFeedback.success()
            stagedMedia = nil
            onUploadRegistered(response)
        } else if store.error != nil {
            UBEYEFeedback.error()
        }
    }

    private func resetCapture(clearQuote: Bool = false) {
        librarySelection.cancel()
        for media in selectedBatchMedia {
            if case .video(let video) = media {
                try? FileManager.default.removeItem(at: video.url)
            }
        }
        selectedBatchMedia = []
        photoPickerItems = []
        stagedMedia = nil
        store.selectedMedia = nil
        store.error = nil
        store.textOverlay = ""
        store.textOverlayPositionX = 50
        store.textOverlayPositionY = 68
        store.linkUrl = ""
        store.linkLabel = ""
        store.linkOverlayPositionX = 50
        store.linkOverlayPositionY = 78
        if clearQuote {
            store.clearQuotedReply()
            clearQuotedReply()
        }
        overlayInputMode = nil
        isOverlayInputFocused = false
        camera.capturedPhoto = nil
        camera.capturedPhotoPreview = nil
        camera.capturedVideoURL = nil
    }

    private func enterComposer(with media: PickedStoryMedia) {
        selectedBatchMedia = []
        store.error = nil
        store.uploadStatus = nil
        overlayInputMode = nil
        isOverlayInputFocused = false
        stagedMedia = media
        store.selectedMedia = media
    }

    private func applyLayoutFixtureIfRequested() {
        #if DEBUG
        guard ProcessInfo.processInfo.arguments.contains("-story-composer-selected-photo-fixture") else {
            return
        }

        let image = UIGraphicsImageRenderer(size: CGSize(width: 1_080, height: 1_920)).image { context in
            UIColor.systemBrown.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1_080, height: 1_920))
        }
        guard let data = image.jpegData(compressionQuality: 0.9),
              let upload = StoryImageUpload(data: data, displayImage: image) else {
            return
        }
        enterComposer(with: .image(upload))
        #endif
    }

    private func updateRecordingProgress(now: Date) {
        guard camera.isRecording else {
            return
        }

        recordingElapsed = now.timeIntervalSince(recordingStartedAt)
        if recordingElapsed >= maxRecordingDuration {
            stopRecording()
        }
    }
}

private struct EditableStoryOverlayChip: View {
    @Binding var text: String
    let maximumLength: Int
    let normalizesWhitespace: Bool
    @State private var measuredChipSize: CGSize = .zero
    @State private var dragStartCenter: CGPoint?
    @State private var editingText: String?
    let placeholder: String
    let systemImage: String?
    let positionX: Double
    let positionY: Double
    let size: CGSize
    let displayText: String?
    let isEditing: Bool
    var isFocused: FocusState<Bool>.Binding
    let keyboardType: UIKeyboardType
    let autocapitalization: TextInputAutocapitalization
    let autocorrectionDisabled: Bool
    let keyboardHeight: CGFloat
    let onSubmit: () -> Void
    let onTapToEdit: () -> Void
    let onPositionChanged: (Double, Double) -> Void

    var body: some View {
        chip
            .background {
                GeometryReader { proxy in
                    Color.clear
                        .onAppear {
                            measuredChipSize = proxy.size
                        }
                        .onChange(of: proxy.size) { _, nextSize in
                            measuredChipSize = nextSize
                        }
                }
            }
            .position(
                x: size.width * CGFloat(positionX / 100),
                y: resolvedCenterY
            )
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard !isEditing else {
                            return
                        }

                        guard abs(value.translation.width) > 3 || abs(value.translation.height) > 3 else {
                            return
                        }

                        if dragStartCenter == nil {
                            dragStartCenter = CGPoint(
                                x: size.width * CGFloat(positionX / 100),
                                y: size.height * CGFloat(positionY / 100)
                            )
                        }

                        let startCenter = dragStartCenter ?? CGPoint(
                            x: size.width * CGFloat(positionX / 100),
                            y: size.height * CGFloat(positionY / 100)
                        )
                        let nextCenter = clampedCenter(
                            CGPoint(
                                x: startCenter.x + value.translation.width,
                                y: startCenter.y + value.translation.height
                            )
                        )
                        onPositionChanged(
                            percent(nextCenter.x, dimension: size.width),
                            percent(nextCenter.y, dimension: size.height)
                        )
                    }
                    .onEnded { value in
                        defer {
                            dragStartCenter = nil
                        }

                        guard !isEditing else {
                            return
                        }

                        if abs(value.translation.width) <= 6, abs(value.translation.height) <= 6 {
                            onTapToEdit()
                        }
                    }
            )
            .onChange(of: isEditing) { wasEditing, nextIsEditing in
                if nextIsEditing {
                    editingText = text
                } else if wasEditing, let editingText {
                    text = editingText
                    self.editingText = nil
                }
            }
    }

    private var resolvedCenterY: CGFloat {
        let naturalCenterY = size.height * CGFloat(positionY / 100)
        guard isEditing, keyboardHeight > 0 else {
            return naturalCenterY
        }
        let halfHeight = max(measuredChipSize.height / 2, 24)
        let minimumCenterY = halfHeight + 20
        let maximumCenterY = max(
            minimumCenterY,
            size.height - keyboardHeight - halfHeight - 18
        )
        return min(max(naturalCenterY, minimumCenterY), maximumCenterY)
    }

    private var chip: some View {
        let maxChipWidth = max(
            size.width - StoryTextOverlayAppearance.horizontalScreenInset * 2,
            StoryTextOverlayAppearance.minimumWidth
        )

        return HStack(alignment: .bottom, spacing: 6) {
            if isEditing {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 12, weight: .semibold))
                        .frame(height: 28)
                }

                TextField(
                    "",
                    text: sanitizedTextBinding,
                    prompt: Text(placeholder).foregroundStyle(.white.opacity(0.62)),
                    axis: .vertical
                )
                .focused(isFocused)
                .keyboardType(keyboardType)
                .textInputAutocapitalization(autocapitalization)
                .autocorrectionDisabled(autocorrectionDisabled)
                .submitLabel(.done)
                .onSubmit(commitEditingTextAndSubmit)
                .font(.system(size: StoryTextOverlayAppearance.fontSize, weight: .regular))
                .tracking(StoryTextOverlayAppearance.letterSpacing)
                .multilineTextAlignment(.center)
                .lineLimit(1...4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(
                    minWidth: StoryTextOverlayAppearance.minimumWidth,
                    maxWidth: maxChipWidth
                )
            } else {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 12, weight: .semibold))
                }

                Text(displayText ?? sanitizedInputValue(text, preservesTrailingSpace: false))
                    .font(.system(size: StoryTextOverlayAppearance.fontSize, weight: .regular))
                    .tracking(StoryTextOverlayAppearance.letterSpacing)
                    .lineLimit(4)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: maxChipWidth)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, StoryTextOverlayAppearance.horizontalPadding)
        .padding(.vertical, StoryTextOverlayAppearance.verticalPadding)
        .frame(maxWidth: maxChipWidth)
        .background(
            .black.opacity(0.46),
            in: RoundedRectangle(
                cornerRadius: StoryTextOverlayAppearance.cornerRadius,
                style: .continuous
            )
        )
    }

    private var sanitizedTextBinding: Binding<String> {
        Binding(
            get: {
                editingText ?? text
            },
            set: { nextValue in
                let sanitizedValue: String
                if nextValue.contains(where: \.isNewline) {
                    sanitizedValue = storyTextPrefix(
                        sanitizedInputValue(nextValue, preservesTrailingSpace: true),
                        maximumUTF16Length: maximumLength
                    )
                    editingText = sanitizedValue
                    text = sanitizedValue
                    DispatchQueue.main.async {
                        commitEditingTextAndSubmit()
                    }
                } else {
                    sanitizedValue = storyTextPrefix(
                        sanitizedInputValue(nextValue, preservesTrailingSpace: true),
                        maximumUTF16Length: maximumLength
                    )
                    editingText = sanitizedValue
                    text = sanitizedValue
                }
            }
        )
    }

    private func commitEditingTextAndSubmit() {
        let committedText = storyTextPrefix(
            sanitizedInputValue(editingText ?? text, preservesTrailingSpace: false),
            maximumUTF16Length: maximumLength
        )
        editingText = committedText
        text = committedText
        onSubmit()
    }

    private func sanitizedInputValue(
        _ value: String,
        preservesTrailingSpace: Bool
    ) -> String {
        guard normalizesWhitespace else {
            return value.contains(where: \.isNewline)
                ? value.split(whereSeparator: \.isNewline).joined(separator: " ")
                : value
        }

        return normalizedStoryOverlayText(
            value,
            preservesTrailingSpace: preservesTrailingSpace
        )
    }

    private func clampedCenter(_ center: CGPoint) -> CGPoint {
        let horizontalInset = clampedInset(measuredChipSize.width, dimension: size.width)
        let verticalInset = clampedInset(measuredChipSize.height, dimension: size.height)

        return CGPoint(
            x: min(max(center.x, horizontalInset), size.width - horizontalInset),
            y: min(max(center.y, verticalInset), size.height - verticalInset)
        )
    }

    private func clampedInset(_ measuredLength: CGFloat, dimension: CGFloat) -> CGFloat {
        guard dimension > 0 else {
            return 0
        }

        let fallbackLength = min(
            dimension - 32,
            StoryTextOverlayAppearance.minimumWidth
        )
        let length = measuredLength > 0 ? measuredLength : fallbackLength
        return min(max((length / 2) + 8, 8), dimension / 2)
    }

    private func percent(_ value: CGFloat, dimension: CGFloat) -> Double {
        guard dimension > 0 else {
            return 50
        }

        return Double(value / dimension) * 100
    }
}

private struct DraggableQuoteReplyOverlay: View {
    let quote: QuotedStoryReply
    let positionX: Double
    let positionY: Double
    let size: CGSize
    let clear: () -> Void
    let onPositionChanged: (Double, Double) -> Void

    var body: some View {
        QuoteReplyOverlayBubble(
            quote: quote,
            includesCloseButton: true,
            clear: clear
        )
        .frame(width: min(size.width - 44, 300), alignment: .leading)
        .position(
            x: size.width * CGFloat(positionX / 100),
            y: size.height * CGFloat(positionY / 100)
        )
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let nextX = clampedPercent(value.location.x, dimension: size.width)
                    let nextY = clampedPercent(value.location.y, dimension: size.height)
                    onPositionChanged(nextX, nextY)
                }
        )
    }

    private func clampedPercent(_ value: CGFloat, dimension: CGFloat) -> Double {
        guard dimension > 0 else {
            return 50
        }

        return min(max(Double(value / dimension) * 100, 12), 88)
    }
}

private struct QuoteReplyOverlayBubble: View {
    let quote: QuotedStoryReply
    var includesCloseButton = false
    var clear: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                RemoteAvatar(url: quote.actorAvatarUrl, size: 22, name: quote.actorName)

                VStack(alignment: .leading, spacing: 0) {
                    Text(quote.actorName)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                    Text("@\(quote.actorHandle)")
                        .font(.system(size: 10, weight: .regular))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }

                Spacer(minLength: 6)

                if includesCloseButton {
                    Button(action: clear) {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .semibold))
                            .frame(width: 24, height: 24)
                            .background(.white.opacity(0.14), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove quoted reply")
                }
            }

            Text(quote.message)
                .font(.system(size: 15, weight: .medium))
                .lineLimit(4)
                .multilineTextAlignment(.leading)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 14, y: 7)
    }
}

struct PickedVideo: Transferable, Sendable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { video in
            SentTransferredFile(video.url)
        } importing: { received in
            try await importFile(received.file)
        }
    }

    static func importFile(_ file: URL) async throws -> PickedVideo {
        try await Task.detached(priority: .userInitiated) {
            let sourceExtension = file.pathExtension
            let fileExtension = sourceExtension.isEmpty ? "mov" : sourceExtension
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).\(fileExtension)")
            try FileManager.default.copyItem(at: file, to: copy)
            return PickedVideo(url: copy)
        }.value
    }

}

struct PickedImage: Transferable {
    let upload: StoryImageUpload

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .image) { image in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent("picked-\(UUID().uuidString).\(image.upload.fileName)")
            try image.upload.data.write(to: copy, options: .atomic)
            return SentTransferredFile(copy)
        } importing: { received in
            try await importFile(received.file)
        }
    }

    static func importFile(_ file: URL) async throws -> PickedImage {
        guard let upload = await StoryImageUpload.prepare(fileURL: file, fallbackFileName: file.lastPathComponent) else {
            throw APIClientError.invalidResponse
        }
        return PickedImage(upload: upload)
    }

}

private struct StoryShutterButton: View {
    let isRecording: Bool
    let progress: Double
    let segmentCount: Int
    let maxSegments: Int
    let capturePhoto: () -> Void
    let startRecording: () -> Void
    let stopRecording: () -> Void

    @State private var pressStartedAt: Date?
    @State private var didStartRecordingForPress = false
    @State private var longPressTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Circle()
                .stroke(.white.opacity(0.52), lineWidth: 3)
                .frame(width: 88, height: 88)

            Circle()
                .trim(from: 0, to: isRecording ? progress : 0)
                .stroke(
                    Color.ubeyeRed,
                    style: StrokeStyle(lineWidth: 3.5, lineCap: .round)
                )
                .frame(width: 88, height: 88)
                .rotationEffect(.degrees(-90))

            Circle()
                .fill(.white)
                .frame(width: isRecording ? 56 : 60, height: isRecording ? 56 : 60)

            if isRecording {
                Text("\(segmentCount)/\(maxSegments)")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.ubeyeInk)
            }
        }
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    beginPressIfNeeded()
                }
                .onEnded { _ in
                    endPress()
                }
        )
        .animation(.easeOut(duration: 0.12), value: isRecording)
    }

    private func beginPressIfNeeded() {
        guard pressStartedAt == nil else {
            return
        }

        pressStartedAt = Date()
        didStartRecordingForPress = false
        longPressTask?.cancel()
        longPressTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            await MainActor.run {
                guard pressStartedAt != nil, !didStartRecordingForPress else {
                    return
                }
                didStartRecordingForPress = true
                startRecording()
            }
        }
    }

    private func endPress() {
        longPressTask?.cancel()

        if didStartRecordingForPress || isRecording {
            stopRecording()
        } else {
            capturePhoto()
        }

        pressStartedAt = nil
        didStartRecordingForPress = false
    }
}

struct StoryVideoPreview: UIViewRepresentable {
    let url: URL
    var mirrorsHorizontally = false

    func makeUIView(context: Context) -> StoryVideoPreviewView {
        let view = StoryVideoPreviewView()
        view.configure(url: url, mirrorsHorizontally: mirrorsHorizontally)
        return view
    }

    func updateUIView(_ uiView: StoryVideoPreviewView, context: Context) {
        uiView.configure(url: url, mirrorsHorizontally: mirrorsHorizontally)
    }
}

private struct LibraryPickerThumbnail: View {
    let image: UIImage?

    var body: some View {
        ZStack {
            thumbnailContent

            Image(systemName: "photo.on.rectangle")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.white.opacity(0.94))
                .shadow(color: .black.opacity(0.45), radius: 4, x: 0, y: 1)
        }
        .frame(width: 58, height: 58)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.72), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private var thumbnailContent: some View {
        if let image {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 58, height: 58)
        } else {
            LinearGradient(
                colors: [
                    .white.opacity(0.22),
                    .black.opacity(0.28)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
}

final class StoryVideoPreviewView: UIView {
    private let playerLayer = AVPlayerLayer()
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var currentURL: URL?
    private var isMirrored = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        clipsToBounds = true

        playerLayer.backgroundColor = UIColor.black.cgColor
        playerLayer.videoGravity = .resizeAspect
        layer.addSublayer(playerLayer)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerLayer.frame = bounds
    }

    func configure(url: URL, mirrorsHorizontally: Bool) {
        updateMirroring(mirrorsHorizontally)

        guard currentURL != url else {
            player?.play()
            return
        }

        currentURL = url
        AppAudioSession.configureForVideoPlayback()
        let item = AVPlayerItem(url: url)
        let queuePlayer = AVQueuePlayer(playerItem: item)
        queuePlayer.isMuted = false
        queuePlayer.volume = 1
        queuePlayer.actionAtItemEnd = .none
        looper = AVPlayerLooper(player: queuePlayer, templateItem: item)
        player = queuePlayer
        playerLayer.player = queuePlayer
        queuePlayer.play()
    }

    private func updateMirroring(_ mirrorsHorizontally: Bool) {
        guard isMirrored != mirrorsHorizontally else {
            return
        }

        isMirrored = mirrorsHorizontally
        playerLayer.setAffineTransform(
            mirrorsHorizontally ? CGAffineTransform(scaleX: -1, y: 1) : .identity
        )
    }

    deinit {
        player?.pause()
    }
}
