import AVFoundation
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

enum StoryImageContentMode: String, Codable, Hashable {
    case fit
    case fill
}

struct StoryVideoUpload {
    enum Source {
        case cameraFront
        case cameraBack
        case library
    }

    let url: URL
    let source: Source
}

struct StoryImageUpload: Equatable, @unchecked Sendable {
    static let maximumUploadBytes = StoryMediaContract.maximumImageUploadBytes
    static let maximumTranscodedPixelDimension = 4_096
    static let maximumPreviewPixelDimension = 2_560
    static let transcodedJPEGQuality: CGFloat = 0.95
    static let fallbackTranscodedPixelDimension = 3_072
    static let fallbackJPEGQuality: CGFloat = 0.88
    static let playbackCanvasWidth = Int(StoryCanvasLayout.playbackPixelSize.width)
    static let playbackCanvasHeight = Int(StoryCanvasLayout.playbackPixelSize.height)
    static let playbackJPEGQuality: CGFloat = 0.78
    static let thumbnailCanvasWidth = Int(StoryCanvasLayout.thumbnailPixelSize.width)
    static let thumbnailCanvasHeight = Int(StoryCanvasLayout.thumbnailPixelSize.height)

    let image: UIImage
    let data: Data
    let fileName: String
    let mimeType: String

    static func prepare(
        data: Data,
        fallbackFileName: String = "story-photo",
        displayImage: UIImage? = nil
    ) async -> StoryImageUpload? {
        await Task.detached(priority: .userInitiated) {
            StoryImageUpload(
                data: data,
                fallbackFileName: fallbackFileName,
                displayImage: displayImage
            )
        }.value
    }

    static func prepare(
        fileURL: URL,
        fallbackFileName: String = "story-photo"
    ) async -> StoryImageUpload? {
        await Task.detached(priority: .userInitiated) {
            StoryImageUpload(
                fileURL: fileURL,
                fallbackFileName: fallbackFileName
            )
        }.value
    }

    init?(
        data: Data,
        fallbackFileName: String = "story-photo",
        displayImage: UIImage? = nil
    ) {
        if let format = StoryImageFormat(data: data),
           format.isDirectUploadCompatible,
           data.count <= Self.maximumUploadBytes,
           let previewImage = StoryImageTranscoder.previewImage(
             data: data,
             maxPixelDimension: Self.maximumPreviewPixelDimension
           ) ?? displayImage {
            image = previewImage
            self.data = data
            fileName = Self.normalizedFileName(
                fallbackFileName,
                fileExtension: format.fileExtension
            )
            mimeType = format.mimeType
            return
        }

        guard var normalized = StoryImageTranscoder.normalizedJPEG(
            data: data,
            maxPixelDimension: Self.maximumTranscodedPixelDimension,
            quality: Self.transcodedJPEGQuality
        ) else {
            return nil
        }
        if normalized.data.count > Self.maximumUploadBytes {
            guard let reduced = StoryImageTranscoder.normalizedJPEG(
                data: data,
                maxPixelDimension: Self.fallbackTranscodedPixelDimension,
                quality: Self.fallbackJPEGQuality
            ), reduced.data.count <= Self.maximumUploadBytes else {
                return nil
            }
            normalized = reduced
        }
        guard let previewImage = StoryImageTranscoder.previewImage(
            data: normalized.data,
            maxPixelDimension: Self.maximumPreviewPixelDimension
        ) ?? displayImage else {
            return nil
        }

        image = previewImage
        self.data = normalized.data
        fileName = Self.normalizedFileName(fallbackFileName, fileExtension: "jpg")
        mimeType = "image/jpeg"
    }

