import AVFoundation
import CoreGraphics
import Foundation
import XCTest
import UIKit
@testable import UBEYE

final class StoryVideoGeometryNormalizerTests: XCTestCase {
    func testIdentityVideoFillsRenderCanvas() {
        assertPlan(
            naturalSize: CGSize(width: 1080, height: 1920),
            preferredTransform: .identity,
            mirrorsHorizontally: false,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    func testMirroredIdentityVideoStillFillsRenderCanvas() {
        let plan = assertPlan(
            naturalSize: CGSize(width: 1080, height: 1920),
            preferredTransform: .identity,
            mirrorsHorizontally: true,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )

        XCTAssertEqual(
            CGPoint(x: 0, y: 0).applying(plan.transform).x,
            1080,
            accuracy: 0.001
        )
        XCTAssertEqual(
            CGPoint(x: 1080, y: 0).applying(plan.transform).x,
            0,
            accuracy: 0.001
        )
    }

    func testRightRotatedPortraitVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1920, height: 1080)
        let preferredTransform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 1080, ty: 0)

        assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: false,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    func testMirroredRightRotatedPortraitVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1920, height: 1080)
        let preferredTransform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 1080, ty: 0)

        let unmirroredPlan = StoryVideoGeometryNormalizer.presentationPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: false
        )
        let mirroredPlan = assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: true,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )

        let sourceTopLeft = CGPoint(x: 0, y: 0)
        XCTAssertEqual(
            sourceTopLeft.applying(unmirroredPlan.transform).x +
                sourceTopLeft.applying(mirroredPlan.transform).x,
            mirroredPlan.renderSize.width,
            accuracy: 0.001
        )
    }

    func testLeftRotatedPortraitVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1920, height: 1080)
        let preferredTransform = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: 1920)

        assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: false,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    func testMirroredLeftRotatedPortraitVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1920, height: 1080)
        let preferredTransform = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: 1920)

        assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: true,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    func testUpsideDownVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1080, height: 1920)
        let preferredTransform = CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: 1080, ty: 1920)

        assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: true,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    func testLandscapeVideoFitsPortraitCanvasWithoutCropping() {
        let targetSize = CGSize(width: 1080, height: 1920)
        let plan = StoryVideoGeometryNormalizer.aspectFitPlan(
            naturalSize: CGSize(width: 1920, height: 1080),
            preferredTransform: .identity,
            mirrorsHorizontally: false,
            targetSize: targetSize
        )

        XCTAssertEqual(plan.renderSize, targetSize)
        XCTAssertEqual(plan.renderedSourceRect.minX, 0, accuracy: 0.001)
        XCTAssertEqual(plan.renderedSourceRect.maxX, targetSize.width, accuracy: 0.001)
        XCTAssertGreaterThan(plan.renderedSourceRect.minY, 0)
        XCTAssertLessThan(plan.renderedSourceRect.maxY, targetSize.height)
        XCTAssertEqual(
            plan.renderedSourceRect.width / plan.renderedSourceRect.height,
            16 / 9,
            accuracy: 0.001
        )
    }

    func testPortraitVideoFillsPortraitCanvasWithoutCropping() {
        let targetSize = CGSize(width: 1080, height: 1920)
        let plan = StoryVideoGeometryNormalizer.aspectFitPlan(
            naturalSize: targetSize,
            preferredTransform: .identity,
            mirrorsHorizontally: false,
            targetSize: targetSize
        )

        XCTAssertEqual(plan.renderSize, targetSize)
        XCTAssertEqual(plan.renderedSourceRect, CGRect(origin: .zero, size: targetSize))
    }

    @discardableResult
    private func assertPlan(
        naturalSize: CGSize,
        preferredTransform: CGAffineTransform,
        mirrorsHorizontally: Bool,
        expectedRenderSize: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> StoryVideoGeometryNormalizer.PresentationPlan {
        let plan = StoryVideoGeometryNormalizer.presentationPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: mirrorsHorizontally
        )

        XCTAssertEqual(plan.renderSize.width, expectedRenderSize.width, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderSize.height, expectedRenderSize.height, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderedSourceRect.minX, 0, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderedSourceRect.minY, 0, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderedSourceRect.width, expectedRenderSize.width, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderedSourceRect.height, expectedRenderSize.height, accuracy: 0.001, file: file, line: line)

        return plan
    }
}

final class StoryVideoUploadPipelineTests: XCTestCase {
    func testCommonAppleVideoContainersAndCodecsUseStreamPassthrough() {
        for (fileExtension, codec) in [("mov", "avc1"), ("mp4", "hvc1"), ("m4v", "hvc1")] {
            let inspection = makeInspection(fileExtension: fileExtension, codecTypes: [codec])
            XCTAssertTrue(inspection.hasStreamSupportedContainer)
            XCTAssertTrue(inspection.isStreamCompatibleInput)
        }
    }

    func testUnsupportedContainerOrCodecRequiresNormalization() {
        XCTAssertFalse(makeInspection(fileExtension: "avi", codecTypes: ["avc1"]).isStreamCompatibleInput)
        XCTAssertFalse(makeInspection(fileExtension: "mov", codecTypes: ["vp09"]).isStreamCompatibleInput)
        XCTAssertFalse(makeInspection(fileExtension: "mov", codecTypes: ["hev1"]).isStreamCompatibleInput)
        XCTAssertFalse(makeInspection(fileExtension: "mp4", codecTypes: []).isStreamCompatibleInput)
        XCTAssertFalse(
            makeInspection(fileExtension: "mp4", codecTypes: ["avc1"], hasFastStart: false)
                .isStreamCompatibleInput
        )
        XCTAssertTrue(
            makeInspection(fileExtension: "mp4", codecTypes: ["avc1"], hasFastStart: false)
                .canRemuxForStream
        )
        XCTAssertFalse(
            makeInspection(fileExtension: "mov", codecTypes: ["vp09"], hasFastStart: false)
                .canRemuxForStream
        )
    }

