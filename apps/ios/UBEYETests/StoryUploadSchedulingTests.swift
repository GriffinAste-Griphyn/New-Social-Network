import XCTest
@testable import UBEYE

final class StoryUploadSchedulingTests: XCTestCase {
    func testUploadPlaybackBudgetRequiresHealthyMeasuredHeadroom() {
        func budget(uploading: Bool = true, visible: Bool = true, buffering: Bool = false,
                    constrained: Bool = false, limited: Bool = false, throughput: Double? = 20_000_000) -> Int {
            StoryPreheatPolicy.concurrentUploadPlayerLimit(configured: 3, uploading: uploading,
                visiblePlayback: visible, buffering: buffering, constrained: constrained,
                resourceLimited: limited, throughput: throughput)
        }
        XCTAssertEqual(budget(), 1)
        XCTAssertEqual(budget(throughput: 8_000_000), 1)
        XCTAssertEqual(budget(throughput: 7_999_999), 0)
        XCTAssertEqual(budget(throughput: nil), 0)
        XCTAssertEqual(budget(throughput: .nan), 0)
        XCTAssertEqual(budget(throughput: .infinity), 0)
        XCTAssertEqual(budget(visible: false), 0)
        XCTAssertEqual(budget(buffering: true), 0)
        XCTAssertEqual(budget(constrained: true), 0)
        XCTAssertEqual(budget(limited: true), 0)
        XCTAssertEqual(budget(uploading: false), 3)
        XCTAssertEqual(budget(uploading: false, buffering: true), 0)
        XCTAssertEqual(StoryPreheatPolicy.concurrentUploadPlayerLimit(configured: 0, uploading: true,
            visiblePlayback: true, buffering: false, constrained: false, resourceLimited: false,
            throughput: 20_000_000), 0)
    }

    func testProgressBurstIsBoundedAndCompletionIsImmediate() {
        var throttle = StoryUploadProgressThrottle()
        var emitted: [Double] = []
        for tick in 0..<1000 {
            let progress = Double(tick) / 1000
            if throttle.shouldEmit(progress, now: Double(tick) / 1000) { emitted.append(progress) }
        }
        XCTAssertLessThanOrEqual(emitted.count, 5)
        XCTAssertEqual(emitted.first, 0)
        XCTAssertTrue(throttle.shouldEmit(1, now: 0.999))
        XCTAssertFalse(throttle.shouldEmit(1, now: 1.5))
        XCTAssertFalse(throttle.shouldEmit(.nan, now: 2))
        XCTAssertFalse(throttle.shouldEmit(0.5, now: .infinity))
    }

    func testQueuedProgressCannotOverwriteDurableQueueRemoval() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("manifest-order-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("uploads.json")
        let writer = StoryUploadManifestWriter()
        for index in 0..<50 {
            let batch = StoryUploadBatchProgress(id: "batch-\(index)", totalCount: 2, createdAt: Date())
            writer.write(PendingStoryUploadManifest(uploads: [], batches: [batch.id: batch]), to: url, wait: false)
        }
        XCTAssertTrue(writer.write(PendingStoryUploadManifest(uploads: [], batches: [:]), to: url, wait: true))
        let restored = try JSONDecoder().decode(PendingStoryUploadManifest.self, from: Data(contentsOf: url))
        XCTAssertTrue(restored.uploads.isEmpty)
        XCTAssertTrue(restored.batches.isEmpty)
        let blocked = root.appendingPathComponent("not-a-directory")
        try Data([1]).write(to: blocked)
        XCTAssertFalse(writer.write(PendingStoryUploadManifest(uploads: [], batches: [:]),
            to: blocked.appendingPathComponent("uploads.json"), wait: true))
    }

    func testInitialChunksUseFreshMeasurementsWithinProviderBounds() {
        let maximum = Int64(50 * 1024 * 1024)
        XCTAssertEqual(StoryUploadInitialChunkPolicy.bytes(maximum: maximum, measuredBitsPerSecond: nil), 5 * 1024 * 1024)
        XCTAssertEqual(StoryUploadInitialChunkPolicy.bytes(maximum: maximum, measuredBitsPerSecond: .nan), 5 * 1024 * 1024)
        XCTAssertEqual(StoryUploadInitialChunkPolicy.bytes(maximum: maximum, measuredBitsPerSecond: 1_000_000), 5 * 1024 * 1024)
        let fast = StoryUploadInitialChunkPolicy.bytes(maximum: maximum, measuredBitsPerSecond: 80_000_000)
        XCTAssertGreaterThan(fast, 5 * 1024 * 1024)
        XCTAssertLessThanOrEqual(fast, maximum)
        XCTAssertEqual(fast % (256 * 1024), 0)
        XCTAssertEqual(StoryUploadInitialChunkPolicy.bytes(maximum: 5 * 1024 * 1024, measuredBitsPerSecond: 80_000_000), 5 * 1024 * 1024)
        XCTAssertEqual(StoryUploadInitialChunkPolicy.bytes(maximum: maximum, measuredBitsPerSecond: 1_000_000_000), maximum)
    }

