import AVFoundation
import CoreGraphics
import XCTest
import UIKit
@testable import UBEYE

final class StoryUploadPerformanceTests: XCTestCase {
    func testTinyFinalTailUsesOnePatchWithinTheExistingCaps() {
        let initial: Int64 = 5 * 1024 * 1024
        let latestUpload: Int64 = 5_328_071
        let controller = AdaptiveTusChunkController(maximum: 20 * 1024 * 1024, initial: initial, enabled: true)
        XCTAssertEqual(controller.nextLength(remaining: latestUpload), latestUpload)
        XCTAssertEqual(controller.nextLength(remaining: initial + 512 * 1024 + 1), initial)
        let constrained = AdaptiveTusChunkController(maximum: initial, initial: initial, enabled: true)
        XCTAssertEqual(constrained.nextLength(remaining: latestUpload), initial)
        let fixed = AdaptiveTusChunkController(maximum: 20 * 1024 * 1024, initial: initial, enabled: false)
        XCTAssertEqual(fixed.nextLength(remaining: latestUpload), initial)
        controller.failed()
        XCTAssertEqual(controller.nextLength(remaining: latestUpload), initial)
    }
    func testUploadEstimateRequiresMeasuredConfidenceAndExpiresByNetwork() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        var history = StoryUploadRateHistory()
        history.record(bytes: 1_000_000, seconds: 2, network: "cellular", now: now)
        XCTAssertNil(history.estimate(network: "cellular", now: now))
        history.record(bytes: 1_000_000, seconds: 2, network: "cellular", now: now)
        XCTAssertEqual(history.estimate(network: "cellular", now: now), 3_200_000)
        XCTAssertNil(history.estimate(network: "standard", now: now))
        XCTAssertNil(history.estimate(network: "cellular", now: now.addingTimeInterval(6 * 3600)))
        history.record(bytes: 1_000_000, seconds: .nan, network: "standard", now: now)
        XCTAssertNil(history.samples["standard"])
    }

    func testChunkSizingAdaptsWithinProviderBoundsAndReducesOnFailure() {
        let controller = AdaptiveTusChunkController(maximum: 50 * 1024 * 1024, initial: 5 * 1024 * 1024, enabled: true)
        controller.accepted(bytes: 5 * 1024 * 1024, seconds: 1)
        XCTAssertEqual(controller.limit, 10 * 1024 * 1024)
        controller.accepted(bytes: 10 * 1024 * 1024, seconds: 1)
        XCTAssertEqual(controller.limit, 20 * 1024 * 1024)
        controller.failed()
        XCTAssertEqual(controller.limit, 10 * 1024 * 1024)
        controller.accepted(bytes: 5 * 1024 * 1024, seconds: 60)
        XCTAssertEqual(controller.limit, TusUploadChunkPolicy.minimum)
        controller.failed()
        XCTAssertEqual(controller.limit, TusUploadChunkPolicy.minimum)
        XCTAssertEqual(controller.limit % TusUploadChunkPolicy.alignment, 0)
    }

    func testDisabledChunkPolicyPreservesExistingLimitButReportsAcceptedBytes() {
        let observed = AcceptedByteRecorder()
        let controller = AdaptiveTusChunkController(maximum: 50 * 1024 * 1024, initial: 50 * 1024 * 1024, enabled: false,
            onAccepted: { bytes, _ in observed.record(bytes) })
        controller.accepted(bytes: 5 * 1024 * 1024, seconds: 30)
        controller.failed()
        XCTAssertEqual(controller.limit, 50 * 1024 * 1024)
        XCTAssertEqual(observed.bytes, 5 * 1024 * 1024)
    }

    func testEncodingNeedsMeasuredSavingsAndRejectsSlowExports() {
        let context = StoryAdaptiveEncodingContext(enabled: true, uploadBitsPerSecond: 3_000_000, network: "cellular")
        XCTAssertTrue(context.shouldTry(bytes: 30_000_000, durationMs: 10_000))
        XCTAssertFalse(context.shouldTry(bytes: 12_000_000, durationMs: 10_000))
        XCTAssertFalse(context.shouldTry(bytes: 20_000_000, durationMs: 20_000))
        XCTAssertTrue(context.isWorthKeeping(sourceBytes: 30_000_000, candidateBytes: 10_000_000, exportSeconds: 10))
        XCTAssertFalse(context.isWorthKeeping(sourceBytes: 30_000_000, candidateBytes: 10_000_000, exportSeconds: 50))
        XCTAssertFalse(context.isWorthKeeping(sourceBytes: 30_000_000, candidateBytes: 29_000_000, exportSeconds: 1))
        XCTAssertFalse(StoryAdaptiveEncodingContext.disabled.shouldTry(bytes: 30_000_000, durationMs: 10_000))
    }

    func testUnknownUplinkSkipsSpeculativeCompression() {
        let context = StoryAdaptiveEncodingContext(enabled: true, uploadBitsPerSecond: nil, network: "cellular")
        XCTAssertFalse(context.shouldTry(bytes: 100_000_000, durationMs: 10_000))
    }

    func testUploadHistoryExpiresBeforeChangingNetworksCanMisleadPreparation() {
        var history = StoryUploadRateHistory()
        let now = Date()
        history.record(bytes: 1_000_000, seconds: 2, network: "standard", now: now)
        history.record(bytes: 1_000_000, seconds: 2, network: "standard", now: now)
        XCTAssertNotNil(history.estimate(network: "standard", now: now.addingTimeInterval(119)))
        XCTAssertNil(history.estimate(network: "standard", now: now.addingTimeInterval(120)))
    }

    func testVisualScoringHonorsAnExpiredPreparationDeadline() throws {
        let original = try image(detail: true, tint: 0)
        XCTAssertNil(StoryVideoQualityGate.compare(original, original, deadline: ProcessInfo.processInfo.systemUptime - 1))
    }

    func testMemoryProbeReturnsResidentBytes() throws {
        XCTAssertGreaterThan(try XCTUnwrap(StoryUploadMemoryProbe.residentBytes), 0)
    }

    func testRecoveryRetriesNetworkInterruptionsButNotServerRejections() {
        XCTAssertTrue(StoryUploadRecoveryPolicy.isTransient(URLError(.networkConnectionLost)))
        XCTAssertTrue(StoryUploadRecoveryPolicy.isTransient(URLError(.notConnectedToInternet)))
        XCTAssertFalse(StoryUploadRecoveryPolicy.isTransient(APIClientError.server("Rejected", 400)))
        XCTAssertEqual(StoryUploadRecoveryPolicy.delay(attempt: 1), 2)
        XCTAssertEqual(StoryUploadRecoveryPolicy.delay(attempt: 100), 120)
    }

    func testQualityGateRejectsColorShiftsAndDetailLoss() throws {
        let original = try image(detail: true, tint: 0)
        let matching = try image(detail: true, tint: 0)
        let shifted = try image(detail: true, tint: 50)
        let blurred = try image(detail: false, tint: 0)
        let perfect = try XCTUnwrap(StoryVideoQualityGate.compare(original, matching))
        XCTAssertEqual(perfect.ssim, 1, accuracy: 0.00001)
        XCTAssertEqual(perfect.meanAbsoluteError, 0)
        XCTAssertGreaterThan(try XCTUnwrap(StoryVideoQualityGate.compare(original, shifted)).meanAbsoluteError, 0.012)
        XCTAssertLessThan(try XCTUnwrap(StoryVideoQualityGate.compare(original, blurred)).ssim, 0.97)
    }

    func testUnknownHDRAndHighFrameRateMetadataCannotEnableEncoding() {
        var inspection = StoryVideoInspection(source: .library, originalURL: URL(fileURLWithPath: "/clip.mp4"),
            byteSize: 30_000_000, durationMs: 10_000, naturalSize: CGSize(width: 1080, height: 1920),
            preferredTransform: .identity, codecTypes: ["hvc1"], hasFastStart: true,
            frameRate: 30, isExplicitRec709: false)
        XCTAssertFalse(inspection.isEligibleForAdaptiveEncoding)
        inspection.isExplicitRec709 = true
        XCTAssertTrue(inspection.isEligibleForAdaptiveEncoding)
        inspection.frameRate = 60
        XCTAssertFalse(inspection.isEligibleForAdaptiveEncoding)
    }

    @MainActor
    func testDurableQueueRestoresBatchAndChecksumAfterRelaunch() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("recovery-test-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("selected.mp4")
        try Data("durable source bytes".utf8).write(to: source)
        let checksum = try await StoryUploadFileIO.sha256Hex(at: source)
        let store = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        let draft = PendingStoryUploadDraft(caption: "Caption", brandTags: "", textOverlay: "", textOverlayPositionX: 50,
            textOverlayPositionY: 74, linkLabel: "", linkUrl: "", linkOverlayPositionX: 50, linkOverlayPositionY: 74,
            quoteReplyId: "", quoteReplyPositionX: 50, quoteReplyPositionY: 74)
        let poster = try XCTUnwrap(UIImage(cgImage: try image(detail: false, tint: 0)).jpegData(compressionQuality: 0.9))
        let pending = try await store.createVideoUpload(sourceURL: source, preparedChecksum: checksum,
            thumbnailData: poster, durationMs: 1000, draft: draft, textOverlays: [],
            batchId: "batch", batchPosition: 1, batchCount: 2)
        if let thumbnailURL = pending.thumbnailFileURL {
            let loaded = await MediaImageCache.shared.loadImage(for: thumbnailURL)
            XCTAssertNotNil(loaded)
        }
        try FileManager.default.removeItem(at: source)
        _ = await store.flushPersistence()
        let restored = PendingStoryUploadStore(storageRoot: root.appendingPathComponent("queue"))
        _ = await restored.flushPersistence()
        let upload = try XCTUnwrap(restored.uploads.first)
        XCTAssertEqual(upload.id, pending.id)
        XCTAssertEqual(upload.state, .recovering)
        XCTAssertEqual(upload.batchId, "batch")
        XCTAssertEqual(upload.batchPosition, 1)
        XCTAssertEqual(upload.preparedSourceChecksum, checksum)
        let restoredChecksum = try await StoryUploadFileIO.sha256Hex(at: upload.mediaFileURL)
        XCTAssertEqual(restoredChecksum, checksum)
        XCTAssertEqual(upload.draft.caption, "Caption")
    }

    func testExtendedSourceFixturesProtectHDRAndHighFrameRateInputs() async throws {
        let directory = MediaRegressionFixtures.directory
        let hdr = directory.appendingPathComponent("reference-hdr-pq.mp4")
        guard FileManager.default.fileExists(atPath: hdr.path) else { throw XCTSkip("Generate the extended regression fixtures") }
        for name in ["hdr-pq", "high-frame-rate", "landscape", "slow-motion", "fine-text", "gradient"] {
            let url = directory.appendingPathComponent("reference-\(name).mp4")
            let inspection = try await StoryVideoUploadNormalizer.inspect(url: url, source: .library)
            XCTAssertTrue(inspection.hasAudio, "\(name) must include its audio reference")
            XCTAssertGreaterThan(inspection.durationMs ?? 0, 0)
            if name == "hdr-pq" || name == "high-frame-rate" {
                XCTAssertFalse(inspection.isEligibleForAdaptiveEncoding, "Do not silently down-convert \(name)")
            }
            if name == "high-frame-rate" { XCTAssertEqual(inspection.frameRate ?? 0, 60, accuracy: 0.2) }
            if name == "hdr-pq" { XCTAssertFalse(inspection.isExplicitRec709) }
        }
    }

    func testAdaptiveQualityAuditFromLocalFixtures() async throws {
        let directory = MediaRegressionFixtures.directory
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil),
              files.contains(where: { $0.lastPathComponent.hasPrefix("audit-") }) else {
            throw XCTSkip("Generate fixtures with scripts/media-upload-quality-fixtures.mjs")
        }
        var reports: [[String: Any]] = []
        for source in files.filter({ $0.lastPathComponent.hasPrefix("audit-") && $0.pathExtension == "mp4" }).sorted(by: { $0.path < $1.path }) {
            let inspection = try await StoryVideoUploadNormalizer.inspect(url: source, source: .library)
            XCTAssertTrue(inspection.isEligibleForAdaptiveEncoding)
            let duration = try XCTUnwrap(inspection.durationMs)
            let preparedExport = await StoryVideoUploadNormalizer.adaptiveExportSession(for: source, durationMs: duration)
            let export = try XCTUnwrap(preparedExport)
            let destination = directory.appendingPathComponent("encoded-\(source.lastPathComponent)")
            try? FileManager.default.removeItem(at: destination)
            try await export.export(to: destination, as: .mp4)
            let accepted = try await StoryVideoQualityGate.compare(source: source, candidate: destination, durationMs: duration)
            let candidate = try await StoryVideoUploadNormalizer.inspect(url: destination, source: .library)
            XCTAssertEqual(candidate.hasAudio, inspection.hasAudio)
            XCTAssertTrue(candidate.isExplicitRec709)
            XCTAssertEqual(candidate.frameRate ?? 0, inspection.frameRate ?? 0, accuracy: 0.2)
            if source.lastPathComponent.contains("skin-palette") || source.lastPathComponent.contains("dark") {
                XCTAssertTrue(accepted, "\(source.lastPathComponent) must preserve color and dark detail")
            }
            reports.append(["clip": source.lastPathComponent, "visualGateAccepted": accepted,
                "sourceBytes": inspection.byteSize, "candidateBytes": candidate.byteSize,
                "audioPreserved": candidate.hasAudio == inspection.hasAudio, "rec709Preserved": candidate.isExplicitRec709])
        }
        let data = try JSONSerialization.data(withJSONObject: ["synthetic": true, "encoder": "actual Apple AVAssetExportSession on iOS Simulator", "reports": reports], options: [.prettyPrinted, .sortedKeys])
        try data.write(to: directory.appendingPathComponent("report.json"))
    }

    func testCompatibleUploadPreservesExactSourceEvenWhenLossyExperimentIsEnabled() async throws {
        let directory = MediaRegressionFixtures.directory
        let fixture = directory.appendingPathComponent("audit-motion.mp4")
        guard FileManager.default.fileExists(atPath: fixture.path) else { throw XCTSkip("No generated motion fixture") }
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("adaptive-accept-\(UUID()).mp4")
        try FileManager.default.copyItem(at: fixture, to: source)
        defer { try? FileManager.default.removeItem(at: source) }
        // A valid free atom exercises the large-container savings branch without
        // changing the actual image/audio content or inventing perceptual quality.
        let freeBytes = 18 * 1024 * 1024
        let handle = try FileHandle(forWritingTo: source)
        try handle.seekToEnd()
        var length = UInt32(freeBytes).bigEndian
        try handle.write(contentsOf: withUnsafeBytes(of: &length) { Data($0) })
        try handle.write(contentsOf: Data("free".utf8))
        try handle.write(contentsOf: Data(repeating: 0, count: freeBytes - 8))
        try handle.close()
        let originalHash = try await StoryUploadFileIO.sha256Hex(at: source)
        let prepared = try await StoryVideoUploadNormalizer.prepare(url: source, source: .library, maxDurationSeconds: 120,
            adaptiveEncoding: .init(enabled: true, uploadBitsPerSecond: 500_000, network: "cellular"))
        defer { if prepared.url != source { try? FileManager.default.removeItem(at: prepared.url) } }
        XCTAssertEqual(prepared.strategy, .streamPassthrough)
        XCTAssertEqual(prepared.url, source)
        XCTAssertEqual(prepared.byteSize, prepared.inspection.byteSize)
        let unchangedHash = try await StoryUploadFileIO.sha256Hex(at: source)
        XCTAssertEqual(unchangedHash, originalHash)
    }

    func testQualityGateRejectsPreviouslyDegradedNoiseFixture() async throws {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("MediaSourceQualityAudit")
        let source = directory.appendingPathComponent("source-detail.mp4")
        let candidate = directory.appendingPathComponent("source-detail-8200000.mp4")
        guard FileManager.default.fileExists(atPath: source.path), FileManager.default.fileExists(atPath: candidate.path) else {
            throw XCTSkip("No prior source-quality fixtures")
        }
        let inspection = try await StoryVideoUploadNormalizer.inspect(url: source, source: .library)
        let accepted = try await StoryVideoQualityGate.compare(source: source, candidate: candidate, durationMs: try XCTUnwrap(inspection.durationMs))
        XCTAssertFalse(accepted, "The known detail regression must not enter the adaptive upload path")
    }

    private func image(detail: Bool, tint: Int) throws -> CGImage {
        var pixels = [UInt8](repeating: 255, count: 64 * 64 * 4)
        for y in 0..<64 { for x in 0..<64 {
            let index = (y * 64 + x) * 4
            let value = detail ? ((x + y) % 2 == 0 ? 60 : 180) : 120
            pixels[index] = UInt8(min(255, value + tint)); pixels[index + 1] = UInt8(value); pixels[index + 2] = UInt8(value)
        } }
        let data = Data(pixels) as CFData
        let provider = try XCTUnwrap(CGDataProvider(data: data))
        return try XCTUnwrap(CGImage(width: 64, height: 64, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 256,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
    }
}

private final class AcceptedByteRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Int64 = 0
    var bytes: Int64 { lock.lock(); defer { lock.unlock() }; return value }
    func record(_ bytes: Int64) { lock.lock(); value += bytes; lock.unlock() }
}


enum MediaRegressionFixtures {
    static var directory: URL {
        if let path = ProcessInfo.processInfo.environment["MEDIA_FIXTURE_DIRECTORY"], !path.isEmpty {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MediaUploadQualityAudit")
    }
}
