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

struct StoryThumbnailOverlaySpec {
    let label: String
    let positionX: Double
    let positionY: Double
    let isLink: Bool
    var isQuoteReply = false
    var actorName: String?
    var actorHandle: String?
}

final class StoryVideoThumbnailGenerationBox: @unchecked Sendable {
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
