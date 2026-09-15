import XCTest
import UIKit
@testable import UBEYE

final class StoryUploadBatchProgressTests: XCTestCase {
    func testGrowingQueueNeverCreditsUnpreparedItemsAsCompleted() {
        var batch = StoryUploadBatchProgress(id: "batch", totalCount: 10)
        for position in 1...10 {
            batch.register("story-\(position)", progress: 0.05)
            XCTAssertEqual(batch.completedCount, 0)
            XCTAssertEqual(batch.totalCount, 10)
            XCTAssertEqual(batch.progress, Double(position) * 0.005, accuracy: 0.000001)
        }
    }

    func testCompletionsDuringPreparationStaySequentialAndAreIdempotent() {
        var batch = StoryUploadBatchProgress(id: "batch", totalCount: 10)
        for position in 1...10 {
            batch.register("story-\(position)", progress: 0.05)
            XCTAssertEqual(batch.completedCount, position - 1)
            batch.complete("story-\(position)")
            batch.complete("story-\(position)")
            XCTAssertEqual(batch.completedCount, position)
            XCTAssertEqual(batch.progress, Double(position) / 10, accuracy: 0.000001)
        }
        batch.complete("never-staged")
        XCTAssertEqual(batch.completedCount, 10)
        XCTAssertEqual(batch.progress, 1)
    }

    func testRetryCannotRewindBatchProgressOrIncreaseCompletionCount() {
        var batch = StoryUploadBatchProgress(id: "batch", totalCount: 2)
        batch.register("first", progress: 0.05)
        batch.complete("first")
        batch.register("second", progress: 0.8)
        let highWater = batch.progress
        batch.recordProgress("second", progress: 0.04)
        batch.recordProgress("second", progress: .nan)
        batch.recordProgress("second", progress: .infinity)
        XCTAssertEqual(batch.completedCount, 1)
        XCTAssertEqual(batch.progress, highWater)
        batch.recordProgress("second", progress: 1)
        XCTAssertEqual(batch.completedCount, 1, "Transferred bytes are not a confirmed story completion")
        batch.complete("second")
        XCTAssertEqual(batch.completedCount, 2)
    }

    func testPreparationFailureAndRemovalNeverCountAsSuccessfulUploads() {
        var batch = StoryUploadBatchProgress(id: "batch", totalCount: 3)
        batch.register("first", progress: 0.05)
        batch.complete("first")
        batch.register("third", progress: 0.4)
        let highWater = batch.progress
        batch.preparationFinished = true
        XCTAssertEqual(batch.totalCount, 3)
        XCTAssertEqual(batch.unavailableCount, 1)
        batch.remove("third")
        batch.remove("third")
        batch.complete("third")
        XCTAssertEqual(batch.completedCount, 1)
        XCTAssertEqual(batch.unavailableCount, 2)
        XCTAssertEqual(batch.progress, highWater)
    }

