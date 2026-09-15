import Combine
import XCTest
@testable import UBEYE

final class StorySubmittedUploadTests: XCTestCase {
    @MainActor
    func testRapidPersistenceAndRemovalDoNotRestoreDeletedUploads() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        var retained = Set<String>()
        for index in 0..<40 {
            let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library,
                draft: draft, textOverlays: [], batchId: "burst", batchPosition: index + 1, batchCount: 40)
            if index.isMultiple(of: 2) { store.remove(id: pending.id) }
            else { retained.insert(pending.id) }
        }
        store.finishBatchPreparation("burst")
        let committed = await store.flushPersistence()
        XCTAssertTrue(committed)
        let restored = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        let migrated = await restored.flushPersistence()
        XCTAssertTrue(migrated)
        XCTAssertEqual(Set(restored.uploads.map(\.id)), retained)
        XCTAssertEqual(restored.uploads.count, 20)
        for upload in restored.uploads {
            XCTAssertEqual(try Data(contentsOf: upload.mediaFileURL), Data("raw fixture".utf8))
        }
    }

    @MainActor
    func testRawSubmissionIsDurableWithoutPreparingPosterOrChecksum() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        var preparationCalls = 0
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"), videoPreparer: { _, _, _ in
            preparationCalls += 1
            throw APIClientError.invalidResponse
        })
        let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .cameraFront,
            draft: draft, textOverlays: [], batchId: "batch", batchPosition: 1, batchCount: 2)
        XCTAssertEqual(preparationCalls, 0)
        XCTAssertTrue(pending.requiresVideoPreparation == true)
        XCTAssertNil(pending.thumbnailFileURL)
        XCTAssertNil(pending.preparedSourceChecksum)
        try FileManager.default.removeItem(at: source)
        _ = await store.flushPersistence()
        let restored = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        _ = await restored.flushPersistence()
        let upload = try XCTUnwrap(restored.upload(id: pending.id))
        XCTAssertEqual(upload.videoSource, .cameraFront)
        XCTAssertTrue(upload.requiresVideoPreparation == true)
        XCTAssertEqual(upload.draft.caption, "durable caption")
        XCTAssertEqual(upload.batchPosition, 1)
        XCTAssertEqual(try Data(contentsOf: upload.mediaFileURL), Data("raw fixture".utf8))
    }

    @MainActor
    func testPreparedReplacementIsPersistedAndDoesNotPrepareAgainAfterRelaunch() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let replacement = root.appendingPathComponent("normalized.mp4")
        try Data("prepared fixture".utf8).write(to: replacement)
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"), videoPreparer: { url, source, _ in
            self.prepared(url: replacement, original: url, source: source)
        })
        let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library, draft: draft, textOverlays: [])
        let interruptedDestination = pending.mediaFileURL.deletingLastPathComponent().appendingPathComponent("\(pending.id)-prepared.mp4")
        try Data("interrupted output".utf8).write(to: interruptedDestination)
        let result = try await store.prepareVideoIfNeeded(id: pending.id)
        XCTAssertFalse(result.requiresVideoPreparation == true)
        XCTAssertEqual(result.durationMs, 1000)
        XCTAssertNotEqual(result.mediaFileURL, pending.mediaFileURL)
        XCTAssertFalse(FileManager.default.fileExists(atPath: pending.mediaFileURL.path))
        XCTAssertTrue(result.mediaFileURL.path.contains("queue/files/"))
        _ = await store.flushPersistence()
        let restored = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"), videoPreparer: { _, _, _ in
            XCTFail("A persisted prepared video must not be prepared twice")
            throw APIClientError.invalidResponse
        })
        let recovered = try await restored.prepareVideoIfNeeded(id: pending.id)
        XCTAssertEqual(try Data(contentsOf: recovered.mediaFileURL), Data("prepared fixture".utf8))
    }

    @MainActor
    func testPreparationFailureLeavesRawSourceAvailableForRetry() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"), videoPreparer: { _, _, _ in
            throw APIClientError.invalidResponse
        })
        let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library, draft: draft, textOverlays: [])
        do { _ = try await store.prepareVideoIfNeeded(id: pending.id); XCTFail("Expected preparation failure") }
        catch { XCTAssertTrue(store.upload(id: pending.id)?.requiresVideoPreparation == true) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: pending.mediaFileURL.path))
        XCTAssertEqual(store.upload(id: pending.id)?.mediaFileURL, pending.mediaFileURL)
    }

    @MainActor
    func testBatchReturnsToFeedWhileDurableVideoPreparationIsStillRunning() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let second = root.appendingPathComponent("second.mp4")
        try Data("second raw fixture".utf8).write(to: second)
        var release: CheckedContinuation<PreparedStoryVideo, Error>?
        let started = expectation(description: "background preparation starts")
        var calls = 0
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"), videoPreparer: { _, _, _ in
            calls += 1
            if calls == 1 {
                return try await withCheckedThrowingContinuation { release = $0; started.fulfill() }
            }
            throw APIClientError.invalidResponse
        })
        let composer = StoryComposerStore()
        var returnedToFeed = false
        let success = await composer.uploadBatch(media: [.video(.init(url: source, source: .library)), .video(.init(url: second, source: .library))],
            api: APIClient(), pendingUploads: store, onPendingBatchStarted: { returnedToFeed = true },
            onUploadRegistered: { _ in XCTFail("This fixture never reaches a provider") })
        XCTAssertTrue(success)
        XCTAssertTrue(returnedToFeed)
        XCTAssertFalse(composer.isUploading)
        XCTAssertEqual(store.uploads.count, 2)
        XCTAssertEqual(store.latestBatchSummary?.completedCount, 0)
        await fulfillment(of: [started], timeout: 2)
        let settled = expectation(description: "owned fixture operations settled")
        let observer = store.$uploads
            .filter { $0.count == 2 && $0.allSatisfy(\.isFailed) }
            .first().sink { _ in settled.fulfill() }
        defer { observer.cancel() }
        release?.resume(throwing: APIClientError.invalidResponse)
        await fulfillment(of: [settled], timeout: 3)
        XCTAssertTrue(store.uploads.allSatisfy(\.isFailed))
    }

    @MainActor
    func testFailedManifestWriteDoesNotAcknowledgeOrDeleteTheSelectedSource() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let queueRoot = root.appendingPathComponent("queue")
        let store = PendingStoryUploadStore(storageRoot: queueRoot)
        try FileManager.default.createDirectory(at: queueRoot.appendingPathComponent("uploads.json"), withIntermediateDirectories: true)
        do {
            _ = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library, draft: draft, textOverlays: [])
            XCTFail("A submission must not be acknowledged unless its manifest is durable")
        } catch {
            XCTAssertTrue(store.uploads.isEmpty)
            XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
        }
    }


    @MainActor
    func testInFlightDraftStagesImmediatelyAndAdoptsReceiptAfterComposerSourceIsRemoved() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let owned = root.appendingPathComponent("private.mp4")
        try await StoryUploadFileIO.stageFile(source: source, destination: owned)
        let fingerprint = try await StoryUploadFileFingerprint.read(owned)
        let checksum = try await StoryUploadFileIO.sha256Hex(at: owned)
        let prepared = self.prepared(url: owned, original: source, source: .library)
        let response = VideoUploadResponse(ok: true, uid: "private", uploadSessionId: "lease",
            uploadUrl: URL(string: "https://upload.invalid/private")!, uploadProtocol: "tus", poster: nil)
        let id = UUID().uuidString.lowercased()
        let api = APIClient()
        api.authToken = "fixture-account"
        let ownership = StoryDraftVideoOwnership()
        let started = expectation(description: "private transfer still in flight")
        var release: CheckedContinuation<StoryDraftVideoUpload, Error>?
        let task = Task { try await withCheckedThrowingContinuation { release = $0; started.fulfill() } }
        let transfer = StoryDraftVideoTransfer(clientUploadId: id, account: "fixture-account", origin: api.baseURLString,
            video: prepared, fingerprint: fingerprint, originalFingerprint: fingerprint, ownership: ownership, task: task)
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library,
            preparedVideo: prepared, draftTransfer: transfer, draft: draft, textOverlays: [])
        XCTAssertTrue(ownership.isSubmitted)
        XCTAssertEqual(pending.id, "pending-story-\(id)")
        XCTAssertNil(pending.preuploadedVideoSessionId)
        try FileManager.default.removeItem(at: source)
        await fulfillment(of: [started], timeout: 2)
        release?.resume(returning: StoryDraftVideoUpload(clientUploadId: id, video: prepared,
            upload: response, blobUploadId: nil, checksum: checksum, fingerprint: fingerprint, originalFingerprint: fingerprint))
        let result = try await store.adoptDraftVideoTransferIfNeeded(id: pending.id, api: api)
        XCTAssertEqual(result.preuploadedVideoSessionId, "lease")
        XCTAssertEqual(result.preparedSourceChecksum, checksum)
        _ = await store.flushPersistence()
        let restored = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        _ = await restored.flushPersistence()
        XCTAssertEqual(restored.upload(id: pending.id)?.preuploadedVideoSessionId, "lease")
        XCTAssertFalse(result.requiresVideoPreparation == true)
    }

    @MainActor
    func testFailedDraftTransferKeepsDurableSourceAndSameUUIDForOffsetRecovery() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let fingerprint = try await StoryUploadFileFingerprint.read(source)
        let prepared = self.prepared(url: source, original: source, source: .library)
        let api = APIClient(); api.authToken = "fixture-account"
        let id = UUID().uuidString.lowercased()
        let transfer = StoryDraftVideoTransfer(clientUploadId: id, account: "fixture-account", origin: api.baseURLString,
            video: prepared, fingerprint: fingerprint, originalFingerprint: fingerprint,
            ownership: StoryDraftVideoOwnership(), task: Task { throw URLError(.networkConnectionLost) })
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library,
            preparedVideo: prepared, draftTransfer: transfer, draft: draft, textOverlays: [])
        let recovered = try await store.adoptDraftVideoTransferIfNeeded(id: pending.id, api: api)
        XCTAssertEqual(recovered.id, "pending-story-\(id)")
        XCTAssertNil(recovered.preuploadedVideoSessionId)
        XCTAssertTrue(FileManager.default.fileExists(atPath: recovered.mediaFileURL.path))
    }

    @MainActor
    func testFailedManifestDoesNotTakeOwnershipOfAnInFlightDraft() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let fingerprint = try await StoryUploadFileFingerprint.read(source)
        let prepared = self.prepared(url: source, original: source, source: .library)
        let ownership = StoryDraftVideoOwnership()
        let transfer = StoryDraftVideoTransfer(clientUploadId: UUID().uuidString.lowercased(), account: "fixture-account",
            origin: APIClient().baseURLString, video: prepared, fingerprint: fingerprint, originalFingerprint: fingerprint,
            ownership: ownership, task: Task { throw APIClientError.invalidResponse })
        let queueRoot = root.appendingPathComponent("queue")
        let store = PendingStoryUploadStore(storageRoot: queueRoot)
        try FileManager.default.createDirectory(at: queueRoot.appendingPathComponent("uploads.json"), withIntermediateDirectories: true)
        do {
            _ = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library,
                preparedVideo: prepared, draftTransfer: transfer, draft: draft, textOverlays: [])
            XCTFail("Expected durable write failure")
        } catch { XCTAssertFalse(ownership.isSubmitted) }
        _ = try? await transfer.task.value
    }


    @MainActor
    func testAccountChangeDuringFailedDraftTransferCannotFallThroughToAnotherAccount() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let fingerprint = try await StoryUploadFileFingerprint.read(source)
        let prepared = self.prepared(url: source, original: source, source: .library)
        let api = APIClient(); api.authToken = "fixture-original-account"
        let ownership = StoryDraftVideoOwnership()
        let transfer = StoryDraftVideoTransfer(clientUploadId: UUID().uuidString.lowercased(),
            account: "fixture-original-account", origin: api.baseURLString,
            video: prepared, fingerprint: fingerprint, originalFingerprint: fingerprint, ownership: ownership,
            task: Task { api.authToken = "fixture-other-account"; throw URLError(.networkConnectionLost) })
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library,
            preparedVideo: prepared, draftTransfer: transfer, draft: draft, textOverlays: [])
        do {
            _ = try await store.adoptDraftVideoTransferIfNeeded(id: pending.id, api: api)
            XCTFail("Must not recover an owned draft under another account")
        } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertNil(store.upload(id: pending.id)?.preuploadedVideoSessionId)
    }


    @MainActor
    func testRemovingPendingItemCancelsAnAdoptedTransferAlreadyBeingAwaited() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try fixture(root)
        let fingerprint = try await StoryUploadFileFingerprint.read(source)
        let prepared = self.prepared(url: source, original: source, source: .library)
        let api = APIClient(); api.authToken = "fixture-account"
        let waiting = expectation(description: "pending queue awaits private transfer")
        let child = Task { () throws -> StoryDraftVideoUpload in
            waiting.fulfill()
            try await Task.sleep(for: .seconds(10))
            throw APIClientError.invalidResponse
        }
        let transfer = StoryDraftVideoTransfer(clientUploadId: UUID().uuidString.lowercased(), account: "fixture-account",
            origin: api.baseURLString, video: prepared, fingerprint: fingerprint, originalFingerprint: fingerprint,
            ownership: StoryDraftVideoOwnership(), task: child)
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        let pending = try await store.createSubmittedVideoUpload(sourceURL: source, source: .library,
            preparedVideo: prepared, draftTransfer: transfer, draft: draft, textOverlays: [])
        let adoption = Task { try await store.adoptDraftVideoTransferIfNeeded(id: pending.id, api: api) }
        await fulfillment(of: [waiting], timeout: 2)
        await Task.yield()
        store.remove(id: pending.id)
        do { _ = try await adoption.value; XCTFail("Removed item cannot adopt or publish") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertTrue(child.isCancelled)
        XCTAssertNil(store.upload(id: pending.id))
    }

    private var draft: PendingStoryUploadDraft {
        .init(caption: "durable caption", brandTags: "", textOverlay: "", textOverlayPositionX: 50,
              textOverlayPositionY: 74, linkLabel: "", linkUrl: "", linkOverlayPositionX: 50,
              linkOverlayPositionY: 74, quoteReplyId: "", quoteReplyPositionX: 50, quoteReplyPositionY: 74)
    }
    private func temporaryRoot() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("submitted-\(UUID())") }
    private func fixture(_ root: URL) throws -> URL {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("raw.mp4")
        try Data("raw fixture".utf8).write(to: url)
        return url
    }
    private func prepared(url: URL, original: URL, source: StoryVideoUpload.Source) -> PreparedStoryVideo {
        .init(url: url, durationMs: 1000, byteSize: 16, strategy: .streamRemux,
              inspection: .init(source: source, originalURL: original, byteSize: 11, durationMs: 1000,
                                naturalSize: nil, preferredTransform: nil, codecTypes: ["hvc1"], hasFastStart: true))
    }
}