    func testEncodingRequiresMeasuredUplinkAndSubstantialSavings() {
        let first = StoryAdaptiveEncodingContext(enabled: true, uploadBitsPerSecond: 20_000_000, network: "cellular")
        XCTAssertFalse(StoryAdaptiveEncodingContext(enabled: true, uploadBitsPerSecond: nil, network: "cellular").shouldTry(bytes: 100_000_000, durationMs: 10_000))
        XCTAssertFalse(first.shouldTry(bytes: 30_000_000, durationMs: 10_000))
        XCTAssertTrue(first.shouldTry(bytes: 100_000_000, durationMs: 10_000))
        XCTAssertFalse(first.shouldTry(bytes: 100_000_000, durationMs: 120_000))
        XCTAssertTrue(first.isWorthKeeping(sourceBytes: 100_000_000, candidateBytes: 20_000_000, exportSeconds: 12))
        XCTAssertFalse(first.isWorthKeeping(sourceBytes: 100_000_000, candidateBytes: 90_000_000, exportSeconds: 12))
        XCTAssertFalse(StoryAdaptiveEncodingContext(enabled: true, uploadBitsPerSecond: nil, network: "unknown").shouldTry(bytes: 100_000_000, durationMs: 10_000))
        XCTAssertFalse(StoryAdaptiveEncodingContext.disabled.shouldTry(bytes: 100_000_000, durationMs: 10_000))
    }

    @MainActor
    func testTwoPhotoTransfersOverlapButCommitInSelectionOrderAndVideoIsExclusive() async {
        let firstStarted = expectation(description: "first photo transfer")
        let secondStarted = expectation(description: "second photo transfer")
        let queue = StoryBatchTransferQueue(maxConcurrentPhotos: 2)
        var releaseFirst: CheckedContinuation<Void, Never>?
        var events: [String] = []
        queue.enqueue(assetKind: .image) { commit in
            events.append("first-start")
            await withCheckedContinuation { releaseFirst = $0; firstStarted.fulfill() }
            try? await commit()
            events.append("first-commit")
        }
        queue.enqueue(assetKind: .image) { commit in
            events.append("second-start")
            secondStarted.fulfill()
            try? await commit()
            events.append("second-commit")
        }
        queue.enqueue(assetKind: .video) { commit in
            try? await commit()
            events.append("video")
        }
        queue.enqueue(assetKind: .image) { commit in
            try? await commit()
            events.append("last-photo")
        }
        await fulfillment(of: [firstStarted, secondStarted], timeout: 2)
        XCTAssertEqual(Set(events), Set(["first-start", "second-start"]))
        releaseFirst?.resume()
        await queue.finish()
        XCTAssertEqual(Array(events.suffix(4)), ["first-commit", "second-commit", "video", "last-photo"])
    }

    @MainActor
    func testPhotoFailureBeforeCommitStillKeepsLaterPublicationOrdered() async {
        let started = expectation(description: "first starts")
        let failed = expectation(description: "second fails")
        let queue = StoryBatchTransferQueue(maxConcurrentPhotos: 2)
        var releaseFirst: CheckedContinuation<Void, Never>?
        var events: [String] = []
        queue.enqueue(assetKind: .image) { commit in
            await withCheckedContinuation { releaseFirst = $0; started.fulfill() }
            try? await commit()
            events.append("first")
        }
        queue.enqueue(assetKind: .image) { _ in failed.fulfill() }
        queue.enqueue(assetKind: .image) { commit in
            try? await commit()
            events.append("third")
        }
        await fulfillment(of: [started, failed], timeout: 2)
        XCTAssertTrue(events.isEmpty)
        releaseFirst?.resume()
        await queue.finish()
        XCTAssertEqual(events, ["first", "third"])
    }

