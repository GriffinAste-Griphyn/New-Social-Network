import XCTest
@testable import UBEYE

final class StoryUploadFastPathTests: XCTestCase {
    @MainActor
    func testShortVideoWithTinyTailTransfersExactSourceInOnePatch() async throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("tail-\(UUID()).mp4")
        let bytes = Data(repeating: 0x6d, count: 5_328_071)
        try bytes.write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }
        var patches = 0
        let api = APIClient(tusChunkUploader: { request, body in
            patches += 1
            XCTAssertEqual(request.httpMethod, "PATCH")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Upload-Offset"), "0")
            XCTAssertEqual(try Data(contentsOf: body), bytes)
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                headerFields: ["Upload-Offset": String(bytes.count)])!)
        })
        let upload = VideoUploadResponse(ok: true, uid: "tail", uploadSessionId: "tail-lease",
            uploadUrl: URL(string: "https://upload.invalid/\(UUID())")!, uploadProtocol: "tus", poster: nil, freshUpload: true)
        let controller = AdaptiveTusChunkController(maximum: 20 * 1024 * 1024, initial: 5 * 1024 * 1024, enabled: true)
        _ = try await api.uploadVideoFile(fileURL: source, upload: upload, chunkController: controller)
        XCTAssertEqual(patches, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }
    @MainActor
    func testFreshSessionSkipsHeadButPartialFailureAndRepeatedHintRecheckOffset() async throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("fresh-\(UUID()).mp4")
        try Data("0123456789".utf8).write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }
        var heads = 0
        FastPathURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "HEAD")
            heads += 1
            return (HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                headerFields: ["Upload-Offset": heads == 1 ? "4" : "10"])!, Data())
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FastPathURLProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); FastPathURLProtocol.handler = nil }
        var patches = 0
        let api = APIClient(session: session, tusChunkUploader: { request, file in
            patches += 1
            XCTAssertFalse(request.allowsCellularAccess)
            XCTAssertFalse(request.allowsExpensiveNetworkAccess)
            XCTAssertFalse(request.allowsConstrainedNetworkAccess)
            if patches == 1 {
                XCTAssertEqual(heads, 0)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Upload-Offset"), "0")
                XCTAssertEqual(try Data(contentsOf: file), Data("0123456789".utf8))
                throw URLError(.networkConnectionLost)
            }
            XCTAssertEqual(heads, 1)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Upload-Offset"), "4")
            XCTAssertEqual(try Data(contentsOf: file), Data("456789".utf8))
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                headerFields: ["Upload-Offset": "10"])!)
        })
        let upload = VideoUploadResponse(ok: true, uid: "video", uploadSessionId: "session",
            uploadUrl: URL(string: "https://upload.invalid/fresh")!, uploadProtocol: "tus", poster: nil,
            freshUpload: true)
        _ = try await api.uploadVideoFile(fileURL: source, upload: upload, unmeteredOnly: true)
        _ = try await api.uploadVideoFile(fileURL: source, upload: upload, unmeteredOnly: true)
        XCTAssertEqual(heads, 2)
        XCTAssertEqual(patches, 2)
    }

    @MainActor
    func testReadinessHintBetweenStatusReadAndWaitIsNotLost() async {
        let signals = StoryReadinessSignals()
        let generation = signals.generation(for: "story")
        signals.signal(storyId: "story")
        let start = Date()
        await signals.wait(storyId: "story", after: generation, milliseconds: 5_000)
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.5)
    }

    @MainActor
    func testReadinessSignalWakesWaitAndCancellationDoesNotHang() async {
        let signals = StoryReadinessSignals()
        let started = expectation(description: "wait started")
        let wait = Task { @MainActor in
            started.fulfill()
            await signals.wait(storyId: "story", after: 0, milliseconds: 5_000)
        }
        await fulfillment(of: [started], timeout: 1)
        signals.signal(storyId: "story")
        await wait.value
        let cancelled = Task { @MainActor in
            await signals.wait(storyId: "other", after: 0, milliseconds: 5_000)
        }
        cancelled.cancel()
        let start = Date()
        await cancelled.value
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.5)
    }

    @MainActor
    func testPrivateDraftBytesAndReceiptSurviveDurableAdoptionAndRelaunch() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("draft-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source.mp4")
        try Data("private video bytes".utf8).write(to: source)
        let fingerprint = try await StoryUploadFileFingerprint.read(source)
        let checksum = try await StoryUploadFileIO.sha256Hex(at: source)
        let inspection = StoryVideoInspection(source: .library, originalURL: source,
            byteSize: fingerprint.byteSize, durationMs: 1_000, naturalSize: nil,
            preferredTransform: nil, codecTypes: [], hasFastStart: true)
        let video = PreparedStoryVideo(url: source, durationMs: 1_000, byteSize: fingerprint.byteSize,
            strategy: .streamPassthrough, inspection: inspection)
        let receipt = StoryDraftVideoUpload(clientUploadId: UUID().uuidString.lowercased(), video: video,
            upload: VideoUploadResponse(ok: true, uid: "private", uploadSessionId: "lease",
                uploadUrl: URL(string: "https://upload.invalid/private")!, uploadProtocol: "tus", poster: nil),
            blobUploadId: "multipart-receipt", checksum: checksum, fingerprint: fingerprint, originalFingerprint: fingerprint)
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library,
            preparedVideo: video, draftUpload: receipt, draft: draft, textOverlays: [])
        try FileManager.default.removeItem(at: source)
        _ = await store.flushPersistence()
        let restored = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        _ = await restored.flushPersistence()
        let upload = try XCTUnwrap(restored.uploads.first)
        XCTAssertEqual(upload.id, pending.id)
        XCTAssertEqual(upload.preuploadedVideoSessionId, "lease")
        XCTAssertEqual(upload.preuploadedBlobUploadId, "multipart-receipt")
        XCTAssertEqual(upload.preparedSourceChecksum, checksum)
        XCTAssertEqual(upload.draft.caption, "Final caption")
        let ownedChecksum = try await StoryUploadFileIO.sha256Hex(at: upload.mediaFileURL)
        XCTAssertEqual(ownedChecksum, checksum)
    }

    @MainActor
    func testPrivateUnmeteredEditingUploadIsOnByDefault() throws {
        let suite = "early-upload-\(UUID())"
        let preferences = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        XCTAssertTrue(StoryComposerStore(preferences: preferences).uploadWhileEditing)
    }

    @MainActor
    func testEarlyUploadPreferenceSurvivesDismissalAndCanBeRevoked() throws {
        let suite = "early-upload-\(UUID())"
        let preferences = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let api = APIClient()
        let store = StoryComposerStore(preferences: preferences)
        store.setUploadWhileEditing(true, api: api, media: [])
        store.suspendEarlyUpload(api: api)
        XCTAssertFalse(store.uploadWhileEditing)
        store.resumeEarlyUpload(api: api, media: [])
        XCTAssertTrue(store.uploadWhileEditing)
        XCTAssertTrue(StoryComposerStore(preferences: preferences).uploadWhileEditing)
        store.setUploadWhileEditing(false, api: api, media: [])
        XCTAssertFalse(StoryComposerStore(preferences: preferences).uploadWhileEditing)
    }

    @MainActor
    func testSubmittedDraftReusesBytesOnlyAfterServerConfirmsSameLease() async throws {
        for sameLease in [true, false] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("draft-commit-\(UUID())")
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: root) }
            let source = root.appendingPathComponent("source.mp4")
            func atom(_ name: String) -> Data { Data([0, 0, 0, 8] + Array(name.utf8)) }
            let bytes = atom("ftyp") + atom("moov") + atom("mdat")
            try bytes.write(to: source)
            let fingerprint = try await StoryUploadFileFingerprint.read(source)
            let checksum = try await StoryUploadFileIO.sha256Hex(at: source)
            let video = PreparedStoryVideo(url: source, durationMs: 1_000, byteSize: fingerprint.byteSize,
                strategy: .streamPassthrough, inspection: StoryVideoInspection(source: .library,
                    originalURL: source, byteSize: fingerprint.byteSize, durationMs: 1_000,
                    naturalSize: nil, preferredTransform: nil, codecTypes: [], hasFastStart: true))
            let response = VideoUploadResponse(ok: true, uid: "private", uploadSessionId: "lease",
                uploadUrl: URL(string: "https://upload.invalid/\(UUID())")!, uploadProtocol: "tus", poster: nil)
            let receipt = StoryDraftVideoUpload(clientUploadId: UUID().uuidString.lowercased(), video: video,
                upload: response, blobUploadId: nil, checksum: checksum, fingerprint: fingerprint,
                originalFingerprint: fingerprint)
            let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
            let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library,
                preparedVideo: video, draftUpload: receipt, draft: draft, textOverlays: [])
            var patches = 0
            var completions = 0
            FastPathURLProtocol.handler = { request in
                let data: Data
                if request.url!.path.hasSuffix("video-upload") {
                    var confirmed = response
                    if !sameLease {
                        confirmed = VideoUploadResponse(ok: true, uid: "replacement", uploadSessionId: "replacement",
                            uploadUrl: URL(string: "https://upload.invalid/replacement")!, uploadProtocol: "tus",
                            poster: nil, freshUpload: true)
                    }
                    data = try JSONEncoder().encode(confirmed)
                } else {
                    XCTAssertTrue(request.url!.path.hasSuffix("video-complete"))
                    completions += 1
                    data = Data("{\"ok\":true,\"storyId\":\"fixture\",\"asset\":{\"assetKind\":\"video\",\"mediaUrl\":\"https://media.invalid/fixture.mp4\"},\"processingStatus\":\"processing\",\"moderationStatus\":\"pending\"}".utf8)
                }
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"])!, data)
            }
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [FastPathURLProtocol.self]
            let session = URLSession(configuration: config)
            defer { session.invalidateAndCancel(); FastPathURLProtocol.handler = nil }
            let api = APIClient(session: session, tusChunkUploader: { request, file in
                patches += 1
                XCTAssertFalse(sameLease)
                XCTAssertEqual(try Data(contentsOf: file), bytes)
                return (Data(), HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil,
                    headerFields: ["Upload-Offset": String(bytes.count)])!)
            })
            let result = try await store.performUpload(id: pending.id, api: api)
            XCTAssertEqual(result.storyId, "fixture")
            XCTAssertEqual(patches, sameLease ? 0 : 1)
            XCTAssertEqual(completions, 1)
        }
    }

    private var draft: PendingStoryUploadDraft {
        .init(caption: "Final caption", brandTags: "", textOverlay: "", textOverlayPositionX: 50,
            textOverlayPositionY: 50, linkLabel: "", linkUrl: "", linkOverlayPositionX: 50,
            linkOverlayPositionY: 50, quoteReplyId: "", quoteReplyPositionX: 50, quoteReplyPositionY: 50)
    }
}

private final class FastPathURLProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