    func testFastStartInspectionRequiresMoovBeforeMediaData() async throws {
        let fastStartURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fast-start-\(UUID().uuidString).mp4")
        let slowStartURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("slow-start-\(UUID().uuidString).mp4")
        defer {
            try? FileManager.default.removeItem(at: fastStartURL)
            try? FileManager.default.removeItem(at: slowStartURL)
        }

        func atom(_ type: String) -> Data {
            Data([0, 0, 0, 8] + Array(type.utf8))
        }

        try (atom("ftyp") + atom("moov") + atom("mdat")).write(to: fastStartURL)
        try (atom("ftyp") + atom("mdat") + atom("moov")).write(to: slowStartURL)

        let fastStart = try await StoryUploadFileIO.hasFastStartMoov(at: fastStartURL)
        let slowStart = try await StoryUploadFileIO.hasFastStartMoov(at: slowStartURL)
        XCTAssertTrue(fastStart)
        XCTAssertFalse(slowStart)
    }

    func testCaptureQualityPreservesHighQualityBeforeAdaptiveTranscode() {
        XCTAssertEqual(
            StoryCaptureQuality.videoBitrate(for: .hevc, is4K: false),
            6_000_000
        )
        XCTAssertEqual(
            StoryCaptureQuality.videoBitrate(for: .h264, is4K: false),
            7_500_000
        )
        XCTAssertEqual(
            StoryCaptureQuality.videoBitrate(for: .hevc, is4K: true),
            24_000_000
        )
        XCTAssertEqual(
            StoryCaptureQuality.videoBitrate(for: .h264, is4K: true),
            30_000_000
        )
        XCTAssertEqual(
            StoryCaptureQuality.preferredCodec(from: [.h264, .hevc]),
            .hevc
        )
        XCTAssertEqual(
            StoryCaptureQuality.preferredCodec(from: [.h264]),
            .h264
        )
        XCTAssertEqual(StoryCaptureQuality.videoFrameRate, 30)
        XCTAssertEqual(StoryCaptureQuality.videoKeyFrameInterval, 30)
    }

    func testVideoPosterUsesFirstFrameInsteadOfLaterBrighterFrame() async throws {
        let videoURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("first-frame-poster-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: videoURL) }

        try await writeVideoWithDistinctFirstFrame(
            to: videoURL,
            firstFrame: (red: 180, green: 10, blue: 10),
            laterFrame: (red: 20, green: 230, blue: 240)
        )

        let image = try await StoryVideoThumbnailGenerator.firstFrame(for: videoURL)
        let pixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: image.height / 2)
        )