    @MainActor
    func testPhotoConcurrencyIsBoundedToTwoEvenWithTenQueuedItems() async {
        let twoStarted = expectation(description: "two start")
        twoStarted.expectedFulfillmentCount = 2
        let queue = StoryBatchTransferQueue(maxConcurrentPhotos: 20)
        var releases: [CheckedContinuation<Void, Never>] = []
        var started = 0
        for position in 1...10 {
            queue.enqueue(assetKind: .image) { commit in
                started += 1
                if position <= 2 {
                    await withCheckedContinuation { releases.append($0); twoStarted.fulfill() }
                }
                try? await commit()
            }
        }
        await fulfillment(of: [twoStarted], timeout: 2)
        XCTAssertEqual(started, 2)
        releases.forEach { $0.resume() }
        await queue.finish()
        XCTAssertEqual(started, 10)
    }

    @MainActor
    func testCancelledPermitWaiterDoesNotBlockNextUpload() async throws {
        let permits = StoryUploadPermitPool(limit: 1)
        try await permits.acquire()
        let waiting = expectation(description: "waiting upload")
        let cancelled = Task { @MainActor in
            waiting.fulfill()
            try await permits.acquire()
            permits.release()
        }
        await fulfillment(of: [waiting], timeout: 2)
        cancelled.cancel()
        do { try await cancelled.value; XCTFail("Cancelled work acquired a permit") }
        catch { XCTAssertTrue(error is CancellationError) }
        permits.release()
        try await permits.acquire()
        permits.release()
    }

    func testFirstBytesDelegateIgnoresZeroProgressAndReportsOnlyOnce() {
        let observed = LockedCounter()
        let delegate = UploadFirstBytesDelegate { observed.increment() }
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.uploadTask(with: URLRequest(url: URL(string: "https://upload.invalid")!), from: Data([1]))
        delegate.urlSession(session, task: task, didSendBodyData: 0, totalBytesSent: 0, totalBytesExpectedToSend: 1)
        XCTAssertEqual(observed.value, 0)
        delegate.urlSession(session, task: task, didSendBodyData: 1, totalBytesSent: 1, totalBytesExpectedToSend: 1)
        delegate.urlSession(session, task: task, didSendBodyData: 1, totalBytesSent: 1, totalBytesExpectedToSend: 1)
        XCTAssertEqual(observed.value, 1)
    }
}

private final class LockedCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
    func increment() { lock.lock(); count += 1; lock.unlock() }
}

final class MediaPipelineOwnershipTests: XCTestCase {
    func testRecoveryIdentityRequiresSameAttemptAndExactSignedURL() throws {
        let url = URL(string: "https://upload.example.test/video?token=one")!
        let value = StoryTransferIdentity(attemptID: "pending-one", uploadURL: url, bodyURL: URL(fileURLWithPath: "/tmp/chunk"))
        let restored = try XCTUnwrap(StoryTransferIdentity.decode(value.encoded))
        XCTAssertTrue(restored.matches(attemptID: "pending-one", uploadURL: url))
        XCTAssertFalse(restored.matches(attemptID: "pending-two", uploadURL: url))
        XCTAssertFalse(restored.matches(attemptID: "pending-one", uploadURL: URL(string: "https://upload.example.test/video?token=two")!))
        XCTAssertNil(StoryTransferIdentity.decode("/tmp/legacy-chunk"))
        XCTAssertNil(StoryTransferIdentity.decode("{}"))
    }

    func testLateProgressCannotResurrectFinishingOrFailedUpload() {
        for state in [PendingStoryUploadState.completing, .paused, .failed] {
            XCTAssertFalse(StoryUploadStateMachine.allows(from: state, to: .uploading))
            XCTAssertTrue(StoryUploadStateMachine.allows(from: state, to: .recovering))
        }
        XCTAssertTrue(StoryUploadStateMachine.allows(from: .recovering, to: .uploading))
        XCTAssertTrue(StoryUploadStateMachine.allows(from: .uploading, to: .completing))
    }

    func testResourceBudgetTransitionsAcrossUploadStallOfflineAndRecovery() {
        let configured = MediaWorkBudget(players: 3, images: 8, stacks: 4, persistentVideos: 2, offlineHLS: 2)
        func budget(upload: Bool = false, online: Bool = true, stall: Bool = false, limited: Bool = false) -> MediaWorkBudget {
            MediaWorkBudget.resolve(uploading: upload, connected: online, visiblePlayback: true,
                buffering: stall, constrained: false, resourceLimited: limited,
                throughput: 20_000_000, configured: configured)
        }
        XCTAssertEqual(budget(), configured)
        XCTAssertEqual(budget(upload: true), MediaWorkBudget(players: 1, images: 0, stacks: 0, persistentVideos: 0, offlineHLS: 0))
        XCTAssertEqual(budget(upload: true, stall: true), .zero)
        XCTAssertEqual(budget(online: false), .zero)
        XCTAssertEqual(budget(upload: true, limited: true), .zero)
        XCTAssertEqual(budget(), configured)
    }
}