    @MainActor
    func testDurableQueueGrowingAndFinishingPreparationDoesNotRenumberStories() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = PendingStoryUploadStore(storageRoot: root)
        store.beginBatch("batch", totalCount: 3)
        XCTAssertEqual(store.latestBatchSummary?.completedCount, 0)
        let first = try await stage(store, root: root, position: 1)
        XCTAssertEqual(store.latestBatchSummary?.completedCount, 0)
        var bookkeepingOnly = first
        bookkeepingOnly.retryCount += 1
        bookkeepingOnly.updatedAt = Date().addingTimeInterval(2)
        bookkeepingOnly.preparedSourceChecksum = "new-checksum"
        XCTAssertEqual(first.presentation, bookkeepingOnly.presentation)
        bookkeepingOnly.thumbnailFileURL = root.appendingPathComponent("new-poster.jpg")
        XCTAssertNotEqual(first.presentation, bookkeepingOnly.presentation)
        let third = try await stage(store, root: root, position: 3)
        XCTAssertEqual(store.latestBatchSummary?.completedCount, 0)
        store.finishBatchPreparation("batch")
        XCTAssertEqual(store.upload(id: first.id)?.batchPosition, 1)
        XCTAssertEqual(store.upload(id: third.id)?.batchPosition, 3)
        XCTAssertEqual(store.upload(id: third.id)?.batchCount, 3)
        XCTAssertEqual(store.latestBatchSummary?.totalCount, 3)
        XCTAssertEqual(store.latestBatchSummary?.unavailableCount, 1)
        _ = await store.flushPersistence()
        let restored = PendingStoryUploadStore(storageRoot: root)
        _ = await restored.flushPersistence()
        XCTAssertEqual(restored.latestBatchSummary?.completedCount, 0)
        XCTAssertEqual(restored.latestBatchSummary?.unavailableCount, 1)
        XCTAssertEqual(restored.upload(id: third.id)?.batchPosition, 3)
    }

    @MainActor
    func testRemovalAndMissingFileAfterRelaunchDoNotBecomeCompletions() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = PendingStoryUploadStore(storageRoot: root)
        store.beginBatch("batch", totalCount: 3)
        let first = try await stage(store, root: root, position: 1)
        let second = try await stage(store, root: root, position: 2)
        _ = try await stage(store, root: root, position: 3)
        store.finishBatchPreparation("batch")
        store.remove(id: first.id)
        XCTAssertEqual(store.latestBatchSummary?.completedCount, 0)
        XCTAssertEqual(store.latestBatchSummary?.unavailableCount, 1)
        try FileManager.default.removeItem(at: second.mediaFileURL)
        _ = await store.flushPersistence()
        let restored = PendingStoryUploadStore(storageRoot: root)
        _ = await restored.flushPersistence()
        XCTAssertEqual(restored.latestBatchSummary?.completedCount, 0)
        XCTAssertEqual(restored.latestBatchSummary?.unavailableCount, 2)
        XCTAssertEqual(restored.uploads.count, 1)
    }

    @MainActor
    func testConfirmedCompletionAndHighWaterProgressSurviveRelaunch() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = PendingStoryUploadStore(storageRoot: root)
        store.beginBatch("batch", totalCount: 3)
        let first = try await stage(store, root: root, position: 1)
        let second = try await stage(store, root: root, position: 2)
        let manifestURL = root.appendingPathComponent("uploads.json")
        let saved = try JSONDecoder().decode(PendingStoryUploadManifest.self, from: Data(contentsOf: manifestURL))
        var batch = try XCTUnwrap(saved.batches["batch"])
        batch.complete(first.id)
        batch.recordProgress(second.id, progress: 0.8)
        // Simulate the atomic manifest produced after a confirmed completion,
        // followed by process termination before the third item was staged.
        let completed = PendingStoryUploadManifest(uploads: [second], batches: ["batch": batch])
        try JSONEncoder().encode(completed).write(to: manifestURL, options: .atomic)
        _ = await store.flushPersistence()
        let restored = PendingStoryUploadStore(storageRoot: root)
        _ = await restored.flushPersistence()
        let summary = try XCTUnwrap(restored.latestBatchSummary)
        XCTAssertEqual(summary.completedCount, 1)
        XCTAssertEqual(summary.totalCount, 3)
        XCTAssertEqual(summary.unavailableCount, 1)
        XCTAssertEqual(summary.progress, 0.6, accuracy: 0.000001)
        XCTAssertEqual(restored.uploads.first?.state, .recovering)
    }

    @MainActor
    func testLegacyArrayManifestMigratesWithoutInventingCompletions() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = PendingStoryUploadStore(storageRoot: root)
        let second = try await stage(store, root: root, position: 2)
        let manifestURL = root.appendingPathComponent("uploads.json")
        try JSONEncoder().encode([second]).write(to: manifestURL, options: .atomic)
        _ = await store.flushPersistence()
        let restored = PendingStoryUploadStore(storageRoot: root)
        _ = await restored.flushPersistence()
        XCTAssertEqual(restored.uploads.first?.id, second.id)
        XCTAssertEqual(restored.latestBatchSummary?.completedCount, 0)
        XCTAssertEqual(restored.latestBatchSummary?.totalCount, 3)
        _ = try JSONDecoder().decode(PendingStoryUploadManifest.self, from: Data(contentsOf: manifestURL))
    }

    @MainActor
    func testAllPreparationFailuresRetireTheEmptyBatch() {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = PendingStoryUploadStore(storageRoot: root)
        store.beginBatch("batch", totalCount: 3)
        XCTAssertNotNil(store.latestBatchSummary)
        store.finishBatchPreparation("batch")
        XCTAssertNil(store.latestBatchSummary)
    }

    private func temporaryRoot() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("batch-counter-\(UUID())")
    }

    @MainActor
    private func stage(_ store: PendingStoryUploadStore, root: URL, position: Int) async throws -> PendingStoryUpload {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source-\(position).mp4")
        try Data("durable local fixture".utf8).write(to: source)
        let draft = PendingStoryUploadDraft(caption: "", brandTags: "", textOverlay: "", textOverlayPositionX: 50,
            textOverlayPositionY: 74, linkLabel: "", linkUrl: "", linkOverlayPositionX: 50, linkOverlayPositionY: 74,
            quoteReplyId: "", quoteReplyPositionX: 50, quoteReplyPositionY: 74)
        let poster = try XCTUnwrap(UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2)).image { context in
            UIColor.black.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        }.jpegData(compressionQuality: 0.9))
        let pending = try await store.createVideoUpload(sourceURL: source, thumbnailData: poster,
            durationMs: 1000, draft: draft, textOverlays: [], batchId: "batch", batchPosition: position, batchCount: 3)
        if let thumbnail = pending.thumbnailFileURL { _ = await MediaImageCache.shared.loadImage(for: thumbnail) }
        return pending
    }
}