        XCTAssertGreaterThan(Int(pixel[0]), Int(pixel[2]) + 100)
        XCTAssertEqual(StoryVideoThumbnailGenerator.requestedTime, .zero)
    }

    func testHighBitrateCompatibleSourcePreservesOriginalQuality() async throws {
        let sourceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("high-bitrate-source-\(UUID().uuidString).mp4")
        try await writeVideoWithDistinctFirstFrame(
            to: sourceURL,
            firstFrame: (red: 60, green: 80, blue: 180),
            laterFrame: (red: 80, green: 100, blue: 200)
        )
        // Inflate the fixture without changing its streams. Compatible sources
        // retain their original encoded quality for the server-side transcode.
        try appendFreeAtom(byteCount: 5 * 1024 * 1024, to: sourceURL)
        var preparedURL: URL?
        defer {
            try? FileManager.default.removeItem(at: sourceURL)
            if let preparedURL, preparedURL != sourceURL {
                try? FileManager.default.removeItem(at: preparedURL)
            }
        }

        let sourceBytes = try FileManager.default.attributesOfItem(
            atPath: sourceURL.path
        )[.size] as? NSNumber
        let prepared = try await StoryVideoUploadNormalizer.prepare(
            url: sourceURL,
            source: .library,
            maxDurationSeconds: 120
        )
        preparedURL = prepared.url
        let hasFastStart = try await StoryUploadFileIO.hasFastStartMoov(
            at: prepared.url
        )

        XCTAssertEqual(prepared.strategy, .streamPassthrough)
        XCTAssertEqual(prepared.byteSize, try XCTUnwrap(sourceBytes).int64Value)
        XCTAssertTrue(hasFastStart)
    }

    func testEfficientCompatibleSourceDoesNotRequireReencoding() {
        let inspection = StoryVideoInspection(
            source: .library,
            originalURL: URL(fileURLWithPath: "/tmp/efficient.mp4"),
            byteSize: 15_000_000,
            durationMs: 20_000,
            naturalSize: CGSize(width: 1_080, height: 1_920),
            preferredTransform: .identity,
            codecTypes: ["hvc1"],
            hasFastStart: true
        )

        XCTAssertEqual(inspection.estimatedBitsPerSecond, 6_000_000)
        XCTAssertTrue(inspection.isStreamCompatibleInput)
    }

    func testHighBitrateCompatibleInputRemainsStreamCompatible() throws {
        let inspection = StoryVideoInspection(
            source: .library,
            originalURL: URL(fileURLWithPath: "/tmp/high-bitrate.mp4"),
            byteSize: 31_835_252,
            durationMs: 19_967,
            naturalSize: CGSize(width: 1_080, height: 1_920),
            preferredTransform: .identity,
            codecTypes: ["avc1"],
            hasFastStart: true
        )

        XCTAssertGreaterThan(try XCTUnwrap(inspection.estimatedBitsPerSecond), 8_000_000)
        XCTAssertTrue(inspection.isStreamCompatibleInput)
    }

    func testVideoUploadResponsePersistsOwnerBoundSession() throws {
        let data = Data(
            """
            {
              "ok": true,
              "uid": "stream-123",
              "uploadSessionId": "session-123",
              "uploadUrl": "https://upload.example.test/files/stream-123",
              "uploadProtocol": "tus"
            }
            """.utf8
        )

        let decoded = try JSONDecoder().decode(VideoUploadResponse.self, from: data)
        let restored = try JSONDecoder().decode(
            VideoUploadResponse.self,
            from: JSONEncoder().encode(decoded)
        )

        XCTAssertEqual(restored.uid, "stream-123")
        XCTAssertEqual(restored.uploadSessionId, "session-123")
        XCTAssertEqual(restored.uploadProtocol, "tus")
    }

    @MainActor
    func testPrepareSendsHLSv2LeaseContract() async throws {
        let recorder = UploadRequestRecorder()
        let session = makeSession { request in
            recorder.append(request)
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let body = Data(
                """
                {
                  "ok": true,
                  "uid": "stream-123",
                  "uploadSessionId": "session-123",
                  "uploadUrl": "https://upload.example.test/files/stream-123",
                  "uploadProtocol": "tus"
                }
                """.utf8
            )
            return (response, body)
        }
        defer { session.invalidateAndCancel() }

        let api = APIClient(session: session)
        api.authToken = "test-token"
        let response = try await api.prepareVideoUpload(
            fileName: "clip.mov",
            byteSize: 42,
            maxDurationSeconds: 120,
            clientUploadId: "11111111-1111-1111-1111-111111111111",
            replaceUploadSessionId: "expired-session"
        )

        let request = try XCTUnwrap(
            recorder.requests.first {
                $0.url?.path == "/api/mobile/stories/video-upload"
            }
        )
        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any]
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-UBEYE-Media-Pipeline"), "hls-v4")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(json["clientUploadId"] as? String, "11111111-1111-1111-1111-111111111111")
        XCTAssertEqual(json["replaceUploadSessionId"] as? String, "expired-session")
        XCTAssertEqual(json["contentType"] as? String, "video/quicktime")
        XCTAssertEqual(response.uploadSessionId, "session-123")
    }

    @MainActor
    func testStoryViewersUsesURLQueryItemsForInitialAndPaginatedRequests() async throws {
        let recorder = UploadRequestRecorder()
        let session = makeSession { request in
            recorder.append(request)
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let body = Data(
                """
                {
                  "ok": true,
                  "viewers": [],
                  "totalViewers": 0,
                  "totalViews": 0,
                  "nextCursor": null
                }
                """.utf8
            )
            return (response, body)
        }
        defer { session.invalidateAndCancel() }

        let api = APIClient(session: session)
        let cursor = "opaque/+?=cursor"
        _ = try await api.storyViewers(storyId: "story-123")
        _ = try await api.storyViewers(storyId: "story-123", cursor: cursor)

        let requests = recorder.requests
        XCTAssertEqual(requests.count, 2)

        for request in requests {
            let url = try XCTUnwrap(request.url)
            XCTAssertEqual(url.path, "/api/mobile/stories/story-123/viewers")
            XCTAssertFalse(url.absoluteString.contains("viewers%3F"))
            let components = try XCTUnwrap(
                URLComponents(url: url, resolvingAgainstBaseURL: false)
            )
            XCTAssertEqual(
                components.queryItems?.first(where: { $0.name == "limit" })?.value,
                "50"
            )
        }

        let initialComponents = try XCTUnwrap(
            URLComponents(url: try XCTUnwrap(requests[0].url), resolvingAgainstBaseURL: false)
        )
        XCTAssertNil(initialComponents.queryItems?.first(where: { $0.name == "cursor" }))

        let paginatedComponents = try XCTUnwrap(
            URLComponents(url: try XCTUnwrap(requests[1].url), resolvingAgainstBaseURL: false)
        )
        XCTAssertEqual(
            paginatedComponents.queryItems?.first(where: { $0.name == "cursor" })?.value,
            cursor
        )
    }

    @MainActor
    func testCloudflareImageUploadUsesSignedPutWithoutBlobCredentials() async throws {
        let recorder = UploadRequestRecorder()
        let session = makeSession { request in
            recorder.append(request)
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["ETag": "r2-etag"]
            )!
            return (response, Data())
        }
        defer { session.invalidateAndCancel() }

        let api = APIClient(session: session)
        let uploadUrl = try XCTUnwrap(
            URL(string: "https://example.r2.cloudflarestorage.com/source.jpg?X-Amz-Signature=test")
        )
        let part = ImageUploadPart(
            pathname: "stories/web-direct/creator/session-source.jpg",
            uploadUrl: uploadUrl,
            clientToken: "",
            contentType: "image/jpeg",
            maxSizeBytes: 1_024,
            access: nil,
            provider: "cloudflare-r2"
        )
        let body = Data([0xFF, 0xD8, 0xFF, 0xD9])

        let result = try await api.uploadImageData(body, part: part)

        let request = try XCTUnwrap(recorder.requests.first)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "image/jpeg")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Length"), "4")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "x-vercel-blob-access"))
        XCTAssertEqual(result.pathname, part.pathname)
        XCTAssertEqual(result.etag, "r2-etag")
    }

    @MainActor
    func testTusUploadResumesFromServerOffsetBeforeFirstPatch() async throws {
        let sourceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tus-resume-\(UUID().uuidString).mp4")
        try Data("0123456789".utf8).write(to: sourceURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: sourceURL) }

        let recorder = UploadRequestRecorder()
        let session = makeSession { request in
            recorder.append(request)
            let method = request.httpMethod ?? ""
            let offset = method == "HEAD" ? "4" : "10"
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 204,
                httpVersion: nil,
                headerFields: ["Upload-Offset": offset, "Tus-Resumable": "1.0.0"]
            )!
            return (response, Data())
        }
        defer { session.invalidateAndCancel() }

        let api = APIClient(
            session: session,
            tusChunkUploader: { request, bodyFileURL in
                XCTAssertEqual(
                    try Data(contentsOf: bodyFileURL),
                    Data("456789".utf8),
                    "The background task should receive the complete remaining upload body."
                )
                return try await session.upload(for: request, fromFile: bodyFileURL)
            }
        )
        let upload = VideoUploadResponse(
            ok: true,
            uid: "stream-123",
            uploadSessionId: "session-123",
            uploadUrl: URL(string: "https://upload.example.test/files/stream-123")!,
            uploadProtocol: "tus",
            poster: nil
        )

        _ = try await api.uploadVideoFile(fileURL: sourceURL, upload: upload, maxChunkBytes: 5)

        let requests = recorder.requests
        XCTAssertEqual(requests.map(\.httpMethod), ["HEAD", "PATCH"])
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "Upload-Offset"), "4")
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "Tus-Resumable"), "1.0.0")
    }

    func testDurableVideoStagingSurvivesRemovingComposerSource() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("stage-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("composer.mp4")
        let pending = root.appendingPathComponent("pending.mp4")
        let poster = root.appendingPathComponent("poster.jpg")
        let bytes = Data("original encoded video bytes".utf8)
        try bytes.write(to: source)
        _ = try await StoryUploadFileIO.stageVideo(sourceURL: source, destinationURL: pending,
            thumbnailData: Data("clean poster".utf8), thumbnailURL: poster)
        try FileManager.default.removeItem(at: source)
        XCTAssertEqual(try Data(contentsOf: pending), bytes)
        XCTAssertEqual(try Data(contentsOf: poster), Data("clean poster".utf8))
    }

    func testTusChunkLimitsRespectProviderBoundsAndAlignment() {
        XCTAssertEqual(TusUploadChunkPolicy.limit(1), 5_242_880)
        XCTAssertEqual(TusUploadChunkPolicy.limit(Int64.max), 209_715_200)
        XCTAssertEqual(TusUploadChunkPolicy.limit(6_000_000) % 262_144, 0)
    }

    @MainActor
    func testTusChunksContainExactSequentialSourceRanges() async throws {
        let chunk = Int(TusUploadChunkPolicy.minimum)
        let source = Data(repeating: 0x11, count: chunk) + Data(repeating: 0x22, count: chunk) + Data(repeating: 0x33, count: 17)
        let sourceURL = FileManager.default.temporaryDirectory.appendingPathComponent("tus-bounded-\(UUID()).mp4")
        try source.write(to: sourceURL)
        defer { try? FileManager.default.removeItem(at: sourceURL) }
        var acknowledged: Int64 = 0
        var offsets: [Int64] = []
        var bodies: [URL] = []
        let session = makeSession { request in
            (HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                             headerFields: ["Upload-Offset": String(acknowledged)])!, Data())
        }
        defer { session.invalidateAndCancel() }
        let api = APIClient(session: session, tusChunkUploader: { request, bodyURL in
            let offset = Int64(request.value(forHTTPHeaderField: "Upload-Offset")!)!
            let bytes = try Data(contentsOf: bodyURL)
            XCTAssertLessThanOrEqual(bytes.count, chunk)
            XCTAssertEqual(bytes, source.subdata(in: Int(offset)..<(Int(offset) + bytes.count)))
            XCTAssertEqual(offset, acknowledged)
            offsets.append(offset)
            bodies.append(bodyURL)
            acknowledged += Int64(bytes.count)
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                                           headerFields: ["Upload-Offset": String(acknowledged)])!)
        })
        let upload = VideoUploadResponse(ok: true, uid: "bounded", uploadSessionId: "session",
            uploadUrl: URL(string: "https://upload.example.test/bounded")!, uploadProtocol: "tus", poster: nil)
        _ = try await api.uploadVideoFile(fileURL: sourceURL, upload: upload, maxChunkBytes: Int64(chunk))
        XCTAssertEqual(offsets, [0, Int64(chunk), Int64(chunk * 2)])
        XCTAssertEqual(acknowledged, Int64(source.count))
        XCTAssertTrue(bodies.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) })
        XCTAssertEqual(try Data(contentsOf: sourceURL), source)
    }

    @MainActor
    func testTusRetryUsesNewServerOffsetAfterPartialAcceptance() async throws {
        let chunk = Int(TusUploadChunkPolicy.minimum)
        let source = Data(repeating: 0x51, count: chunk * 2 + 17)
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("partial-tus-\(UUID()).mp4")
        try source.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        var acknowledged: Int64 = 0
        var offsets: [Int64] = []
        var headCount = 0
        let session = makeSession { request in
            headCount += 1
            return (HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                headerFields: ["Upload-Offset": String(acknowledged)])!, Data())
        }
        defer { session.invalidateAndCancel() }
        let api = APIClient(session: session, tusChunkUploader: { request, body in
            let offset = Int64(request.value(forHTTPHeaderField: "Upload-Offset")!)!
            offsets.append(offset)
            if offsets.count == 1 {
                acknowledged = 1_024
                throw APIClientError.server("Interrupted after partial acceptance", 503)
            }
            XCTAssertEqual(offset, acknowledged)
            let bytes = try Data(contentsOf: body)
            XCTAssertEqual(bytes, source.subdata(in: Int(offset)..<(Int(offset) + bytes.count)))
            acknowledged = offset + Int64(bytes.count)
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                headerFields: ["Upload-Offset": String(acknowledged)])!)
        })
        let upload = VideoUploadResponse(ok: true, uid: "partial", uploadSessionId: "session",
            uploadUrl: URL(string: "https://upload.example.test/partial")!, uploadProtocol: "tus", poster: nil)
        _ = try await api.uploadVideoFile(fileURL: file, upload: upload, maxChunkBytes: Int64(chunk))
        XCTAssertEqual(headCount, 2)
        XCTAssertEqual(offsets, [0, 1_024, Int64(chunk) + 1_024])
        XCTAssertEqual(acknowledged, Int64(source.count))
    }

    @MainActor
    func testBackgroundTusDelegateContinuesMultipleChunksWithoutForegroundLoop() async throws {
        let chunk = TusUploadChunkPolicy.minimum
        let total = chunk * 2 + 19
        let sourceURL = FileManager.default.temporaryDirectory.appendingPathComponent("tus-delegate-\(UUID()).mp4")
        let bodyURL = FileManager.default.temporaryDirectory.appendingPathComponent("tus-first-\(UUID()).upload")
        try Data(repeating: 0x44, count: Int(total)).write(to: sourceURL)
        try Data(repeating: 0x44, count: Int(chunk)).write(to: bodyURL)
        defer {
            try? FileManager.default.removeItem(at: sourceURL)
            try? FileManager.default.removeItem(at: bodyURL)
        }
        let recorder = UploadRequestRecorder()
        let mockSession = makeSession { request in
            recorder.append(request)
            let offset = Int64(request.value(forHTTPHeaderField: "Upload-Offset")!)!
            return (HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                headerFields: ["Upload-Offset": String(min(total, offset + chunk))])!, Data())
        }
        defer { mockSession.invalidateAndCancel() }
        let transport = BackgroundTusUploadTransport(configuration: mockSession.configuration)
        let uploadURL = URL(string: "https://upload.example.test/delegate")!
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PATCH"
        request.setValue("0", forHTTPHeaderField: "Upload-Offset")
        let (_, response) = try await transport.upload(request: request, bodyFileURL: bodyURL,
            chain: .init(sourceURL: sourceURL, uploadURL: uploadURL, totalBytes: total,
                         offset: 0, length: chunk, limit: chunk, bufferBytes: 262_144))
        XCTAssertEqual(recorder.requests.map { $0.value(forHTTPHeaderField: "Upload-Offset") }, ["0", String(chunk), String(chunk * 2)])
        XCTAssertEqual((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Upload-Offset"), String(total))
        XCTAssertFalse(FileManager.default.fileExists(atPath: bodyURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: sourceURL.path))
    }

    @MainActor
    func testAdaptiveBackgroundTusDelegateUsesMeasuredChunkSize() async throws {
        let chunk = TusUploadChunkPolicy.minimum
        let total = chunk * 3 + 19
        let sourceURL = FileManager.default.temporaryDirectory.appendingPathComponent("adaptive-chain-\(UUID()).mp4")
        let bodyURL = FileManager.default.temporaryDirectory.appendingPathComponent("adaptive-first-\(UUID()).upload")
        try Data(repeating: 0x44, count: Int(total)).write(to: sourceURL)
        try Data(repeating: 0x44, count: Int(chunk)).write(to: bodyURL)
        defer { try? FileManager.default.removeItem(at: sourceURL); try? FileManager.default.removeItem(at: bodyURL) }
        let recorder = UploadRequestRecorder()
        let mockSession = makeSession { request in
            recorder.append(request)
            Thread.sleep(forTimeInterval: 0.15)
            let offset = Int64(request.value(forHTTPHeaderField: "Upload-Offset")!)!
            let length = offset == 0 ? chunk : offset == chunk ? chunk * 2 : 19
            return (HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                headerFields: ["Upload-Offset": String(offset + length)])!, Data())
        }
        defer { mockSession.invalidateAndCancel() }
        let transport = BackgroundTusUploadTransport(configuration: mockSession.configuration)
        let controller = AdaptiveTusChunkController(maximum: chunk * 4, initial: chunk, enabled: true)
        let url = URL(string: "https://upload.example.test/adaptive-delegate")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"; request.setValue("0", forHTTPHeaderField: "Upload-Offset")
        let (_, response) = try await transport.upload(request: request, bodyFileURL: bodyURL,
            chain: .init(sourceURL: sourceURL, uploadURL: url, totalBytes: total,
                offset: 0, length: chunk, limit: chunk, bufferBytes: 262_144, controller: controller))
        XCTAssertEqual(recorder.requests.map { $0.value(forHTTPHeaderField: "Upload-Offset") }, ["0", String(chunk), String(chunk * 3)])
        XCTAssertEqual((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Upload-Offset"), String(total))
        XCTAssertTrue(FileManager.default.fileExists(atPath: sourceURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: bodyURL.path))
    }

    @MainActor
    func testTusCancellationDoesNotRetryOrDeletePendingSource() async throws {
        let sourceURL = FileManager.default.temporaryDirectory.appendingPathComponent("tus-cancel-\(UUID()).mp4")
        try Data("source".utf8).write(to: sourceURL)
        defer { try? FileManager.default.removeItem(at: sourceURL) }
        var calls = 0
        let session = makeSession { request in
            (HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                             headerFields: ["Upload-Offset": "0"])!, Data())
        }
        defer { session.invalidateAndCancel() }
        let api = APIClient(session: session, tusChunkUploader: { _, _ in
            calls += 1
            throw CancellationError()
        })
        let upload = VideoUploadResponse(ok: true, uid: "cancel", uploadSessionId: "session",
            uploadUrl: URL(string: "https://upload.example.test/cancel")!, uploadProtocol: "tus", poster: nil)
        do { _ = try await api.uploadVideoFile(fileURL: sourceURL, upload: upload); XCTFail("Expected cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(calls, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: sourceURL.path))
    }

    @MainActor
    func testComposerReusesPreparationAndInvalidatesChangedSource() async throws {
        let sourceURL = FileManager.default.temporaryDirectory.appendingPathComponent("draft-prep-\(UUID()).mov")
        try await writeVideoWithDistinctFirstFrame(to: sourceURL, firstFrame: (red: 200, green: 10, blue: 10), laterFrame: (red: 10, green: 10, blue: 200))
        let store = StoryComposerStore()
        let selected = StoryVideoUpload(url: sourceURL, source: .library)
        store.selectedMedia = .video(selected)
        let first = try await store.preparedVideo(for: selected)
        store.textOverlay = "Edited caption"
        let reused = try await store.preparedVideo(for: selected)
        XCTAssertEqual(first.url, reused.url)
        XCTAssertEqual(first.byteSize, reused.byteSize)
        try appendFreeAtom(byteCount: 512, to: sourceURL)
        let refreshed = try await store.preparedVideo(for: selected)
        XCTAssertEqual(refreshed.inspection.byteSize, first.inspection.byteSize + 512)
        store.selectedMedia = nil
        try? FileManager.default.removeItem(at: sourceURL)
    }

    @MainActor
    func testPrivateBlobVideoUploadUsesOwnerBoundTokenAndFileTransport() async throws {
        let sourceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("blob-source-\(UUID().uuidString).mp4")
        try Data("private-video".utf8).write(to: sourceURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: sourceURL) }

        let recorder = UploadRequestRecorder()
        var stagedFileURL: URL?
        let api = APIClient(tusChunkUploader: { request, bodyFileURL in
            recorder.append(request)
            stagedFileURL = bodyFileURL
            XCTAssertNotEqual(bodyFileURL, sourceURL)
            XCTAssertEqual(try Data(contentsOf: bodyFileURL), Data("private-video".utf8))
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (Data("{}".utf8), response)
        })
        var upload = VideoUploadResponse(
            ok: true,
            uid: "media-originals/creator/session/source.mp4",
            uploadSessionId: "session-blob",
            uploadUrl: URL(string: "https://blob.vercel-storage.com?pathname=source")!,
            uploadProtocol: "vercel-blob",
            poster: nil
        )
        upload.source = ImageUploadPart(
            pathname: upload.uid,
            uploadUrl: upload.uploadUrl,
            clientToken: "vercel_blob_client_test_store_token",
            contentType: "video/mp4",
            maxSizeBytes: 1_024,
            access: "private"
        )
        XCTAssertTrue(upload.supportsDirectVideoUpload)

        _ = try await api.uploadVideoFile(fileURL: sourceURL, upload: upload)

        let request = try XCTUnwrap(recorder.requests.first)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Authorization"),
            "Bearer vercel_blob_client_test_store_token"
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-vercel-blob-access"), "private")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-content-type"), "video/mp4")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-version"), "12")
        XCTAssertTrue(FileManager.default.fileExists(atPath: sourceURL.path))
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: try XCTUnwrap(stagedFileURL).path
            )
        )
    }

    @MainActor
    func testPrivateBlobVideoRetryPreservesOriginalAndRestagesBodyFile() async throws {
        let sourceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("blob-retry-source-\(UUID().uuidString).mp4")
        try Data("retry-private-video".utf8).write(to: sourceURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: sourceURL) }

        var stagedFileURLs: [URL] = []
        let api = APIClient(tusChunkUploader: { request, bodyFileURL in
            stagedFileURLs.append(bodyFileURL)
            XCTAssertNotEqual(bodyFileURL, sourceURL)
            XCTAssertTrue(FileManager.default.fileExists(atPath: bodyFileURL.path))
            try FileManager.default.removeItem(at: bodyFileURL)

            let statusCode = stagedFileURLs.count == 1 ? 503 : 200
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: statusCode,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (Data("{}".utf8), response)
        })
        var upload = VideoUploadResponse(
            ok: true,
            uid: "media-originals/creator/session/retry-source.mp4",
            uploadSessionId: "session-blob-retry",
            uploadUrl: URL(string: "https://blob.vercel-storage.com?pathname=retry-source")!,
            uploadProtocol: "vercel-blob",
            poster: nil
        )
        upload.source = ImageUploadPart(
            pathname: upload.uid,
            uploadUrl: upload.uploadUrl,
            clientToken: "vercel_blob_client_retry_store_token",
            contentType: "video/mp4",
            maxSizeBytes: 1_024,
            access: "private"
        )

        _ = try await api.uploadVideoFile(fileURL: sourceURL, upload: upload)

        XCTAssertEqual(stagedFileURLs.count, 2)
        XCTAssertNotEqual(stagedFileURLs[0], stagedFileURLs[1])
        XCTAssertTrue(FileManager.default.fileExists(atPath: sourceURL.path))
        XCTAssertTrue(
            stagedFileURLs.allSatisfy {
                !FileManager.default.fileExists(atPath: $0.path)
            }
        )
    }

    @MainActor
    func testEightMegabytePrivateBlobVideoUsesTwoPartResumableUpload() async throws {
        let sourceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("blob-multipart-\(UUID().uuidString).mp4")
        FileManager.default.createFile(atPath: sourceURL.path, contents: nil)
        let output = try FileHandle(forWritingTo: sourceURL)
        try output.truncate(atOffset: 8 * 1024 * 1024)
        try output.close()
        defer { try? FileManager.default.removeItem(at: sourceURL) }

        let requestRecorder = UploadRequestRecorder()
        let session = makeSession { request in
            requestRecorder.append(request)
            let action = request.value(forHTTPHeaderField: "x-mpu-action")
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            switch action {
            case "create":
                return (response, Data("{\"uploadId\":\"upload-1\",\"key\":\"folder/source.mp4\"}".utf8))
            case "complete":
                return (response, Data("{}".utf8))
            default:
                XCTFail("Unexpected direct multipart action \(action ?? "nil")")
                return (response, Data("{}".utf8))
            }
        }
        defer { session.invalidateAndCancel() }

        let partRecorder = UploadRequestRecorder()
        let api = APIClient(
            session: session,
            tusChunkUploader: { request, bodyFileURL in
                partRecorder.append(request)
                let partNumber = try XCTUnwrap(
                    request.value(forHTTPHeaderField: "x-mpu-part-number")
                )
                let partSize = try XCTUnwrap(
                    FileManager.default.attributesOfItem(atPath: bodyFileURL.path)[.size]
                        as? NSNumber
                )
                let expectedPartSize = partNumber == "1"
                    ? 5 * 1024 * 1024
                    : 3 * 1024 * 1024
                XCTAssertEqual(partSize.int64Value, Int64(expectedPartSize))
                let response = HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!
                return (Data("{\"etag\":\"etag-\(partNumber)\"}".utf8), response)
            },
            blobMultipartThresholdBytes: 8 * 1024 * 1024,
            blobMultipartPartBytes: 5 * 1024 * 1024,
            blobMultipartConcurrency: 4
        )
        let pathname = "media-originals/creator/\(UUID().uuidString)/source.mp4"
        var upload = VideoUploadResponse(
            ok: true,
            uid: pathname,
            uploadSessionId: "session-blob-multipart",
            uploadUrl: URL(string: "https://blob.vercel-storage.com?pathname=source")!,
            uploadProtocol: "vercel-blob",
            poster: nil
        )
        upload.source = ImageUploadPart(
            pathname: pathname,
            uploadUrl: upload.uploadUrl,
            clientToken: "vercel_blob_client_test_store_token",
            contentType: "video/mp4",
            maxSizeBytes: 32 * 1024 * 1024,
            access: "private"
        )

        _ = try await api.uploadVideoFile(fileURL: sourceURL, upload: upload)

        let partRequests = partRecorder.requests.sorted {
            ($0.value(forHTTPHeaderField: "x-mpu-part-number") ?? "") <
                ($1.value(forHTTPHeaderField: "x-mpu-part-number") ?? "")
        }
        XCTAssertEqual(
            partRequests.compactMap { $0.value(forHTTPHeaderField: "x-mpu-part-number") },
            ["1", "2"]
        )
        XCTAssertTrue(
            partRequests.allSatisfy {
                $0.value(forHTTPHeaderField: "x-mpu-key") == "folder%2Fsource.mp4"
            }
        )
        XCTAssertEqual(
            requestRecorder.requests.compactMap {
                $0.value(forHTTPHeaderField: "x-mpu-action")
            },
            ["create", "complete"]
        )
        let completionBody = try XCTUnwrap(requestRecorder.requests.last?.httpBody)
        let completionParts = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: completionBody) as? [[String: Any]]
        )
        XCTAssertEqual(completionParts.count, 2)
        XCTAssertEqual(completionParts.compactMap { $0["partNumber"] as? Int }, [1, 2])
    }

    @MainActor
    func testMultipartUploadResumesOnlyMissingPartsAfterFailure() async throws {
        let sourceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("blob-multipart-resume-\(UUID().uuidString).mp4")
        FileManager.default.createFile(atPath: sourceURL.path, contents: nil)
        let output = try FileHandle(forWritingTo: sourceURL)
        try output.truncate(atOffset: 15 * 1024 * 1024)
        try output.close()
        defer { try? FileManager.default.removeItem(at: sourceURL) }

        let controlRecorder = UploadRequestRecorder()
        let session = makeSession { request in
            controlRecorder.append(request)
            let action = request.value(forHTTPHeaderField: "x-mpu-action")
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            if action == "create" {
                return (response, Data("{\"uploadId\":\"resume-upload\",\"key\":\"folder/resume.mp4\"}".utf8))
            }
            return (response, Data("{}".utf8))
        }
        defer { session.invalidateAndCancel() }

        let partRecorder = UploadRequestRecorder()
        var partThreeAttempts = 0
        let api = APIClient(
            session: session,
            tusChunkUploader: { request, _ in
                partRecorder.append(request)
                let partNumber = try XCTUnwrap(
                    request.value(forHTTPHeaderField: "x-mpu-part-number")
                )
                if partNumber == "3" {
                    partThreeAttempts += 1
                }
                let shouldFail = partNumber == "3" && partThreeAttempts == 1
                let response = HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: shouldFail ? 400 : 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!
                return (
                    shouldFail
                        ? Data("{\"error\":{\"message\":\"part interrupted\"}}".utf8)
                        : Data("{\"etag\":\"etag-\(partNumber)\"}".utf8),
                    response
                )
            },
            blobMultipartThresholdBytes: 8 * 1024 * 1024,
            blobMultipartPartBytes: 5 * 1024 * 1024,
            blobMultipartConcurrency: 4
        )
        let pathname = "media-originals/creator/\(UUID().uuidString)/resume.mp4"
        var upload = VideoUploadResponse(
            ok: true,
            uid: pathname,
            uploadSessionId: "session-blob-multipart-resume",
            uploadUrl: URL(string: "https://blob.vercel-storage.com?pathname=resume")!,
            uploadProtocol: "vercel-blob",
            poster: nil
        )
        upload.source = ImageUploadPart(
            pathname: pathname,
            uploadUrl: upload.uploadUrl,
            clientToken: "vercel_blob_client_resume_store_token",
            contentType: "video/mp4",
            maxSizeBytes: 32 * 1024 * 1024,
            access: "private"
        )

        do {
            _ = try await api.uploadVideoFile(fileURL: sourceURL, upload: upload)
            XCTFail("The interrupted part should fail the first upload attempt.")
        } catch {
            XCTAssertEqual((error as? APIClientError)?.statusCode, 400)
        }
        _ = try await api.uploadVideoFile(fileURL: sourceURL, upload: upload)

        XCTAssertEqual(
            partRecorder.requests.compactMap {
                $0.value(forHTTPHeaderField: "x-mpu-part-number")
            }.sorted(),
            ["1", "2", "3", "3"]
        )
        XCTAssertEqual(
            controlRecorder.requests.compactMap {
                $0.value(forHTTPHeaderField: "x-mpu-action")
            },
            ["create", "complete"]
        )
    }

    @MainActor
    func testDecodedFirstFrameSurvivesPersistentLayerHandoff() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("persistent-layer-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: url) }
        try await writeVideoWithDistinctFirstFrame(to: url, firstFrame: (180, 10, 10), laterFrame: (20, 230, 240))
        let player = AVPlayer(url: url)
        player.isMuted = true
        let surface = AspectFitPlayerView(frame: CGRect(x: 0, y: 0, width: 360, height: 640))
        surface.attach(player)
        let first = StoryVideoSurfaceHost(frame: surface.bounds)
        let second = StoryVideoSurfaceHost(frame: surface.bounds)
        let root = UIViewController()
        root.view.addSubview(first)
        root.view.addSubview(second)
        let window: UIWindow
        if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
            window = UIWindow(windowScene: scene)
        } else { window = UIWindow(frame: surface.bounds) }
        window.frame = surface.bounds
        window.rootViewController = root
        window.isHidden = false
        defer { window.isHidden = true; surface.attach(nil); player.replaceCurrentItem(with: nil) }
        first.install(surface)
        root.view.layoutIfNeeded()
        for _ in 0..<250 {
            if player.currentItem?.status == .readyToPlay { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(player.currentItem?.status, .readyToPlay)
        let didPreroll = await player.preroll(atRate: 1)
        XCTAssertTrue(didPreroll)
        player.pause()
        for _ in 0..<250 {
            if surface.playerLayer.isReadyForDisplay { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertTrue(surface.playerLayer.isReadyForDisplay, "The fixture must have an actual decoded first frame")
        let originalLayer = surface.playerLayer
        let started = ContinuousClock.now
        second.install(surface)
        first.install(nil)
        root.view.layoutIfNeeded()
        XCTAssertTrue(surface.playerLayer === originalLayer)
        XCTAssertTrue(surface.playerLayer.isReadyForDisplay, "Handoff must not clear the decoded first frame")
        XCTAssertTrue(surface.player === player)
        XCTAssertEqual(player.currentTime().seconds, 0, accuracy: 0.01)
        print("PERSISTENT_LAYER_HANDOFF ready=true elapsed=\(started.duration(to: .now))")
        let source = StoryVideoPlaybackSource.urlBacked(url)
        var builds = 0
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { url in
            builds += 1
            return .init(player: player, playbackURL: url, cacheState: "hit", wasPrerolled: true, displaySurface: surface)
        }
        pool.prepare(sources: [source], activeIdentity: nil)
        for _ in 0..<10 { await Task.yield() }
        let controller = AutoPlayVideoPlaybackController()
        controller.setVisible(false)
        controller.play(source: source, expectedDuration: 3, playerPool: pool, refreshSource: { nil }, isPaused: true, onReadyForPlayback: {}, onProgress: { _ in }, onFinished: {})
        for _ in 0..<100 {
            if controller.player != nil { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(controller.player === player)
        XCTAssertTrue(controller.displaySurface === surface)
        controller.playerDidAttach(player)
        controller.revealVideo(player: player, reason: "test_prepared_layer")
        XCTAssertTrue(controller.isReadyForPlayback)
        XCTAssertEqual(player.rate, 0)
        controller.setMuted(false)
        XCTAssertTrue(player.isMuted, "A prepared hidden frame must stay silent")
        controller.setVisible(true)
        controller.setPaused(false)
        XCTAssertTrue(controller.player === player)
        XCTAssertTrue(controller.isReadyForPlayback)
        XCTAssertFalse(player.isMuted)
        pool.prepare(sources: [source], activeIdentity: nil)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(builds, 1)
        controller.stop(reason: "test_cleanup")
        pool.removeAll()

    }

    private func makeInspection(
        fileExtension: String,
        codecTypes: [String],
        hasFastStart: Bool = true
    ) -> StoryVideoInspection {
        StoryVideoInspection(
            source: .library,
            originalURL: URL(fileURLWithPath: "/tmp/clip.\(fileExtension)"),
            byteSize: 1_024,
            durationMs: 1_000,
            naturalSize: CGSize(width: 1080, height: 1920),
            preferredTransform: .identity,
            codecTypes: codecTypes,
            hasFastStart: hasFastStart
        )
    }

    private func writeVideoWithDistinctFirstFrame(
        to url: URL,
        firstFrame: (red: UInt8, green: UInt8, blue: UInt8),
        laterFrame: (red: UInt8, green: UInt8, blue: UInt8)
    ) async throws {
        let width = 64
        let height = 64
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        let input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
            ]
        )
        input.expectsMediaDataInRealTime = false

        guard writer.canAdd(input) else {
            throw StoryVideoFixtureError.couldNotAddWriterInput
        }
        writer.add(input)

        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
                kCVPixelBufferCGImageCompatibilityKey as String: true,
                kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
            ]
        )

        guard writer.startWriting() else {
            throw writer.error ?? StoryVideoFixtureError.couldNotStartWriter
        }
        writer.startSession(atSourceTime: .zero)

        // Repeating the bright later frame extends the clip beyond two seconds,
        // placing it at the midpoint that the previous scoring algorithm sampled.
        let frames = [firstFrame, laterFrame, laterFrame]
        for (index, color) in frames.enumerated() {
            try await waitUntilReadyForVideoData(input)
            let pixelBuffer = try makePixelBuffer(
                width: width,
                height: height,
                color: color
            )
            let presentationTime = CMTime(seconds: Double(index), preferredTimescale: 600)
            guard adaptor.append(pixelBuffer, withPresentationTime: presentationTime) else {
                throw writer.error ?? StoryVideoFixtureError.couldNotAppendFrame
            }
        }

        input.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else {
            throw writer.error ?? StoryVideoFixtureError.couldNotFinishWriter
        }
    }

    private func appendFreeAtom(byteCount: Int, to url: URL) throws {
        let resolvedByteCount = max(byteCount, 8)
        var bigEndianSize = UInt32(resolvedByteCount).bigEndian
        var atom = Data(bytes: &bigEndianSize, count: MemoryLayout<UInt32>.size)
        atom.append(Data("free".utf8))
        atom.append(Data(repeating: 0, count: resolvedByteCount - 8))
        let handle = try FileHandle(forWritingTo: url)
        try handle.seekToEnd()
        try handle.write(contentsOf: atom)
        try handle.close()
    }

    private func waitUntilReadyForVideoData(
        _ input: AVAssetWriterInput
    ) async throws {
        for _ in 0..<200 {
            if input.isReadyForMoreMediaData {
                return
            }
            try await Task.sleep(for: .milliseconds(5))
        }
        throw StoryVideoFixtureError.writerInputTimedOut
    }

    private func makePixelBuffer(
        width: Int,
        height: Int,
        color: (red: UInt8, green: UInt8, blue: UInt8)
    ) throws -> CVPixelBuffer {
        var pixelBuffer: CVPixelBuffer?
        let attributes: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
        ]
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            attributes as CFDictionary,
            &pixelBuffer
        )
        guard status == kCVReturnSuccess, let pixelBuffer else {
            throw StoryVideoFixtureError.couldNotCreatePixelBuffer(status)
        }

        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            throw StoryVideoFixtureError.pixelBufferHasNoBaseAddress
        }

        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        for row in 0..<height {
            let bytes = baseAddress
                .advanced(by: row * bytesPerRow)
                .assumingMemoryBound(to: UInt8.self)
            for column in 0..<width {
                let offset = column * 4
                bytes[offset] = color.blue
                bytes[offset + 1] = color.green
                bytes[offset + 2] = color.red
                bytes[offset + 3] = 255
            }
        }

        return pixelBuffer
    }

    private func rgbaPixel(in image: CGImage, x: Int, y: Int) -> [UInt8]? {
        guard let pixelImage = image.cropping(
            to: CGRect(x: x, y: y, width: 1, height: 1)
        ) else {
            return nil
        }

        let bytes = UnsafeMutablePointer<UInt8>.allocate(capacity: 4)
        defer { bytes.deallocate() }
        bytes.initialize(repeating: 0, count: 4)

        guard let context = CGContext(
            data: bytes,
            width: 1,
            height: 1,
            bitsPerComponent: 8,
            bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }

        context.draw(pixelImage, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return Array(UnsafeBufferPointer(start: bytes, count: 4))
    }

    private func makeSession(
        handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> URLSession {
        UploadURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UploadURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

private enum StoryVideoFixtureError: Error {
    case couldNotAddWriterInput
    case couldNotAppendFrame
    case couldNotCreatePixelBuffer(CVReturn)
    case couldNotFinishWriter
    case couldNotStartWriter
    case pixelBufferHasNoBaseAddress
    case writerInputTimedOut
}

private final class UploadRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [URLRequest] = []

    var requests: [URLRequest] {
        lock.withLock { storage }
    }

    func append(_ request: URLRequest) {
        var capturedRequest = request
        if capturedRequest.httpBody == nil,
           let bodyStream = capturedRequest.httpBodyStream,
           let body = Self.readBody(from: bodyStream) {
            capturedRequest.httpBodyStream = nil
            capturedRequest.httpBody = body
        }

        lock.withLock { storage.append(capturedRequest) }
    }

    private static func readBody(from stream: InputStream) -> Data? {
        stream.open()
        defer { stream.close() }

        var body = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while true {
            let bytesRead = buffer.withUnsafeMutableBufferPointer { buffer in
                guard let baseAddress = buffer.baseAddress else { return 0 }
                return stream.read(baseAddress, maxLength: buffer.count)
            }

            if bytesRead < 0 {
                return nil
            }
            if bytesRead == 0 {
                return body
            }
            body.append(contentsOf: buffer.prefix(bytesRead))
        }
    }
}

private final class UploadURLProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: APIClientError.invalidResponse)
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            if !data.isEmpty {
                client?.urlProtocol(self, didLoad: data)
            }
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