    init?(
        fileURL: URL,
        fallbackFileName: String = "story-photo"
    ) {
        let fileSize = (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if let format = StoryImageFormat(fileURL: fileURL),
           format.isDirectUploadCompatible,
           fileSize > 0,
           fileSize <= Self.maximumUploadBytes,
           let originalData = try? Data(contentsOf: fileURL, options: .mappedIfSafe),
           let previewImage = StoryImageTranscoder.previewImage(
             fileURL: fileURL,
             maxPixelDimension: Self.maximumPreviewPixelDimension
           ) {
            image = previewImage
            data = originalData
            fileName = Self.normalizedFileName(
                fallbackFileName,
                fileExtension: format.fileExtension
            )
            mimeType = format.mimeType
            return
        }

        guard var normalized = StoryImageTranscoder.normalizedJPEG(
            fileURL: fileURL,
            maxPixelDimension: Self.maximumTranscodedPixelDimension,
            quality: Self.transcodedJPEGQuality
        ) else {
            return nil
        }
        if normalized.data.count > Self.maximumUploadBytes {
            guard let reduced = StoryImageTranscoder.normalizedJPEG(
                fileURL: fileURL,
                maxPixelDimension: Self.fallbackTranscodedPixelDimension,
                quality: Self.fallbackJPEGQuality
            ), reduced.data.count <= Self.maximumUploadBytes else {
                return nil
            }
            normalized = reduced
        }
        guard let previewImage = StoryImageTranscoder.previewImage(
            data: normalized.data,
            maxPixelDimension: Self.maximumPreviewPixelDimension
        ) else {
            return nil
        }

        image = previewImage
        data = normalized.data
        fileName = Self.normalizedFileName(fallbackFileName, fileExtension: "jpg")
        mimeType = "image/jpeg"
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
            lhs.mimeType == rhs.mimeType
    }
}

private struct StoryImageFormat {
    let fileExtension: String
    let mimeType: String
    let isDirectUploadCompatible: Bool

    init?(data: Data) {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options) else {
            return nil
        }

        self.init(typeIdentifier: CGImageSourceGetType(source))
    }

    init?(fileURL: URL) {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, options) else {
            return nil
        }

