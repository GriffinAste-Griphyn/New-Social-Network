import ImageIO
import UniformTypeIdentifiers
import UIKit
import XCTest
@testable import UBEYE

final class MediaPerformanceTests: XCTestCase {
    func testParsesEventNameAndMetadata() {
        let parsed = MediaPerformance.parsedEventForTesting(
            "video_first_frame reason=layer_ready delivery=hls cache=hit source=pooled url=clip.m3u8"
        )

        XCTAssertEqual(parsed?.name, "video_first_frame")
        XCTAssertEqual(parsed?.metadata["reason"], "layer_ready")
        XCTAssertEqual(parsed?.metadata["delivery"], "hls")
        XCTAssertEqual(parsed?.metadata["cache"], "hit")
        XCTAssertEqual(parsed?.metadata["source"], "pooled")
        XCTAssertEqual(parsed?.metadata["url"], "clip.m3u8")
    }

    func testLimitsMetadataCardinality() {
        let metadata = (0..<25)
            .map { "k\($0)=v\($0)" }
            .joined(separator: " ")
        let parsed = MediaPerformance.parsedEventForTesting("video_startup \(metadata)")

        XCTAssertEqual(parsed?.name, "video_startup")
        XCTAssertEqual(parsed?.metadata.count, 20)
        XCTAssertEqual(parsed?.metadata["k0"], "v0")
        XCTAssertNil(parsed?.metadata["k24"])
    }

    func testTruncatesMetadataKeysAndValues() {
        let longKey = String(repeating: "k", count: 48)
        let longValue = String(repeating: "v", count: 540)
        let parsed = MediaPerformance.parsedEventForTesting("story_open \(longKey)=\(longValue)")

        XCTAssertEqual(parsed?.metadata.keys.first?.count, 40)
        XCTAssertEqual(parsed?.metadata.values.first?.count, 500)
    }

    func testStoryImageTranscoderBoundsAndNormalizesOversizedImage() throws {
        let sourceData = makeTestImageData(width: 3_000, height: 2_000)

        let encoded = try XCTUnwrap(
            StoryImageTranscoder.normalizedJPEG(
                data: sourceData,
                maxPixelDimension: StoryImageUpload.maximumPixelDimension
            )
        )

        XCTAssertEqual(max(encoded.width, encoded.height), StoryImageUpload.maximumPixelDimension)
        XCTAssertLessThanOrEqual(min(encoded.width, encoded.height), StoryImageUpload.maximumPixelDimension)

        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(encoded.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)
    }

    func testStoryImageUploadNormalizesFilenameAndMimeTypeToJPEG() throws {
        let sourceData = makeTestImageData(width: 2_400, height: 3_200)

        let upload = try XCTUnwrap(
            StoryImageUpload(
                data: sourceData,
                fallbackFileName: "IMG_1234.HEIC"
            )
        )

        XCTAssertEqual(upload.fileName, "IMG_1234.jpg")
        XCTAssertEqual(upload.mimeType, "image/jpeg")

        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(upload.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)
        XCTAssertLessThanOrEqual(
            max(upload.image.cgImage?.width ?? 0, upload.image.cgImage?.height ?? 0),
            StoryImageUpload.maximumPixelDimension
        )
    }

    func testStoryImageTranscoderHonorsOrientationFromFileURL() throws {
        let sourceData = try makeOrientedJPEGData(width: 1_200, height: 800)
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("oriented-photo-\(UUID().uuidString).jpg")
        try sourceData.write(to: fileURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let encoded = try XCTUnwrap(
            StoryImageTranscoder.normalizedJPEG(
                fileURL: fileURL,
                maxPixelDimension: StoryImageUpload.maximumPixelDimension
            )
        )

        XCTAssertEqual(encoded.width, 800)
        XCTAssertEqual(encoded.height, 1_200)
        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(encoded.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)
    }

    @MainActor
    func testPreferredPlaybackAlwaysUsesCanonicalAdaptiveStream() {
        let defaultURL = URL(string: "https://example.com/playback/video.m3u8")!
        let selected = MediaPlaybackQuality.preferredPlaybackURL(defaultURL: defaultURL)

        XCTAssertEqual(selected.url, defaultURL)
        XCTAssertEqual(selected.quality, "adaptive_hls")
    }

    @MainActor
    func testPlayerPoolKeepsActiveURLInsideBoundedPriorityWindow() {
        let first = URL(string: "https://example.com/first.m3u8")!
        let active = URL(string: "https://example.com/active.m3u8")!
        let third = URL(string: "https://example.com/third.m3u8")!
        let fourth = URL(string: "https://example.com/fourth.m3u8")!

        let prioritized = StoryVideoPlaybackPool.prioritizedURLs(
            urls: [first, active, third, fourth, active],
            activeURL: active,
            limit: 3
        )

        XCTAssertEqual(prioritized, [active, first, third])
    }

    @MainActor
    func testPlayerPoolReturnsNoURLsWhenPrefetchIsDisabled() {
        let url = URL(string: "https://example.com/video.m3u8")!

        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedURLs(urls: [url], activeURL: url, limit: 0),
            []
        )
    }

    private func makeTestImageData(width: Int, height: Int) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height),
            format: format
        )

        return renderer.pngData { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    private func makeOrientedJPEGData(width: Int, height: Int) throws -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height),
            format: format
        ).image { context in
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        let cgImage = try XCTUnwrap(image.cgImage)
        let output = NSMutableData()
        let destination = try XCTUnwrap(
            CGImageDestinationCreateWithData(
                output,
                UTType.jpeg.identifier as CFString,
                1,
                nil
            )
        )
        let properties: [CFString: Any] = [
            kCGImagePropertyOrientation: CGImagePropertyOrientation.right.rawValue,
            kCGImageDestinationLossyCompressionQuality: 0.9,
        ]
        CGImageDestinationAddImage(destination, cgImage, properties as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return output as Data
    }
}
