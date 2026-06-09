import AVFoundation
import Foundation
import UniformTypeIdentifiers
import XCTest
@testable import UBEYE

final class StoryMediaIngestorTests: XCTestCase {
    func testLibraryVideoContentTypesWinOverImageThumbnails() {
        XCTAssertEqual(
            StoryMediaIngestor.preferredLibraryMediaKind(for: [.image, .quickTimeMovie]),
            .video
        )
    }

    func testLibraryImageContentTypesStayImageOnly() {
        XCTAssertEqual(
            StoryMediaIngestor.preferredLibraryMediaKind(for: [.heic, .jpeg]),
            .image
        )
    }

    func testCameraFrontVideoKeepsMirroredFallback() {
        let media = StoryMediaIngestor.readyMedia(
            fromCameraVideoURL: URL(fileURLWithPath: "/tmp/front.mov"),
            cameraPosition: .front
        )

        guard case .video(let upload) = media else {
            XCTFail("Expected video media")
            return
        }

        XCTAssertEqual(upload.source, .cameraFront)
        XCTAssertTrue(upload.source.mirrorsNormalizedFallback)
    }

    func testCameraBackVideoDoesNotMirrorFallback() {
        let media = StoryMediaIngestor.readyMedia(
            fromCameraVideoURL: URL(fileURLWithPath: "/tmp/back.mov"),
            cameraPosition: .back
        )

        guard case .video(let upload) = media else {
            XCTFail("Expected video media")
            return
        }

        XCTAssertEqual(upload.source, .cameraBack)
        XCTAssertFalse(upload.source.mirrorsNormalizedFallback)
    }

    func testStoryImageFormatRecognizesHeic() {
        let format = StoryImageFormat(data: isoBrandData("heic"))

        XCTAssertEqual(format.fileExtension, "heic")
        XCTAssertEqual(format.mimeType, "image/heic")
    }

    func testStoryImageFormatRecognizesAvif() {
        let format = StoryImageFormat(data: isoBrandData("avif"))

        XCTAssertEqual(format.fileExtension, "avif")
        XCTAssertEqual(format.mimeType, "image/avif")
    }

    private func isoBrandData(_ brand: String) -> Data {
        var data = Data([0, 0, 0, 0])
        data.append(contentsOf: "ftyp".utf8)
        data.append(contentsOf: brand.utf8)
        return data
    }
}
