import AVFoundation
import CoreGraphics
import Foundation
import XCTest
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
            15_000_000
        )
        XCTAssertEqual(
            StoryCaptureQuality.videoBitrate(for: .h264, is4K: false),
            20_000_000
        )
        XCTAssertEqual(
            StoryCaptureQuality.videoBitrate(for: .hevc, is4K: true),
            28_000_000
        )
        XCTAssertEqual(
            StoryCaptureQuality.videoBitrate(for: .h264, is4K: true),
            32_000_000
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

        let request = try XCTUnwrap(recorder.requests.first)
        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any]
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-UBEYE-Media-Pipeline"), "hls-v2")
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
                try await session.upload(for: request, fromFile: bodyFileURL)
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

        try await api.uploadVideoFile(fileURL: sourceURL, upload: upload, maxChunkBytes: 5)

        let requests = recorder.requests
        XCTAssertEqual(requests.map(\.httpMethod), ["HEAD", "PATCH"])
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "Upload-Offset"), "4")
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "Tus-Resumable"), "1.0.0")
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