        self.init(typeIdentifier: CGImageSourceGetType(source))
    }

    private init?(typeIdentifier: CFString?) {
        guard let typeIdentifier else {
            return nil
        }

        switch typeIdentifier as String {
        case UTType.jpeg.identifier:
            fileExtension = "jpg"
            mimeType = "image/jpeg"
            isDirectUploadCompatible = true
        case UTType.png.identifier:
            fileExtension = "png"
            mimeType = "image/png"
            isDirectUploadCompatible = true
        case UTType.webP.identifier:
            fileExtension = "webp"
            mimeType = "image/webp"
            isDirectUploadCompatible = true
        default:
            fileExtension = "jpg"
            mimeType = "image/jpeg"
            isDirectUploadCompatible = false
        }
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
        contentMode: StoryImageContentMode = .fill
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
        contentMode: StoryImageContentMode = .fill
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
        contentMode: StoryImageContentMode = .fill
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
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              ) else {
            return nil
        }

        context.interpolationQuality = .high
        if contentMode == .fit {
            context.clear(CGRect(origin: .zero, size: targetSize))
        } else {
            context.setFillColor(CGColor(gray: 0, alpha: 1))
            context.fill(CGRect(origin: .zero, size: targetSize))
        }
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
    @Published var selectedMedia: PickedStoryMedia?
    @Published var uploadStatus: String?
    @Published var error: String?
    @Published var lastUploadReport: String?
    @Published var isUploading = false

    init() {
        guard let data = UserDefaults.standard.data(forKey: Self.textDraftKey),
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

    private func preparedVideo(for video: StoryVideoUpload) async throws -> PreparedStoryVideo {
        try await StoryVideoUploadNormalizer.prepare(
            url: video.url,
            source: video.source,
            maxDurationSeconds: maxVideoDurationSeconds
        )
    }

    private var thumbnailOverlaySpecs: [StoryThumbnailOverlaySpec] {
        var overlays: [StoryThumbnailOverlaySpec] = []
        let trimmedText = textOverlay.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedText.isEmpty {
            overlays.append(
                StoryThumbnailOverlaySpec(
                    label: trimmedText,
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
            textOverlay: textOverlay,
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
        let trimmedText = textOverlay.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedText.isEmpty {
            overlays.append(
                StoryTextOverlay(
                    id: "pending-text-\(UUID().uuidString.lowercased())",
                    label: trimmedText,
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

        isUploading = true
        uploadStatus = "Preparing upload"
        var uploadResponse: StoryUploadResponse?
        var didCreatePendingUpload = false

        do {
            switch selectedMedia {
            case .image(let upload):
                uploadStatus = "Posting"
                let pendingUpload = try pendingUploads.createImageUpload(
                    upload: upload,
                    contentMode: .fit,
                    draft: pendingUploadDraft,
                    textOverlays: pendingTextOverlays
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
        return uploadResponse
    }

    func uploadBatch(
        media: [PickedStoryMedia],
        api: APIClient,
        pendingUploads: PendingStoryUploadStore,
        onPendingBatchStarted: () -> Void,
        onUploadRegistered: @escaping (StoryUploadResponse) -> Void
    ) async -> Bool {
        guard media.count > 1 else {
            error = "Choose at least two items for a batch."
            return false
        }

        error = nil
        lastUploadReport = nil
        normalizeLinkDraft()
        if let validationMessage = draftValidationMessage {
            error = validationMessage
            return false
        }

        isUploading = true
        let batchId = UUID().uuidString.lowercased()
        var stagedUploads: [PendingStoryUpload] = []
        var failedPreparationCount = 0

        for (offset, item) in media.enumerated() {
            uploadStatus = "Preparing story \(offset + 1) of \(media.count)"
            do {
                let pendingUpload = try await createPendingBatchUpload(
                    item,
                    batchId: batchId,
                    batchPosition: offset + 1,
                    batchCount: media.count,
                    pendingUploads: pendingUploads
                )
                stagedUploads.append(pendingUpload)
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

        guard !stagedUploads.isEmpty else {
            isUploading = false
            uploadStatus = nil
            error = "Could not prepare those stories. Try different photos or videos."
            return false
        }

        pendingUploads.normalizeBatch(
            batchId,
            orderedUploadIds: stagedUploads.map(\.id)
        )

        clearUploadedDraft()
        isUploading = false
        uploadStatus = nil
        onPendingBatchStarted()

        if failedPreparationCount > 0 {
            MediaPerformance.mark(
                "story_batch_prepare_partial prepared=\(stagedUploads.count) failed=\(failedPreparationCount)"
            )
        }

        // Keep each story independent while bounding peak memory and network work.
        // Starting several video normalizers and TUS chunks together can exceed
        // the memory budget on physical devices even though each upload is valid.
        Task { @MainActor in
            for pendingUpload in stagedUploads {
                do {
                    let response = try await pendingUploads.performUpload(
                        id: pendingUpload.id,
                        api: api
                    )
                    onUploadRegistered(response)
                } catch {
                    MediaPerformance.mark(
                        "story_batch_upload_failed id=\(pendingUpload.id) error=\(error.localizedDescription)"
                    )
                }
            }
        }

        return true
    }

    private func createPendingBatchUpload(
        _ media: PickedStoryMedia,
        batchId: String,
        batchPosition: Int,
        batchCount: Int,
        pendingUploads: PendingStoryUploadStore
    ) async throws -> PendingStoryUpload {
        switch media {
        case .image(let upload):
            return try pendingUploads.createImageUpload(
                upload: upload,
                contentMode: .fit,
                draft: pendingUploadDraft,
                textOverlays: pendingTextOverlays,
                batchId: batchId,
                batchPosition: batchPosition,
                batchCount: batchCount
            )
        case .video(let video):
            let preparedVideo = try await preparedVideo(for: video)
            do {
                let thumbnailData = try await videoThumbnailData(
                    for: preparedVideo.url,
                    overlays: thumbnailOverlaySpecs
                )
                let pendingUpload = try await pendingUploads.createVideoUpload(
                    sourceURL: preparedVideo.url,
                    thumbnailData: thumbnailData,
                    durationMs: preparedVideo.durationMs,
                    draft: pendingUploadDraft,
                    textOverlays: pendingTextOverlays,
                    batchId: batchId,
                    batchPosition: batchPosition,
                    batchCount: batchCount
                )
                await StoryUploadFileIO.remove([preparedVideo.url, video.url])
                return pendingUpload
            } catch {
                await StoryUploadFileIO.remove([preparedVideo.url])
                throw error
            }
        }
    }

    private func uploadVideoStory(
        video: StoryVideoUpload,
        api: APIClient,
        pendingUploads: PendingStoryUploadStore,
        onPendingUploadStarted: (PendingStoryUpload) -> Void
    ) async throws -> StoryUploadResponse {
        var attempt = StoryVideoUploadAttempt()

        do {
            attempt.begin(.inspect)
            uploadStatus = attempt.phase.statusLabel
            attempt.begin(.prepare)
            uploadStatus = attempt.phase.statusLabel
            let preparedVideo = try await preparedVideo(for: video)
            attempt.attach(video: preparedVideo)
            lastUploadReport = attempt.report

            attempt.begin(.thumbnailGenerate)
            uploadStatus = attempt.phase.statusLabel
            let thumbnailData = try await videoThumbnailData(
                for: preparedVideo.url,
                overlays: thumbnailOverlaySpecs
            )

            attempt.begin(.prepareUpload)
            uploadStatus = attempt.phase.statusLabel
            let pendingUpload = try await pendingUploads.createVideoUpload(
                sourceURL: preparedVideo.url,
                thumbnailData: thumbnailData,
                durationMs: preparedVideo.durationMs,
                draft: pendingUploadDraft,
                textOverlays: pendingTextOverlays
            )
            await StoryUploadFileIO.remove([preparedVideo.url, video.url])
            onPendingUploadStarted(pendingUpload)
            clearUploadedDraft()

            let response = try await pendingUploads.performUpload(
                id: pendingUpload.id,
                api: api
            ) { phase in
                attempt.begin(phase)
                self.uploadStatus = phase.statusLabel
            }

            attempt.begin(.processing)
            attempt.recordSuccess(processingStatus: response.processingStatus)
            lastUploadReport = attempt.report
            return response
        } catch {
            attempt.recordFailure(error)
            lastUploadReport = attempt.report
            if attempt.phase == .prepare {
                throw APIClientError.server(
                    "Could not prepare this video. Try a different video or record it again.",
                    0
                )
            }
            throw error
        }
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

struct StoryComposerView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var pendingStoryUploads: PendingStoryUploadStore
    @StateObject private var camera = CameraController()
    @StateObject private var store = StoryComposerStore()
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var selectedBatchMedia: [PickedStoryMedia] = []
    @State private var overlayInputMode: ComposerOverlayInputMode?
    @State private var recordingStartedAt = Date()
    @State private var recordingElapsed: TimeInterval = 0
    @State private var latestLibraryThumbnail: UIImage?
    @State private var stagedMedia: PickedStoryMedia?
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
                            systemImage: "camera.fill"
                        )
                            .font(.system(size: 15, weight: .bold))
                            .padding(.horizontal, 14)
                            .frame(height: 38)
                            .background(.black.opacity(0.34), in: Capsule())

                        HStack(alignment: .top) {
                            if hasSelectedMedia {
                                Button {
                                    UBEYEFeedback.selection()
                                    resetCapture(clearQuote: true)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 18, weight: .bold))
                                        .frame(width: 42, height: 42)
                                        .background(.black.opacity(0.34), in: Circle())
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
                                            .font(.system(size: 18, weight: .bold))
                                            .frame(width: 42, height: 42)
                                            .background(.black.opacity(0.34), in: Circle())
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

                    if let uploadStatus = store.uploadStatus {
                        Text(uploadStatus)
                            .font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(.black.opacity(0.45), in: Capsule())
                            .padding(.bottom, 16)
                    } else if let error = store.error ?? camera.error {
                        Text(error)
                            .font(.system(size: 16, weight: .bold))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.ubeyeRed.opacity(0.9), in: Capsule())
                            .padding(.horizontal, 22)
                            .padding(.bottom, 16)
                    } else if camera.isCapturingPhoto {
                        Text("Preparing photo")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white.opacity(0.72))
                            .padding(.bottom, 24)
                    } else if stagedMedia == nil {
                        Text("Tap for photo, hold for video")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white.opacity(0.65))
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
            store.applyQuotedReply(quotedReply)
            if isActive {
                await camera.requestAccessAndConfigure()
            }
            await refreshLatestLibraryThumbnail()
            applyLayoutFixtureIfRequested()
        }
        .onChange(of: isActive) { _, nextIsActive in
            if nextIsActive {
                camera.start()
            } else {
                camera.stop()
            }
        }
        .onChange(of: quotedReply) { _, quote in
            store.applyQuotedReply(quote)
        }
        .onDisappear {
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
            Task {
                await loadPickedItems(items)
            }
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
    }

    @ViewBuilder
    private var composerFooter: some View {
        Group {
            if stagedMedia == nil {
                captureFooter
            } else {
                selectedMediaFooter
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
            .disabled(store.isUploading)

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
            .disabled(store.isUploading)

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
                        .font(.system(size: 14, weight: .bold))
                    Text("They’ll upload in the background")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.68))
                }
            }

            Spacer(minLength: 0)
            uploadStoryButton
        }
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
                        .font(.system(size: 14, weight: .bold))
                }
            }
            .foregroundStyle(.white)
            .frame(
                width: selectedBatchMedia.count > 1 ? 104 : footerSideControlSize,
                height: footerSideControlSize
            )
            .background(.black.opacity(0.52), in: Capsule())
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
        Image(systemName: store.isUploading ? "hourglass" : "paperplane.fill")
            .font(.system(size: 21, weight: .bold))
    }

    private var composerToolRail: some View {
        VStack(spacing: 8) {
            Button {
                UBEYEFeedback.selection()
                openOverlayInput(.text)
            } label: {
                Text("Aa")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 42, height: 42)
                    .background(.black.opacity(0.34), in: Circle())
            }
            .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
            .accessibilityLabel("Add text overlay")

            Button {
                UBEYEFeedback.selection()
                openOverlayInput(.link)
            } label: {
                Image(systemName: "link")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 42, height: 42)
                    .background(.black.opacity(0.34), in: Circle())
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
        Task {
            try? await Task.sleep(for: .milliseconds(120))
            await MainActor.run {
                isOverlayInputFocused = true
            }
        }
    }

    private func finishOverlayInput() {
        if overlayInputMode == .link {
            store.normalizeLinkDraft()
        }

        isOverlayInputFocused = false
        overlayInputMode = nil
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
            if let photo = camera.capturedPhoto {
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

    private func loadPickedItems(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else {
            return
        }

        store.error = nil
        store.uploadStatus = nil
        overlayInputMode = nil
        isOverlayInputFocused = false
        camera.capturedPhoto = nil
        camera.capturedVideoURL = nil
        defer {
            photoPickerItems = []
        }

        var loadedMedia: [PickedStoryMedia] = []
        var failedItemCount = 0

        for (offset, item) in items.enumerated() {
            if items.count > 1 {
                store.uploadStatus = "Loading story \(offset + 1) of \(items.count)"
            }

            do {
                if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }),
                   let pickedVideo = try await item.loadTransferable(type: PickedVideo.self) {
                    loadedMedia.append(
                        .video(StoryVideoUpload(url: pickedVideo.url, source: .library))
                    )
                    continue
                }

                if let pickedImage = try await item.loadTransferable(type: PickedImage.self) {
                    loadedMedia.append(.image(pickedImage.upload))
                    continue
                }

                failedItemCount += 1
            } catch {
                failedItemCount += 1
            }
        }

        guard let firstMedia = loadedMedia.first else {
            store.uploadStatus = nil
            store.error = "Could not load that media. Try another photo or video."
            return
        }

        UBEYEFeedback.success()
        enterComposer(with: firstMedia)
        selectedBatchMedia = loadedMedia.count > 1 ? loadedMedia : []
        if failedItemCount > 0 {
            store.error = failedItemCount == 1
                ? "One item couldn’t be loaded. The others are ready."
                : "\(failedItemCount) items couldn’t be loaded. The others are ready."
        }
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
        guard !store.isUploading else {
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
    @State private var measuredChipSize: CGSize = .zero
    @State private var dragStartCenter: CGPoint?
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
                y: size.height * CGFloat(positionY / 100)
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
                .onSubmit(onSubmit)
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

                Text(displayText ?? text)
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
                text
            },
            set: { nextValue in
                if nextValue.contains(where: \.isNewline) {
                    text = storyTextPrefix(
                        nextValue
                            .split(whereSeparator: \.isNewline)
                            .joined(separator: " "),
                        maximumUTF16Length: maximumLength
                    )
                    DispatchQueue.main.async {
                        onSubmit()
                    }
                } else {
                    text = storyTextPrefix(
                        nextValue,
                        maximumUTF16Length: maximumLength
                    )
                }
            }
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

private struct PickedVideo: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { video in
            SentTransferredFile(video.url)
        } importing: { received in
            let sourceExtension = received.file.pathExtension
            let fileExtension = sourceExtension.isEmpty ? "mov" : sourceExtension
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).\(fileExtension)")
            if FileManager.default.fileExists(atPath: copy.path) {
                try FileManager.default.removeItem(at: copy)
            }
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedVideo(url: copy)
        }
    }
}

private struct PickedImage: Transferable {
    let upload: StoryImageUpload

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .image) { image in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent("picked-\(UUID().uuidString).\(image.upload.fileName)")
            try image.upload.data.write(to: copy, options: .atomic)
            return SentTransferredFile(copy)
        } importing: { received in
            guard let upload = StoryImageUpload(
                fileURL: received.file,
                fallbackFileName: received.file.lastPathComponent
            ) else {
                throw APIClientError.invalidResponse
            }

            return PickedImage(upload: upload)
        }
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
                .stroke(.white.opacity(0.42), lineWidth: 5)
                .frame(width: 88, height: 88)

            Circle()
                .trim(from: 0, to: isRecording ? progress : 0)
                .stroke(
                    Color.ubeyeRed,
                    style: StrokeStyle(lineWidth: 5, lineCap: .round)
                )
                .frame(width: 88, height: 88)
                .rotationEffect(.degrees(-90))

            Circle()
                .fill(.white)
                .frame(width: isRecording ? 56 : 60, height: isRecording ? 56 : 60)

            if isRecording {
                Text("\(segmentCount)/\(maxSegments)")
                    .font(.system(size: 12, weight: .bold))
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
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.45), radius: 4, x: 0, y: 1)
        }
        .frame(width: 58, height: 58)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.85), lineWidth: 2)
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
