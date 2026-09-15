import AVFoundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers
import UIKit
import XCTest
@testable import UBEYE

final class MediaPerformanceTests: XCTestCase {
    @MainActor
    func testQualityFallbackRetainsCurrentDecodedFrameAndReleasesItOnStop() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let directory = environment["MEDIA_FIXTURE_DIRECTORY"] ?? environment["TEST_RUNNER_MEDIA_FIXTURE_DIRECTORY"] else {
            throw XCTSkip("Local decoded-video fixture not configured")
        }
        let file = URL(fileURLWithPath: directory).appendingPathComponent("audit-motion.mp4")
        let asset = AVURLAsset(url: file)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let track = try XCTUnwrap(tracks.first)
        let size = try await track.load(.naturalSize)
        let duration = try await asset.load(.duration).seconds
        let item = AVPlayerItem(asset: asset)
        let oldPlayer = AVPlayer(playerItem: item)
        let sourceURL = URL(string: "https://media.invalid/api/story-media/cloudflare-stream/id/manifest/video.m3u8?selection=exact-v1&token=signed")!
        let selected = ExactVideoQualityPolicy.url(sourceURL, target: 1080)
        let source = StoryVideoPlaybackSource(identity: "frame-retention", url: sourceURL, durationSeconds: duration,
            pixelWidth: Int(size.width), pixelHeight: Int(size.height))
        for _ in 0..<200 where item.status != .readyToPlay { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(item.status, .readyToPlay)
        let prerolled = await oldPlayer.preroll(atRate: 1)
        XCTAssertTrue(prerolled)
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { _ in
            StoryVideoPlaybackPool.PreparedPlayer(player: oldPlayer, playbackURL: selected, cacheState: "miss", wasPrerolled: true)
        }
        pool.prepare(sources: [source], activeIdentity: nil)
        for _ in 0..<10 { await Task.yield() }
        let controller = AutoPlayVideoPlaybackController()
        defer { controller.stop(reason: "test_complete"); pool.removeAll() }
        controller.play(source: source, expectedDuration: duration, playerPool: pool, refreshSource: { nil },
            isPaused: true, onReadyForPlayback: {}, onProgress: { _ in }, onFinished: {})
        for _ in 0..<100 where controller.player == nil { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(controller.player === oldPlayer)
        controller.playerDidAttach(oldPlayer)
        controller.revealVideo(player: oldPlayer, reason: "test_decoded_frame")
        for _ in 0..<100 where !controller.isReadyForPlayback { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(controller.isReadyForPlayback)
        NotificationCenter.default.post(name: .AVPlayerItemFailedToPlayToEndTime, object: item)
        for _ in 0..<100 where controller.heldFrame == nil { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(controller.heldFrame?.player === oldPlayer)
        XCTAssertTrue(controller.heldFrame?.surface.player === oldPlayer)
        XCTAssertNotNil(oldPlayer.currentItem)
        XCTAssertEqual(oldPlayer.rate, 0)
        controller.stop(reason: "navigate_away")
        XCTAssertNil(controller.heldFrame)
        XCTAssertNil(oldPlayer.currentItem)
    }

    @MainActor
    func testExactViewerRejectsAnOlderAdaptivePreparedPlayerForTheSameStory() async throws {
        let oldURL = URL(string: "https://media.invalid/video.m3u8")!
        let oldPlayer = AVPlayer(playerItem: AVPlayerItem(url: oldURL))
        let oldSource = StoryVideoPlaybackSource(identity: "same-story", url: oldURL, durationSeconds: 8)
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { _ in
            StoryVideoPlaybackPool.PreparedPlayer(player: oldPlayer, playbackURL: oldURL, cacheState: "miss", wasPrerolled: true)
        }
        pool.prepare(sources: [oldSource], activeIdentity: nil)
        for _ in 0..<10 { await Task.yield() }
        let source = StoryVideoPlaybackSource(identity: "same-story",
            url: URL(string: "https://media.invalid/api/story-media/cloudflare-stream/id/manifest/video.m3u8?selection=exact-v1&token=signed")!,
            durationSeconds: 8, pixelWidth: 1080, pixelHeight: 1920)
        let controller = AutoPlayVideoPlaybackController()
        defer { controller.stop(reason: "test_complete"); pool.removeAll() }
        controller.play(source: source, expectedDuration: 8, playerPool: pool, refreshSource: { nil },
            isPaused: true, onReadyForPlayback: {}, onProgress: { _ in }, onFinished: {})
        for _ in 0..<100 where controller.player == nil { try await Task.sleep(for: .milliseconds(10)) }
        let player = try XCTUnwrap(controller.player)
        XCTAssertFalse(player === oldPlayer)
        XCTAssertNil(oldPlayer.currentItem)
        let asset = try XCTUnwrap(player.currentItem?.asset as? AVURLAsset)
        XCTAssertNotNil(ExactVideoQualityPolicy.target(in: asset.url))
        XCTAssertFalse(controller.isReadyForPlayback)
        controller.play(source: source, expectedDuration: 8, playerPool: pool, refreshSource: { nil },
            isPaused: true, onReadyForPlayback: {}, onProgress: { _ in }, onFinished: {})
        for _ in 0..<10 { await Task.yield() }
        XCTAssertTrue(controller.player === player)
    }

    @MainActor
    func testExactRenditionSelectionPreservesAuthorizationAndSurvivesAdaptiveConfiguration() throws {
        let source = try XCTUnwrap(URL(string: "https://www.ubeye.ai/api/story-media/cloudflare-stream/id/manifest/video.m3u8?token=signed&selection=exact-v1"))
        let selected = ExactVideoQualityPolicy.url(source, target: 1080)
        XCTAssertEqual(ExactVideoQualityPolicy.target(in: selected), 1080)
        XCTAssertTrue(MediaPlaybackQuality.allowsPreparedPlaybackURL(selected))
        XCTAssertTrue(MediaPlaybackQuality.isStartupQualityLocked(selected))
        XCTAssertEqual(MediaPlaybackQuality.adaptivePlaybackURL(for: selected), source)
        XCTAssertTrue(selected.absoluteString.contains("token=signed"))
        XCTAssertNil(ExactVideoQualityPolicy.target(in: ExactVideoQualityPolicy.url(selected, target: 0)))
        let oldServer = URL(string: "https://www.ubeye.ai/api/story-media/cloudflare-stream/id/manifest/video.m3u8?token=signed")!
        XCTAssertEqual(ExactVideoQualityPolicy.url(oldServer, target: 1080), oldServer)
        let item = AVPlayerItem(url: selected)
        item.preferredPeakBitRate = 1_000_000
        item.preferredMaximumResolution = CGSize(width: 240, height: 426)
        MediaPlaybackQuality.applyStreamingHints(for: item, playbackURL: selected, profile: .prepared)
        XCTAssertEqual(item.preferredPeakBitRate, 0)
        XCTAssertEqual(item.preferredMaximumResolution, .zero)
    }

    func testExactQualityGateRejectsBlurryPrerollAndInsufficientBuffer() {
        for size in [CGSize(width: 240, height: 426), CGSize(width: 480, height: 852), .zero] {
            XCTAssertFalse(ExactVideoQualityPolicy.isReady(size: size, target: 1080,
                sourceWidth: 1080, sourceHeight: 1920, buffered: 8, remaining: 8))
        }
        XCTAssertFalse(ExactVideoQualityPolicy.isReady(size: CGSize(width: 1080, height: 1920), target: 1080,
            sourceWidth: 1080, sourceHeight: 1920, buffered: 0.1, remaining: 8))
        XCTAssertTrue(ExactVideoQualityPolicy.isReady(size: CGSize(width: 1080, height: 1920), target: 1080,
            sourceWidth: 1080, sourceHeight: 1920, buffered: 0.8, remaining: 8))
        XCTAssertTrue(ExactVideoQualityPolicy.isReady(size: CGSize(width: 1280, height: 720), target: 1080,
            sourceWidth: 1280, sourceHeight: 720, buffered: 0.21, remaining: 0.25))
        XCTAssertFalse(ExactVideoQualityPolicy.isReady(size: CGSize(width: 720, height: 1280), target: 1080,
            sourceWidth: nil, sourceHeight: nil, buffered: 8, remaining: 8))
    }

    func testExactFallbackIsBoundedAndUpgradeDoesNotOscillateOrInterruptShortClips() {
        XCTAssertEqual(ExactVideoQualityPolicy.fallback(after: 1080), 720)
        XCTAssertEqual(ExactVideoQualityPolicy.fallback(after: 720), 0)
        XCTAssertLessThanOrEqual(ExactVideoQualityPolicy.preparationTimeout(target: 1080) + ExactVideoQualityPolicy.preparationTimeout(target: 720), 4.5)
        XCTAssertTrue(ExactVideoQualityPolicy.shouldUpgrade(target: 720, healthySeconds: 11, remaining: 20,
            throughput: 15_000_000, allowed: true, alreadyAttempted: false))
        for (remaining, throughput, allowed, attempted) in [(8.0, 15_000_000.0, true, false),
            (20, 2_000_000, true, false), (20, 15_000_000, false, false), (20, 15_000_000, true, true)] {
            XCTAssertFalse(ExactVideoQualityPolicy.shouldUpgrade(target: 720, healthySeconds: 11, remaining: remaining,
                throughput: throughput, allowed: allowed, alreadyAttempted: attempted))
        }
    }

    @MainActor
    func testVisibleThumbnailPreparationStillLoadsDuringUpload() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("visible-upload-\(UUID()).png")
        let image = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 24, height: 24))
        }
        try XCTUnwrap(image.pngData()).write(to: file)
        let token = StoryUploadPriority.shared.begin()
        defer {
            StoryUploadPriority.shared.end(token)
            MediaImageCache.shared.removeAll()
            try? FileManager.default.removeItem(at: file)
        }
        let result = await MediaImageCache.shared.prepareForPresentation([file], timeout: .seconds(2))
        XCTAssertEqual(result.readyCount, 1)
        XCTAssertFalse(result.timedOut)
    }

    func testUploadFingerprintPreservesPrecisionAcrossManifestEncoding() throws {
        let fingerprint = StoryUploadFileFingerprint(byteSize: 42, modificationTime: 1_789_333_200.123456)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let restored = try decoder.decode(StoryUploadFileFingerprint.self, from: encoder.encode(fingerprint))
        XCTAssertEqual(restored, fingerprint)
    }

    @MainActor
    func testUploadPriorityIsReferenceCountedAndKeepsRetentionBudget() {
        let gate = StoryUploadPriority.shared
        let retention = NetworkQualityMonitor.shared.retainedPreparedPlayerLimit
        let first = gate.begin()
        let second = gate.begin()
        XCTAssertTrue(gate.isUploading)
        XCTAssertEqual(NetworkQualityMonitor.shared.preparedPlayerLimit, 0)
        XCTAssertEqual(NetworkQualityMonitor.shared.retainedPreparedPlayerLimit, retention)
        gate.end(first)
        gate.end(first)
        XCTAssertTrue(gate.isUploading)
        gate.end(second)
        XCTAssertFalse(gate.isUploading)
    }

    @MainActor
    func testQoEMetadataRetainsCountersAndIdentityWhenBudgetIsExceeded() {
        var fields = Dictionary(uniqueKeysWithValues: (0..<25).map { ("extra\($0)", "value") })
        fields["playback"] = "attempt-1"
        fields["delivery"] = "hls"
        fields["startup_state"] = "cold"
        fields["target"] = "1080p"
        fields["result"] = "reached"
        fields["bytes"] = "123456"
        fields["watchedMs"] = "5000"
        for field in ["layer_ready_ms", "attachment_ms", "preroll_ms", "preparation_ms"] { fields[field] = "42" }
        let metadata = MediaPerformance.enrichedMetadata(for: "video_access_log", eventMetadata: fields)
        XCTAssertEqual(metadata.count, 32)
        XCTAssertEqual(metadata["playback"], "attempt-1")
        XCTAssertEqual(metadata["bytes"], "123456")
        XCTAssertEqual(metadata["watchedMs"], "5000")
        XCTAssertNotNil(metadata["startup_profile"])
        XCTAssertNotNil(metadata["device_model"])
        XCTAssertEqual(metadata["startup_state"], "cold")
        XCTAssertEqual(metadata["result"], "reached")
        for field in ["layer_ready_ms", "attachment_ms", "preroll_ms", "preparation_ms"] { XCTAssertEqual(metadata[field], "42") }
    }

    func testThroughputHistoryExpiresAndRespondsQuicklyToSlowdowns() {
        var history = PlaybackThroughputHistory()
        let now = Date(timeIntervalSince1970: 1000)
        history.record(bitsPerSecond: 10_000_000, stalls: 0, now: now)
        history.record(bitsPerSecond: 2_000_000, stalls: 0, now: now.addingTimeInterval(1))
        XCTAssertEqual(history.recent(now: now.addingTimeInterval(2)) ?? 0, 4_800_000, accuracy: 1)
        XCTAssertNil(history.recent(now: now.addingTimeInterval(122)))
        history.record(bitsPerSecond: .infinity, stalls: 0, now: now)
        history.reset()
        XCTAssertNil(history.recent(now: now))
        XCTAssertEqual(PlaybackThroughputHistory.startupCap(configured: 4_000_000, throughput: 2_000_000, recoveringFromStall: true), 1_400_000)
        XCTAssertEqual(PlaybackThroughputHistory.startupCap(configured: 4_000_000, throughput: 100_000_000), 4_000_000)
    }

    func testLowHistoricalThroughputDoesNotCapHealthyNextStory() {
        XCTAssertEqual(PlaybackThroughputHistory.startupCap(configured: 8_000_000, throughput: 900_000), 8_000_000)
        XCTAssertEqual(PlaybackThroughputHistory.startupCap(configured: 3_000_000, throughput: 900_000), 3_000_000)
        XCTAssertEqual(PlaybackThroughputHistory.startupCap(configured: 8_000_000, throughput: 900_000, recoveringFromStall: true), 630_000)
        XCTAssertEqual(PlaybackThroughputHistory.startupCap(configured: 8_000_000, throughput: .nan, recoveringFromStall: true), 8_000_000)
    }

    func testShortVideosCanReleaseStartupHintsWithTheirEntireRemainderBuffered() {
        XCTAssertTrue(VideoQualityRampPolicy.shouldRelaxStreamingHints(isPlaybackLikelyToKeepUp: true, bufferedAheadSeconds: 0.98, remainingSeconds: 1))
        XCTAssertFalse(VideoQualityRampPolicy.shouldRelaxStreamingHints(isPlaybackLikelyToKeepUp: true, bufferedAheadSeconds: 0.4, remainingSeconds: 1))
        XCTAssertFalse(VideoQualityRampPolicy.shouldRelaxStreamingHints(isPlaybackLikelyToKeepUp: false, bufferedAheadSeconds: 1, remainingSeconds: 1))
        XCTAssertFalse(VideoQualityRampPolicy.shouldRelaxStreamingHints(isPlaybackLikelyToKeepUp: true, bufferedAheadSeconds: 1, remainingSeconds: .nan))
    }

    @MainActor
    func testImageCacheKeepsAvatarAndFullScreenDecodesSeparate() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("image-budget-\(UUID()).png")
        defer { try? FileManager.default.removeItem(at: url) }
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1200, height: 1800))
        let data = renderer.pngData { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 1200, height: 1800))
        }
        try data.write(to: url)
        let smallResult = await MediaImageCache.shared.loadImage(for: url, maxPixelDimension: 128)
        let small = try XCTUnwrap(smallResult)
        XCTAssertLessThanOrEqual(max(small.cgImage!.width, small.cgImage!.height), 128)
        XCTAssertNil(MediaImageCache.shared.cachedImage(for: url))
        let fullResult = await MediaImageCache.shared.loadImage(for: url)
        let full = try XCTUnwrap(fullResult)
        XCTAssertGreaterThan(max(full.cgImage!.width, full.cgImage!.height), 128)
        XCTAssertNotNil(MediaImageCache.shared.cachedImage(for: url, maxPixelDimension: 128))
        XCTAssertEqual(MediaImagePixelBudget.avatar(points: 44, scale: 3), 256)
    }

    @MainActor
    func testBufferingSuspendsAdjacentPlayersAndPreparationCancellationIsImmediate() async {
        let monitor = NetworkQualityMonitor.shared
        monitor.setActivePlayback(identity: "budget-test", buffering: true)
        XCTAssertEqual(monitor.preparedPlayerLimit, 0)
        monitor.setActivePlayback(identity: "budget-test", buffering: false)
        XCTAssertLessThanOrEqual(monitor.preparedPlayerLimit, 3)
        monitor.clearActivePlayback(identity: "budget-test")

        let task = Task { @MainActor in
            try await StoryVideoUploadNormalizer.prepare(url: URL(fileURLWithPath: "/nonexistent-cancelled-source.mp4"), source: .library, maxDurationSeconds: 120)
        }
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancelled preparation must not inspect or export") }
        catch is CancellationError { }
        catch { XCTFail("Expected cancellation, got \(error)") }
    }

    @MainActor
    func testDiscardedPreparedPlayerReleasesItemWhileHandoffKeepsItem() async throws {
        let first = AVPlayer(playerItem: AVPlayerItem(asset: AVMutableComposition()))
        let second = AVPlayer(playerItem: AVPlayerItem(asset: AVMutableComposition()))
        let a = URL(string: "https://media.example/first.m3u8")!
        let b = URL(string: "https://media.example/second.m3u8")!
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 2) { url in
            .init(player: url == a ? first : second, playbackURL: url, cacheState: "miss")
        }
        pool.prepare(urls: [a, b], activeURL: nil)
        for _ in 0..<5 { await Task.yield() }
        pool.prepare(urls: [b], activeURL: nil)
        XCTAssertNil(first.currentItem)
        let handoff = await pool.takePreparedPlayer(for: b)
        XCTAssertNotNil(handoff)
        XCTAssertNotNil(second.currentItem)
        pool.removeAll()
        XCTAssertNotNil(second.currentItem, "Pool cleanup must not detach a checked-out active player")
        second.replaceCurrentItem(with: nil)
    }

    func testPreheatDepthUsesMeasuredBandwidthAndResourceLimits() {
        XCTAssertEqual(StoryPreheatPolicy.playerLimit(throughput: nil, isLimited: false), 1)
        XCTAssertEqual(StoryPreheatPolicy.playerLimit(throughput: .nan, isLimited: false), 1)
        XCTAssertEqual(StoryPreheatPolicy.playerLimit(throughput: .infinity, isLimited: false), 1)
        XCTAssertEqual(StoryPreheatPolicy.playerLimit(throughput: 7_999_999, isLimited: false), 2)
        XCTAssertEqual(StoryPreheatPolicy.playerLimit(throughput: 8_000_000, isLimited: false), 3)
        XCTAssertEqual(StoryPreheatPolicy.playerLimit(throughput: 80_000_000, isLimited: true), 1)
    }

    func testEarlierPreheatResumeStillRequiresHealthyVisiblePlayback() {
        XCTAssertTrue(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: false, local: false, likelyToKeepUp: true, bufferedAhead: 1, throughput: 8_000_000))
        XCTAssertFalse(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: false, local: false, likelyToKeepUp: true, bufferedAhead: 1, throughput: nil))
        XCTAssertFalse(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: true, local: true, likelyToKeepUp: true, bufferedAhead: 4, throughput: 8_000_000))
        XCTAssertFalse(StoryPreheatPolicy.canResumePreparation(visible: false, stalled: false, local: true, likelyToKeepUp: true, bufferedAhead: 4, throughput: 8_000_000))
        XCTAssertFalse(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: false, local: false, likelyToKeepUp: true, bufferedAhead: .nan, throughput: 8_000_000))
    }

    @MainActor
    func testHiddenPlaybackDoesNotOwnBudgetOrStartFreshNetworkRequest() async {
        let monitor = NetworkQualityMonitor.shared
        monitor.setActivePlayback(identity: "visible-owner", buffering: false)
        let hidden = AutoPlayVideoPlaybackController()
        hidden.setVisible(false)
        hidden.play(source: .urlBacked(URL(string: "https://media.example/never-request.m3u8")!), expectedDuration: 10, playerPool: nil, refreshSource: { nil }, isPaused: true, onReadyForPlayback: {}, onProgress: { _ in }, onFinished: {})
        for _ in 0..<10 { await Task.yield() }
        XCTAssertNil(hidden.player)
        XCTAssertFalse(monitor.isActivePlaybackBuffering)
        hidden.stop(reason: "test_cleanup")
        monitor.clearActivePlayback(identity: "visible-owner")
    }

    @MainActor
    func testSuspendingNewWorkRetainsCompletePlayerAndCancelsStagedDownloads() async throws {
        let a = StoryVideoPlaybackSource.urlBacked(URL(string: "https://media.example/complete.m3u8")!)
        let b = StoryVideoPlaybackSource.urlBacked(URL(string: "https://media.example/loading.m3u8")!)
        let complete = AVPlayer(playerItem: AVPlayerItem(asset: AVMutableComposition()))
        let staged = AVPlayer(playerItem: AVPlayerItem(asset: AVMutableComposition()))
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 2, stagedPlayerBuilder: { source, publish in
            let prepared = StoryVideoPlaybackPool.PreparedPlayer(player: source.identity == a.identity ? complete : staged, playbackURL: source.url, cacheState: "miss")
            if source.identity == b.identity { publish(prepared); try? await Task.sleep(for: .seconds(2)) }
            return prepared
        })
        pool.prepare(sources: [a, b], activeIdentity: nil)
        try await Task.sleep(for: .milliseconds(30))
        pool.prepare(sources: [a, b], activeIdentity: nil, suspendNewWork: true)
        XCTAssertNotNil(complete.currentItem)
        XCTAssertNil(staged.currentItem)
        let retained = await pool.takePreparedPlayer(for: a, completedOnly: true)
        XCTAssertNotNil(retained)
        XCTAssertNotNil(complete.currentItem)
        complete.replaceCurrentItem(with: nil)
        pool.removeAll()
    }

    @MainActor
    func testCompletedOnlyHandoffDoesNotCancelInProgressPreroll() async throws {
        let source = StoryVideoPlaybackSource.urlBacked(URL(string: "https://media.example/preparing.m3u8")!)
        let staged = AVPlayer(playerItem: AVPlayerItem(asset: AVMutableComposition()))
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1, stagedPlayerBuilder: { source, publish in
            let prepared = StoryVideoPlaybackPool.PreparedPlayer(player: staged, playbackURL: source.url, cacheState: "miss")
            publish(prepared)
            try? await Task.sleep(for: .milliseconds(100))
            return prepared
        })
        pool.prepare(sources: [source], activeIdentity: nil)
        try await Task.sleep(for: .milliseconds(20))
        let early = await pool.takePreparedPlayer(for: source, completedOnly: true)
        XCTAssertNil(early)
        XCTAssertTrue(pool.hasPreparation(for: source.identity))
        XCTAssertNotNil(staged.currentItem)
        try await Task.sleep(for: .milliseconds(120))
        let completed = await pool.takePreparedPlayer(for: source, completedOnly: true)
        XCTAssertNotNil(completed)
        staged.replaceCurrentItem(with: nil)
    }

    @MainActor
    func testCheckedOutHiddenPlayerIsNotPreparedAgainAndPreservesSurface() async throws {
        let source = StoryVideoPlaybackSource.urlBacked(URL(string: "https://media.example/leased.m3u8")!)
        let player = AVPlayer(playerItem: AVPlayerItem(asset: AVMutableComposition()))
        let surface = AspectFitPlayerView(frame: CGRect(x: 0, y: 0, width: 360, height: 640))
        var builds = 0
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { url in
            builds += 1
            return .init(player: player, playbackURL: url, cacheState: "miss", wasPrerolled: true, displaySurface: surface, preparationMilliseconds: 42)
        }
        pool.prepare(sources: [source], activeIdentity: nil)
        try await Task.sleep(for: .milliseconds(20))
        let handoff = await pool.takePreparedPlayer(for: source, completedOnly: true)
        XCTAssertTrue(handoff?.displaySurface === surface)
        XCTAssertTrue(surface.player === player)
        XCTAssertEqual(handoff?.preparationMilliseconds, 42)
        pool.prepare(sources: [source], activeIdentity: nil)
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(builds, 1)
        pool.removeAll()
        XCTAssertNotNil(player.currentItem)
        player.replaceCurrentItem(with: nil)
    }

    @MainActor
    func testPersistentSurfaceReparentDoesNotDetachPlayerDuringOldHostCleanup() {
        let player = AVPlayer(playerItem: AVPlayerItem(asset: AVMutableComposition()))
        let surface = AspectFitPlayerView(frame: CGRect(x: 0, y: 0, width: 360, height: 640))
        surface.attach(player)
        let layer = surface.playerLayer
        let first = StoryVideoSurfaceHost(frame: surface.bounds)
        let second = StoryVideoSurfaceHost(frame: surface.bounds)
        first.install(surface)
        second.install(surface)
        first.install(nil)
        first.layoutIfNeeded()
        XCTAssertTrue(surface.superview === second)
        XCTAssertTrue(surface.player === player)
        XCTAssertTrue(surface.playerLayer === layer)
        second.install(nil)
        XCTAssertNil(surface.superview)
        XCTAssertTrue(surface.player === player)
        surface.attach(nil)
        player.replaceCurrentItem(with: nil)
    }

    @MainActor
    func testViewerLookaheadIncludesNextStackAheadOfPreviousItem() {
        let items = (0..<4).map { makeStoryStackItem(id: "local-\($0)", assetKind: .video) }
        let stack = makeStoryStack(id: "local", items: items)
        let next = makeStoryStack(id: "next", items: [makeStoryStackItem(id: "next-processing", assetKind: .video, processingStatus: "processing"), makeStoryStackItem(id: "next-live", assetKind: .video)])
        XCTAssertEqual(MediaEngine.viewerVideoSources(stack: stack, around: 2, upcomingStacks: [next]).map(\.identity), ["story:local-2", "story:local-3", "story:next-live", "story:local-1"])
        XCTAssertEqual(MediaEngine.viewerVideoSources(stack: stack, around: 0, upcomingStacks: [next]).map(\.identity), items.map(\.playbackIdentity))
        XCTAssertEqual(MediaEngine.viewerVideoSources(stack: stack, around: 2, upcomingStacks: [next], mode: .constrained).map(\.identity), ["story:local-2", "story:local-3"])
        XCTAssertEqual(MediaEngine.viewerVideoSources(stack: stack, around: 2, upcomingStacks: [next], mode: .critical).map(\.identity), ["story:local-2"])
    }

    // Optional local intake lets us benchmark the actual Apple exporter, including
    // user-provided camera fixtures, without sending their contents to a service.
    func testUploadQualityAuditFromLocalFixtures() async throws {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("MediaSourceQualityAudit")
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil),
              files.contains(where: { $0.lastPathComponent.hasPrefix("source-") }) else {
            throw XCTSkip("No local source-quality fixtures supplied")
        }
        for file in files.filter({ $0.lastPathComponent.hasPrefix("source-") && $0.pathExtension == "mp4" && !$0.lastPathComponent.hasSuffix("-6500000.mp4") && !$0.lastPathComponent.hasSuffix("-8200000.mp4") }).sorted(by: { $0.path < $1.path }) {
            for target in [6_500_000, 8_200_000] {
                let started = Date()
                let output = try await StoryVideoUploadNormalizer.normalizedVideoURL(for: file, mirrorsHorizontally: false, targetBitsPerSecond: target)
                let encoded = try XCTUnwrap(output)
                let destination = directory.appendingPathComponent("\(file.deletingPathExtension().lastPathComponent)-\(target).mp4")
                if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
                try FileManager.default.moveItem(at: encoded, to: destination)
                let asset = AVURLAsset(url: destination)
                let duration = try await asset.load(.duration).seconds
                let tracks = try await asset.loadTracks(withMediaType: .video)
                let track = try XCTUnwrap(tracks.first)
                let size = try await track.load(.naturalSize)
                XCTAssertGreaterThan(duration, 0)
                XCTAssertGreaterThan(size.width, 0)
                let bytes = try FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? Int ?? 0
                print("SOURCE_QUALITY_AUDIT clip=\(file.lastPathComponent) target=\(target) bytes=\(bytes) exportMs=\(Int(Date().timeIntervalSince(started) * 1000)) path=\(destination.path)")
            }
        }
    }

    @MainActor
    func testUploadNoticeUsesPhotoCopyForImageProcessing() {
        let notice = StoryUploadNoticeStore()

        notice.showProcessing(assetKind: .image)

        XCTAssertEqual(notice.title, "Processing photo…")
        XCTAssertEqual(
            notice.message,
            "Preparing optimized versions now. Your photo will finish in the background."
        )
        XCTAssertEqual(notice.systemImage, "photo.fill")

        notice.showDelayed(assetKind: .image)

        XCTAssertEqual(notice.title, "Photo processing delayed")
        XCTAssertEqual(
            notice.message,
            "Your photo is safe. We’ll keep trying to prepare it in the background."
        )
    }

    @MainActor
    func testUploadNoticePreservesVideoCopyForVideoProcessing() {
        let notice = StoryUploadNoticeStore()

        notice.showProcessing(assetKind: .video)

        XCTAssertEqual(notice.title, "Processing video…")
        XCTAssertEqual(
            notice.message,
            "Preparing a streamable version now. Higher quality will continue in the background."
        )
        XCTAssertEqual(notice.systemImage, "video.fill")
    }

    @MainActor
    func testProgressiveImageLoaderDecodesVersionedThumbHashPlaceholder() async throws {
        let loader = ProgressiveImageLoader()
        let url = try XCTUnwrap(
            URL(
                string: "thumbhash:F0kGFAQ2pHtZh_llpcUImoWgSQ?v=story-version"
            )
        )

        await loader.load(
            placeholderURL: url,
            thumbnailURL: nil,
            fullURL: nil
        )

        XCTAssertEqual(loader.stage, .placeholder)
        XCTAssertNotNil(loader.image)
    }

    @MainActor
    func testPerformanceReporterCoalescesRepeatedImmediateFlushRequests() async {
        let recorder = PerformanceUploadRecorder()
        let reporter = MobilePerformanceReporter(
            batchSize: 50,
            maxBufferSize: 200,
            flushDelaySeconds: 0.01,
            minimumRequestSpacingSeconds: 0.05,
            retryDelaySeconds: 0.1
        )
        reporter.configure { events in
            await recorder.record(events)
            try await Task.sleep(for: .milliseconds(40))
        }

        for index in 0..<5 {
            reporter.record(
                name: "video_upload_phase",
                durationMs: nil,
                metadata: ["index": String(index)]
            )
        }

        for _ in 0..<20 {
            await reporter.flushNow()
            await Task.yield()
        }
        try? await Task.sleep(for: .milliseconds(140))

        let batches = await recorder.batches()
        XCTAssertEqual(batches.count, 1)
        XCTAssertEqual(batches.first?.count, 5)
    }

    @MainActor
    func testPerformanceReporterSpacesFullBatches() async {
        let recorder = PerformanceUploadRecorder()
        let reporter = MobilePerformanceReporter(
            batchSize: 2,
            maxBufferSize: 10,
            flushDelaySeconds: 0.01,
            minimumRequestSpacingSeconds: 0.08,
            retryDelaySeconds: 0.1
        )
        reporter.configure { events in
            await recorder.record(events)
        }

        for index in 0..<4 {
            reporter.record(
                name: "api_request",
                durationMs: index,
                metadata: ["index": String(index)]
            )
        }
        await reporter.flushNow()

        let deadline = Date().addingTimeInterval(1)
        while await recorder.count() < 2, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
        let batches = await recorder.batches()
        let timestamps = await recorder.timestamps()
        XCTAssertEqual(batches.count, 2)
        XCTAssertEqual(batches.map(\.count), [2, 2])
        if timestamps.count == 2 {
            XCTAssertGreaterThanOrEqual(
                timestamps[1].timeIntervalSince(timestamps[0]),
                0.07
            )
        }
    }

    @MainActor
    func testImmediatePerformanceFlushWakesAnExistingDelay() async {
        let reporter = MobilePerformanceReporter(flushDelaySeconds: 10, minimumRequestSpacingSeconds: 0)
        let sent = expectation(description: "Completion timing flush wakes scheduled delay")
        reporter.configure { events in
            XCTAssertEqual(events.count, 2)
            sent.fulfill()
        }
        reporter.record(name: "video_upload_phase", durationMs: 100, metadata: ["phase": "transfer"])
        try? await Task.sleep(for: .milliseconds(30))
        reporter.record(name: "video_upload_phase", durationMs: 200, metadata: ["phase": "complete"])
        await reporter.flushNow()
        await fulfillment(of: [sent], timeout: 1)
    }

    @MainActor
    func testImmediatePerformanceFlushCannotBypassRetryBackoff() async {
        let reporter = MobilePerformanceReporter(flushDelaySeconds: 10,
            minimumRequestSpacingSeconds: 0, retryDelaySeconds: 0.2)
        let first = expectation(description: "First batch fails")
        let retried = expectation(description: "Failed prefix retries after backoff")
        var attempts = 0
        var failedAt = Date.distantPast
        reporter.configure { events in
            attempts += 1
            if attempts == 1 {
                failedAt = Date()
                first.fulfill()
                throw URLError(.networkConnectionLost)
            }
            XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(failedAt), 0.18)
            XCTAssertEqual(events.count, 1)
            retried.fulfill()
        }
        reporter.record(name: "video_upload_phase", durationMs: 100, metadata: ["phase": "complete"])
        await reporter.flushNow()
        await fulfillment(of: [first], timeout: 1)
        for _ in 0..<20 { await reporter.flushNow(); await Task.yield() }
        await fulfillment(of: [retried], timeout: 1)
        XCTAssertEqual(attempts, 2)
    }

    func testHomeFeedPresentationPolicyUsesUniqueAboveTheFoldThumbnailsInOrder() {
        let myStory = URL(string: "https://example.com/my-story.jpg")!
        let firstFollowing = URL(string: "https://example.com/following-1.jpg")!
        let secondFollowing = URL(string: "https://example.com/following-2.jpg")!
        let belowFoldFollowing = URL(string: "https://example.com/following-3.jpg")!
        let firstDiscover = URL(string: "https://example.com/discover-1.jpg")!
        let belowFoldDiscover = URL(string: "https://example.com/discover-3.jpg")!

        let urls = HomeFeedMediaPresentationPolicy.requiredThumbnailURLs(
            myStoryURL: myStory,
            followingURLs: [firstFollowing, secondFollowing, belowFoldFollowing],
            discoverURLs: [firstDiscover, myStory, belowFoldDiscover]
        )

        XCTAssertEqual(urls, [myStory, firstFollowing, secondFollowing, firstDiscover])
    }

    func testFeedMediaCommitPolicyDefersOnlyAnIncompleteRefresh() {
        let incomplete = MediaImagePreparationResult(
            requestedCount: 3,
            readyCount: 2,
            timedOut: true
        )
        let complete = MediaImagePreparationResult(
            requestedCount: 3,
            readyCount: 3,
            timedOut: false
        )

        XCTAssertEqual(
            FeedMediaCommitPolicy.decision(hasPresentedFeed: false, preparation: incomplete),
            .commit
        )
        XCTAssertEqual(
            FeedMediaCommitPolicy.decision(hasPresentedFeed: true, preparation: incomplete),
            .deferUntilReady
        )
        XCTAssertEqual(
            FeedMediaCommitPolicy.decision(hasPresentedFeed: true, preparation: complete),
            .commit
        )
    }

    @MainActor
    func testStableImageLoaderKeepsCurrentImageUntilReplacementIsReady() async throws {
        let currentURL = URL(string: "https://example.com/current.jpg")!
        let replacementURL = URL(string: "https://example.com/replacement.jpg")!
        let currentImage = try XCTUnwrap(UIImage(data: makeTestImageData(width: 8, height: 8)))
        let replacementImage = try XCTUnwrap(UIImage(data: makeTestImageData(width: 9, height: 9)))
        let loader = StableImageLoader()

        await loader.load(url: currentURL, retryDelays: []) { _ in currentImage }
        // A new SwiftUI body is evaluated before the new URL's task starts.
        XCTAssertNil(loader.image(for: replacementURL))
        XCTAssertTrue(loader.image(for: currentURL) === currentImage)

        let replacementTask = Task { @MainActor in
            await loader.load(url: replacementURL, retryDelays: []) { _ in
                try? await Task.sleep(for: .milliseconds(80))
                return replacementImage
            }
        }
        try? await Task.sleep(for: .milliseconds(20))

        XCTAssertEqual(loader.displayedURL, currentURL)
        XCTAssertNotNil(loader.displayedImage)
        XCTAssertNil(loader.image(for: replacementURL))

        await replacementTask.value
        XCTAssertEqual(loader.displayedURL, replacementURL)
        XCTAssertTrue(loader.image(for: replacementURL) === replacementImage)
        XCTAssertNil(loader.image(for: currentURL))
    }

    @MainActor
    func testFailedThumbnailReplacementCannotPresentPreviousUpload() async throws {
        let oldURL = URL(string: "https://example.com/old.jpg")!
        let newURL = URL(string: "https://example.com/new.jpg")!
        let image = try XCTUnwrap(UIImage(data: makeTestImageData(width: 8, height: 8)))
        let loader = StableImageLoader()
        await loader.load(url: oldURL, retryDelays: []) { _ in image }
        await loader.load(url: newURL, retryDelays: []) { _ in nil }
        XCTAssertNil(loader.image(for: newURL))
        XCTAssertNil(loader.image(for: nil))
        XCTAssertTrue(loader.image(for: oldURL) === image)
    }

    func testMyStoryThumbnailAndOverlayUseTheSameItemDuringPartialFeedUpdate() {
        let oldOverlay = StoryTextOverlay(id: "old", label: "OLD", positionX: 0.5, positionY: 0.5,
            kind: nil, href: nil, sourceInteractionId: nil, sourceActorName: nil, sourceActorHandle: nil, sourceActorAvatarUrl: nil)
        let newOverlay = StoryTextOverlay(id: "new", label: "NEW", positionX: 0.5, positionY: 0.5,
            kind: nil, href: nil, sourceInteractionId: nil, sourceActorName: nil, sourceActorHandle: nil, sourceActorAvatarUrl: nil)
        let oldURL = URL(string: "https://example.com/old.jpg")!
        let newURL = URL(string: "https://example.com/new.jpg")!
        let owner = MyStorySummary.Owner(id: "owner", name: "Owner", handle: "owner", imageUrl: nil)
        func summary(_ items: [StoryCard]) -> MyStorySummary {
            MyStorySummary(owner: owner, hasActiveStory: true, liveCount: 2,
                latestThumbnailUrl: newURL, latestAssetKind: .image, latestTextOverlays: [newOverlay],
                expiresSoonLabel: nil, items: items)
        }
        let previous = makeStoryCard(id: "old", playbackURL: oldURL, storageKey: "old", textOverlays: [oldOverlay])
        XCTAssertEqual(summary([previous]).cardThumbnailUrl, oldURL)
        XCTAssertEqual(summary([previous]).cardTextOverlays, [oldOverlay])
        let withoutText = makeStoryCard(id: "no-text", playbackURL: oldURL, storageKey: "old")
        XCTAssertNil(summary([withoutText]).cardTextOverlays)
        XCTAssertEqual(summary([]).cardThumbnailUrl, newURL)
        XCTAssertEqual(summary([]).cardTextOverlays, [newOverlay])
    }

    @MainActor
    func testMyStoryDoesNotRenderNewOverlayBeforeItsThumbnailLoads() throws {
        let owner = MyStorySummary.Owner(id: "owner", name: "Owner", handle: "owner", imageUrl: nil)
        let overlay = StoryTextOverlay(id: "new", label: "NEW UPLOAD TEXT", positionX: 0.5, positionY: 0.5,
            kind: nil, href: nil, sourceInteractionId: nil, sourceActorName: nil, sourceActorHandle: nil, sourceActorAvatarUrl: nil)
        func render(_ overlays: [StoryTextOverlay]) throws -> Data {
            let summary = MyStorySummary(owner: owner, hasActiveStory: true, liveCount: 1,
                latestThumbnailUrl: URL(fileURLWithPath: "/missing-thumbnail-446.jpg"), latestAssetKind: .image,
                latestTextOverlays: overlays, expiresSoonLabel: nil, items: [])
            let renderer = ImageRenderer(content: MyStoryHomeCard(myStory: summary, action: {})
                .environment(\.colorScheme, .light))
            renderer.scale = 1
            return try XCTUnwrap(renderer.uiImage?.pngData())
        }
        XCTAssertEqual(try render([overlay]), try render([]), "A new upload's text must not appear over a loading placeholder")
    }

    @MainActor
    func testStableImageLoaderRejectsAStaleCompletion() async throws {
        let staleURL = URL(string: "https://example.com/stale.jpg")!
        let currentURL = URL(string: "https://example.com/current.jpg")!
        let staleImage = try XCTUnwrap(UIImage(data: makeTestImageData(width: 7, height: 7)))
        let currentImage = try XCTUnwrap(UIImage(data: makeTestImageData(width: 8, height: 8)))
        let loader = StableImageLoader()

        let staleTask = Task { @MainActor in
            await loader.load(url: staleURL, retryDelays: []) { _ in
                try? await Task.sleep(for: .milliseconds(100))
                return staleImage
            }
        }
        try? await Task.sleep(for: .milliseconds(20))

        await loader.load(url: currentURL, retryDelays: []) { _ in currentImage }
        await staleTask.value

        XCTAssertEqual(loader.requestedURL, currentURL)
        XCTAssertEqual(loader.displayedURL, currentURL)
    }

    @MainActor
    func testStableImageLoaderClearsOnlyWhenMediaIsRemoved() async throws {
        let url = URL(string: "https://example.com/current.jpg")!
        let image = try XCTUnwrap(UIImage(data: makeTestImageData(width: 8, height: 8)))
        let loader = StableImageLoader()

        await loader.load(url: url, retryDelays: []) { _ in image }
        XCTAssertNotNil(loader.displayedImage)

        await loader.load(url: nil, retryDelays: []) { _ in image }

        XCTAssertNil(loader.requestedURL)
        XCTAssertNil(loader.displayedURL)
        XCTAssertNil(loader.displayedImage)
    }

    func testStoryReadinessPolicySeparatesPendingFailureAndLiveStates() {
        let pending = StoryStatusResponse.Story(
            id: "story-1",
            status: "processing",
            processingStatus: "processing",
            hasOriginalRendition: true,
            providerStatus: "processing",
            providerPctComplete: 35,
            fullQualityReady: false,
            providerError: nil,
            isLive: false,
            pollAfterMs: 3_000,
            moderationStatus: "pending",
            moderationReason: nil
        )
        let failed = StoryStatusResponse.Story(
            id: "story-1",
            status: "processing",
            processingStatus: "error",
            hasOriginalRendition: true,
            providerStatus: "error",
            providerPctComplete: 35,
            fullQualityReady: false,
            providerError: "encoder failed",
            isLive: false,
            pollAfterMs: nil,
            moderationStatus: "approved",
            moderationReason: nil
        )
        let live = StoryStatusResponse.Story(
            id: "story-1",
            status: "live",
            processingStatus: "ready",
            hasOriginalRendition: true,
            providerStatus: "enhancing",
            providerPctComplete: 33,
            fullQualityReady: false,
            providerError: nil,
            isLive: true,
            pollAfterMs: nil,
            moderationStatus: "approved",
            moderationReason: nil
        )
        let rejected = StoryStatusResponse.Story(
            id: "story-1",
            status: "removed",
            processingStatus: "ready",
            hasOriginalRendition: true,
            providerStatus: "ready",
            providerPctComplete: 100,
            fullQualityReady: true,
            providerError: nil,
            isLive: false,
            pollAfterMs: nil,
            moderationStatus: "rejected",
            moderationReason: "Content did not pass review."
        )
        let underReview = StoryStatusResponse.Story(
            id: "story-1",
            status: "processing",
            processingStatus: "ready",
            hasOriginalRendition: true,
            providerStatus: "ready",
            providerPctComplete: 100,
            fullQualityReady: true,
            providerError: nil,
            isLive: false,
            pollAfterMs: nil,
            moderationStatus: "flagged",
            moderationReason: "This story needs a safety review before it can go live."
        )

        XCTAssertNil(StoryReadinessPolicy.terminalResult(for: pending))
        XCTAssertEqual(StoryReadinessPolicy.terminalResult(for: failed), .processingFailed)
        XCTAssertEqual(StoryReadinessPolicy.terminalResult(for: live), .live)
        XCTAssertEqual(
            StoryReadinessPolicy.terminalResult(for: rejected),
            .rejected("Content did not pass review.")
        )
        XCTAssertEqual(
            StoryReadinessPolicy.terminalResult(for: underReview),
            .underReview("This story needs a safety review before it can go live.")
        )
    }

    func testVideoUploadResponseDecodesPrivatePosterTarget() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "ok": true,
            "uid": String(repeating: "a", count: 32),
            "uploadSessionId": "upload-123",
            "uploadUrl": "https://upload.cloudflare.example/tus",
            "uploadProtocol": "tus",
            "poster": [
                "pathname": "stories/video-posters/\(String(repeating: "a", count: 32))-poster.jpg",
                "uploadUrl": "https://blob.vercel-storage.com?pathname=poster",
                "clientToken": "poster-token",
                "contentType": "image/jpeg",
                "maxSizeBytes": 2 * 1024 * 1024,
                "access": "private",
            ],
        ])

        let response = try JSONDecoder().decode(VideoUploadResponse.self, from: data)

        XCTAssertEqual(response.uploadProtocol, "tus")
        XCTAssertEqual(response.poster?.contentType, "image/jpeg")
        XCTAssertEqual(response.poster?.access, "private")
        XCTAssertEqual(response.poster?.maxSizeBytes, 2 * 1024 * 1024)
    }

    func testVideoPosterMetadataReadsEncodedPixelDimensions() async throws {
        let data = makeTestImageData(width: 1_080, height: 1_920)
        let detectedSize = await StoryUploadFileIO.imagePixelSize(of: data)
        let size = try XCTUnwrap(detectedSize)

        XCTAssertEqual(size.width, 1_080)
        XCTAssertEqual(size.height, 1_920)
    }

    func testCameraPhotoMetadataUsesDisplayOrientedPixelDimensions() async throws {
        let data = try makeOrientedJPEGData(width: 1_200, height: 800)
        let detectedSize = await StoryUploadFileIO.imagePixelSize(of: data)
        let size = try XCTUnwrap(detectedSize)

        XCTAssertEqual(size.width, 800)
        XCTAssertEqual(size.height, 1_200)
    }

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
        let metadata = (0..<40)
            .map { "k\($0)=v\($0)" }
            .joined(separator: " ")
        let parsed = MediaPerformance.parsedEventForTesting("video_startup \(metadata)")

        XCTAssertEqual(parsed?.name, "video_startup")
        XCTAssertEqual(parsed?.metadata.count, 32)
        XCTAssertEqual(parsed?.metadata["k0"], "v0")
        XCTAssertNil(parsed?.metadata["k39"])
    }

    func testTruncatesMetadataKeysAndValues() {
        let longKey = String(repeating: "k", count: 48)
        let longValue = String(repeating: "v", count: 540)
        let parsed = MediaPerformance.parsedEventForTesting("story_open \(longKey)=\(longValue)")

        XCTAssertEqual(parsed?.metadata.keys.first?.count, 40)
        XCTAssertEqual(parsed?.metadata.values.first?.count, 500)
    }

    func testStoryImageTranscoderBoundsAndNormalizesOversizedImage() throws {
        let sourceData = makeTestImageData(width: 4_800, height: 3_200)

        let encoded = try XCTUnwrap(
            StoryImageTranscoder.normalizedJPEG(
                data: sourceData,
                maxPixelDimension: StoryImageUpload.maximumTranscodedPixelDimension,
                quality: StoryImageUpload.transcodedJPEGQuality
            )
        )

        XCTAssertEqual(max(encoded.width, encoded.height), StoryImageUpload.maximumTranscodedPixelDimension)
        XCTAssertLessThanOrEqual(
            min(encoded.width, encoded.height),
            StoryImageUpload.maximumTranscodedPixelDimension
        )

        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(encoded.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)
    }

    func testStoryImageUploadNormalizesOversizedCompatibleOriginal() throws {
        let sourceData = makeTestImageData(width: 2_400, height: 3_200)

        let upload = try XCTUnwrap(
            StoryImageUpload(
                data: sourceData,
                fallbackFileName: "IMG_1234.HEIC"
            )
        )

        XCTAssertEqual(upload.fileName, "IMG_1234.jpg")
        XCTAssertEqual(upload.mimeType, "image/jpeg")
        XCTAssertNotEqual(upload.data, sourceData)

        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(upload.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)
        let properties = try XCTUnwrap(
            CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any]
        )
        let width = try XCTUnwrap(properties[kCGImagePropertyPixelWidth] as? NSNumber)
        let height = try XCTUnwrap(properties[kCGImagePropertyPixelHeight] as? NSNumber)
        XCTAssertEqual(width.intValue, StoryImageUpload.playbackCanvasWidth)
        XCTAssertEqual(height.intValue, StoryImageUpload.playbackCanvasHeight)
        XCTAssertEqual(upload.image.cgImage?.width, StoryImageUpload.playbackCanvasWidth)
        XCTAssertEqual(upload.image.cgImage?.height, StoryImageUpload.playbackCanvasHeight)
    }

    func testStoryImageUploadPreparesCameraJPEGForTheStoryCanvas() throws {
        let sourceData = try makeOrientedJPEGData(width: 1_200, height: 800)
        let upload = try XCTUnwrap(
            StoryImageUpload(
                data: sourceData,
                fallbackFileName: "story-photo"
            )
        )

        XCTAssertEqual(upload.fileName, "story-photo.jpg")
        XCTAssertEqual(upload.mimeType, "image/jpeg")
        XCTAssertEqual(upload.contentMode, .fit)
        XCTAssertNotEqual(upload.data, sourceData)

        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(upload.data as CFData, nil))
        let properties = try XCTUnwrap(
            CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any]
        )
        XCTAssertEqual(
            (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
            StoryImageUpload.playbackCanvasWidth
        )
        XCTAssertEqual(
            (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
            StoryImageUpload.playbackCanvasHeight
        )
    }

    func testStoryImageUploadPreservesWidePhotoCompositionByDefault() async throws {
        let sourceImage = makeHorizontalEdgeMarkerImage(width: 1_600, height: 1_200)
        let sourceData = try XCTUnwrap(sourceImage.pngData())
        let upload = try XCTUnwrap(StoryImageUpload(data: sourceData))
        let checksum = await StoryUploadFileIO.sha256Hex(of: upload.data)
        XCTAssertEqual(upload.sourceChecksum, checksum)
        let imageSource = try XCTUnwrap(
            CGImageSourceCreateWithData(upload.data as CFData, nil)
        )
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(imageSource, 0, nil))
        let middleY = image.height / 2
        let leftPixel = try XCTUnwrap(rgbaPixel(in: image, x: 5, y: middleY))
        let rightPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width - 6, y: middleY)
        )
        let topPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: 5)
        )

        XCTAssertEqual(upload.contentMode, .fit)
        XCTAssertGreaterThan(leftPixel[0], leftPixel[1])
        XCTAssertGreaterThan(leftPixel[0], leftPixel[2])
        XCTAssertGreaterThan(rightPixel[1], rightPixel[0])
        XCTAssertGreaterThan(rightPixel[1], rightPixel[2])
        for component in 0..<3 {
            XCTAssertLessThan(topPixel[component], 10)
        }
    }

    func testStoryPhotoFramingRestoresSourceAfterCropping() async throws {
        let sourceData = makeCropTestImageData(width: 1_600, height: 1_200)
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("photo-framing-\(UUID().uuidString).png")
        try sourceData.write(to: fileURL)
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let uploads = [
            try XCTUnwrap(StoryImageUpload(data: sourceData)),
            try XCTUnwrap(StoryImageUpload(fileURL: fileURL))
        ]
        for original in uploads {
            let fillResult = await original.reframed(to: .fill)
            let filled = try XCTUnwrap(fillResult)
            let filledImage = try XCTUnwrap(filled.image.cgImage)
            let filledTop = try XCTUnwrap(rgbaPixel(in: filledImage, x: filledImage.width / 2, y: 5))
            XCTAssertEqual(filled.contentMode, .fill)
            XCTAssertGreaterThan(Int(filledTop[0]) + Int(filledTop[1]) + Int(filledTop[2]), 30)
            XCTAssertEqual(filledImage.width, 1_080)
            XCTAssertEqual(filledImage.height, 1_920)

            let fitResult = await filled.reframed(to: .fit)
            let restored = try XCTUnwrap(fitResult)
            XCTAssertEqual(restored.contentMode, .fit)
            XCTAssertEqual(restored.data, original.data)
        }
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
                maxPixelDimension: StoryImageUpload.maximumTranscodedPixelDimension
            )
        )

        XCTAssertEqual(encoded.width, 800)
        XCTAssertEqual(encoded.height, 1_200)
        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(encoded.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)
    }

    func testStoryImageTranscoderFillsStoryCanvasWithoutSideBands() throws {
        let cameraPhoto = makeTestImageData(width: 1_600, height: 1_200)
        let reelPhoto = makeCropTestImageData(width: 900, height: 1_950)

        for (index, sourceData) in [cameraPhoto, reelPhoto].enumerated() {
            let encoded = try XCTUnwrap(
                StoryImageTranscoder.storyCanvasJPEG(
                    data: sourceData,
                    width: StoryImageUpload.playbackCanvasWidth,
                    height: StoryImageUpload.playbackCanvasHeight,
                    quality: StoryImageUpload.playbackJPEGQuality,
                    contentMode: .fill
                )
            )

            XCTAssertEqual(encoded.width, StoryImageUpload.playbackCanvasWidth)
            XCTAssertEqual(encoded.height, StoryImageUpload.playbackCanvasHeight)
            let imageSource = try XCTUnwrap(
                CGImageSourceCreateWithData(encoded.data as CFData, nil)
            )
            XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)

            if index == 1 {
                let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(imageSource, 0, nil))
                let topPixel = try XCTUnwrap(
                    rgbaPixel(in: image, x: image.width / 2, y: 4)
                )
                let centerPixel = try XCTUnwrap(
                    rgbaPixel(in: image, x: image.width / 2, y: image.height / 2)
                )

                XCTAssertGreaterThan(topPixel[2], topPixel[0])
                XCTAssertGreaterThan(centerPixel[2], centerPixel[0])
            }
        }
    }

    func testStoryImageTranscoderFitCentersWithoutCropping() throws {
        let sourceData = makeCropTestImageData(width: 1_600, height: 1_200)
        let encoded = try XCTUnwrap(
            StoryImageTranscoder.storyCanvasJPEG(
                data: sourceData,
                width: StoryImageUpload.playbackCanvasWidth,
                height: StoryImageUpload.playbackCanvasHeight,
                quality: StoryImageUpload.playbackJPEGQuality,
                contentMode: .fit
            )
        )
        let imageSource = try XCTUnwrap(
            CGImageSourceCreateWithData(encoded.data as CFData, nil)
        )
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(imageSource, 0, nil))
        let topCenterPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: 4)
        )
        let bottomCenterPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: image.height - 5)
        )
        let centerPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: image.height / 2)
        )

        XCTAssertLessThan(topCenterPixel[0], 10)
        XCTAssertLessThan(topCenterPixel[1], 10)
        XCTAssertLessThan(topCenterPixel[2], 10)
        XCTAssertLessThan(bottomCenterPixel[0], 10)
        XCTAssertLessThan(bottomCenterPixel[1], 10)
        XCTAssertLessThan(bottomCenterPixel[2], 10)
        XCTAssertGreaterThan(centerPixel[2], centerPixel[0])
    }

    func testStoryImageTranscoderFitCanvasUsesSolidBlackLetterboxing() throws {
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("opaque-fit-\(UUID().uuidString).png")
        try makeCropTestImageData(width: 1_600, height: 1_200)
            .write(to: fileURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let image = try XCTUnwrap(
            StoryImageTranscoder.storyCanvasImage(
                fileURL: fileURL,
                width: StoryImageUpload.playbackCanvasWidth,
                height: StoryImageUpload.playbackCanvasHeight,
                contentMode: .fit
            )
        )
        let topPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: 4)
        )
        let centerPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: image.height / 2)
        )

        XCTAssertGreaterThan(topPixel[3], 245)
        XCTAssertLessThan(topPixel[0], 10)
        XCTAssertLessThan(topPixel[1], 10)
        XCTAssertLessThan(topPixel[2], 10)
        XCTAssertGreaterThan(centerPixel[3], 245)
        XCTAssertGreaterThan(centerPixel[2], centerPixel[0])
    }

    func testStoryImageTranscoderMakesTransparentFitCanvasOpaque() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let sourceData = UIGraphicsImageRenderer(
            size: CGSize(width: 400, height: 300),
            format: format
        ).pngData { context in
            context.cgContext.clear(CGRect(x: 0, y: 0, width: 400, height: 300))
            UIColor.systemRed.setFill()
            context.fill(CGRect(x: 100, y: 50, width: 200, height: 200))
        }
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("transparent-fit-\(UUID().uuidString).png")
        try sourceData.write(to: fileURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let image = try XCTUnwrap(
            StoryImageTranscoder.storyCanvasImage(
                fileURL: fileURL,
                width: StoryImageUpload.playbackCanvasWidth,
                height: StoryImageUpload.playbackCanvasHeight,
                contentMode: .fit
            )
        )
        let topPixel = try XCTUnwrap(rgbaPixel(in: image, x: image.width / 2, y: 4))
        let centerPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: image.height / 2)
        )

        XCTAssertGreaterThan(topPixel[3], 245)
        XCTAssertLessThan(topPixel[0], 10)
        XCTAssertLessThan(topPixel[1], 10)
        XCTAssertLessThan(topPixel[2], 10)
        XCTAssertGreaterThan(centerPixel[3], 245)
    }

    func testStoryCanvasLayoutClearsViewerChromeWithMinimumUpwardShift() {
        let screenSize = CGSize(width: 393, height: 852)

        for reservedBottomHeight in [CGFloat(0), 90, 108] {
            let layout = StoryCanvasLayout(
                containerSize: screenSize,
                reservedBottomHeight: reservedBottomHeight
            )

            XCTAssertEqual(
                layout.frame.width / layout.frame.height,
                StoryCanvasLayout.aspectRatio,
                accuracy: 0.000_1
            )
            let centeredY = (screenSize.height - layout.frame.height) / 2
            let highestAllowedBottom = screenSize.height - reservedBottomHeight
            XCTAssertEqual(
                layout.frame.minY,
                min(centeredY, highestAllowedBottom - layout.frame.height),
                accuracy: 0.000_1
            )
            XCTAssertGreaterThanOrEqual(layout.frame.minX, 0)
            XCTAssertLessThanOrEqual(layout.frame.maxX, screenSize.width + 0.000_1)
            XCTAssertGreaterThanOrEqual(layout.frame.minY, 0)
            XCTAssertLessThanOrEqual(layout.frame.maxY, highestAllowedBottom + 0.000_1)
        }
    }

    func testStoryCanvasLayoutLiftsPortraitMediaWithoutHorizontalCrop() {
        let screenSize = CGSize(width: 393, height: 852)
        let reservedBottomHeight = CGFloat(90)
        let layout = StoryCanvasLayout(
            containerSize: screenSize,
            reservedBottomHeight: reservedBottomHeight
        )

        XCTAssertEqual(layout.frame.minY, 63.333_333, accuracy: 0.000_1)
        XCTAssertEqual(layout.frame.minX, 0, accuracy: 0.000_1)
        XCTAssertEqual(layout.frame.maxX, screenSize.width, accuracy: 0.000_1)
        XCTAssertLessThanOrEqual(
            layout.frame.maxY,
            screenSize.height - reservedBottomHeight + 0.000_1
        )
        XCTAssertEqual(
            layout.frame.width / layout.frame.height,
            StoryCanvasLayout.aspectRatio,
            accuracy: 0.000_1
        )
    }

    func testStoryCanvasLayoutScalesDownOnCompactScreensWithoutChangingAspect() {
        let layout = StoryCanvasLayout(
            containerSize: CGSize(width: 320, height: 568),
            reservedBottomHeight: 110
        )

        XCTAssertEqual(layout.frame.height, 458, accuracy: 0.000_1)
        XCTAssertEqual(
            layout.frame.width,
            458 * StoryCanvasLayout.aspectRatio,
            accuracy: 0.000_1
        )
        XCTAssertEqual(layout.frame.midX, 160, accuracy: 0.000_1)
        XCTAssertEqual(layout.frame.minY, 0, accuracy: 0.000_1)
        XCTAssertEqual(layout.frame.maxY, 458, accuracy: 0.000_1)
    }

    func testStoryCanvasLayoutNeverOverflowsTheViewport() {
        let screenSize = CGSize(width: 393, height: 852)
        let reservedBottomHeight = CGFloat(90)
        let layout = StoryCanvasLayout(
            containerSize: screenSize,
            reservedBottomHeight: reservedBottomHeight
        )

        XCTAssertLessThanOrEqual(layout.frame.maxY, screenSize.height - reservedBottomHeight)
        XCTAssertEqual(
            layout.frame.width / layout.frame.height,
            StoryCanvasLayout.aspectRatio,
            accuracy: 0.000_1
        )
        XCTAssertEqual(layout.frame.midX, screenSize.width / 2, accuracy: 0.000_1)
        XCTAssertGreaterThanOrEqual(layout.frame.minX, 0)
        XCTAssertLessThanOrEqual(layout.frame.maxX, screenSize.width)
        XCTAssertLessThanOrEqual(layout.frame.maxY, screenSize.height)
    }

    func testStoryCanvasLayoutLeavesAlreadyClearLayoutsUnchanged() {
        for screenSize in [CGSize(width: 393, height: 852), CGSize(width: 430, height: 932)] {
            let layout = StoryCanvasLayout(
                containerSize: screenSize,
                reservedBottomHeight: 64
            )

            XCTAssertEqual(layout.frame.midY, screenSize.height / 2, accuracy: 0.000_1)
            XCTAssertEqual(layout.frame.width, screenSize.width, accuracy: 0.000_1)
        }
    }

    func testStoryCanvasLayoutRespectsBothReservedEdges() {
        let layout = StoryCanvasLayout(
            containerSize: CGSize(width: 393, height: 852),
            reservedTopHeight: 58,
            reservedBottomHeight: 108
        )

        XCTAssertEqual(layout.frame.minY, 58, accuracy: 0.000_1)
        XCTAssertEqual(layout.frame.maxY, 744, accuracy: 0.000_1)
        XCTAssertEqual(
            layout.frame.width / layout.frame.height,
            StoryCanvasLayout.aspectRatio,
            accuracy: 0.000_1
        )
    }

    func testStoryViewerCanvasExtendsToTopWithoutMovingBottom() {
        for screenSize in [CGSize(width: 393, height: 852), CGSize(width: 430, height: 932), CGSize(width: 320, height: 568)] {
            for reservedBottomHeight in [CGFloat(0), 90, 108] {
                let fitted = StoryCanvasLayout(
                    containerSize: screenSize,
                    reservedBottomHeight: reservedBottomHeight
                )
                let viewer = StoryCanvasLayout(
                    containerSize: screenSize,
                    reservedBottomHeight: reservedBottomHeight,
                    extendsToTop: true
                )

                XCTAssertEqual(viewer.frame.minY, 0, accuracy: 0.000_1)
                XCTAssertEqual(viewer.frame.maxY, fitted.frame.maxY, accuracy: 0.000_1)
                XCTAssertEqual(viewer.frame.minX, fitted.frame.minX, accuracy: 0.000_1)
                XCTAssertEqual(viewer.frame.width, fitted.frame.width, accuracy: 0.000_1)
                XCTAssertGreaterThanOrEqual(viewer.frame.height, fitted.frame.height)
                XCTAssertLessThanOrEqual(viewer.frame.maxY, screenSize.height - reservedBottomHeight + 0.000_1)
            }
        }
    }

    func testStoryViewerCanvasKeepsAnAlreadyTopAlignedFrameUnchanged() {
        let screenSize = CGSize(width: 320, height: 568)
        let fitted = StoryCanvasLayout(containerSize: screenSize, reservedBottomHeight: 110)
        let viewer = StoryCanvasLayout(containerSize: screenSize, reservedBottomHeight: 110, extendsToTop: true)

        XCTAssertEqual(viewer.frame, fitted.frame)
    }

    func testStoryViewerCanvasPreservesExplicitReservedTop() {
        let viewer = StoryCanvasLayout(
            containerSize: CGSize(width: 393, height: 852),
            reservedTopHeight: 58,
            reservedBottomHeight: 108,
            extendsToTop: true
        )

        XCTAssertEqual(viewer.frame.minY, 58, accuracy: 0.000_1)
        XCTAssertEqual(viewer.frame.maxY, 744, accuracy: 0.000_1)
    }

    func testStoryVideoFramingPreservesLandscapeSquareAndWiderPortraitVideo() {
        for size in [(1920, 1080), (1080, 1080), (1080, 1440)] {
            XCTAssertEqual(StoryVideoFramingPolicy.contentMode(width: size.0, height: size.1), .fit)
        }
    }

    func testStoryVideoFramingKeepsStoryPortraitVideoExtendedToTop() {
        for size in [(720, 1280), (1080, 1920), (1080, 2340)] {
            XCTAssertEqual(StoryVideoFramingPolicy.contentMode(width: size.0, height: size.1), .fill)
        }
    }

    func testStoryVideoFramingPreservesUnknownAndInvalidGeometry() {
        XCTAssertEqual(StoryVideoFramingPolicy.contentMode(width: nil, height: nil), .fit)
        XCTAssertEqual(StoryVideoFramingPolicy.contentMode(width: 1920, height: nil), .fit)
        XCTAssertEqual(StoryVideoFramingPolicy.contentMode(width: 0, height: 1080), .fit)
        XCTAssertEqual(StoryVideoFramingPolicy.contentMode(width: 1920, height: -1), .fit)
        XCTAssertEqual(makeStoryStackItem(id: "legacy-video", assetKind: .video).playbackVideoContentMode, .fit)
    }

    @MainActor
    func testLandscapeVideoPosterRetainsBothSidesInExtendedStoryViewer() throws {
        let url = URL(string: "https://example.com/landscape/master.m3u8")!
        let item = makeStoryStackItem(
            id: "landscape-video",
            assetKind: .video,
            renditions: StoryMediaRenditions(
                playback: StoryMediaRendition(
                    mediaUrl: url, thumbnailUrl: nil, placeholderUrl: nil,
                    storageProvider: "cloudflare-stream", storageKey: "landscape-video",
                    contentType: "application/vnd.apple.mpegurl", byteSize: nil, checksum: nil,
                    width: 1920, height: 1080, durationMs: 10_000, processingStatus: "ready"
                ),
                original: nil
            )
        )
        XCTAssertEqual(item.playbackVideoContentMode, .fit)

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let source = UIGraphicsImageRenderer(size: CGSize(width: 160, height: 90), format: format)
            .image { context in
                UIColor.blue.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 160, height: 90))
                UIColor.red.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 16, height: 90))
                UIColor.green.setFill()
                context.fill(CGRect(x: 144, y: 0, width: 16, height: 90))
            }
        let renderer = ImageRenderer(
            content: StoryCanvasImage(image: Image(uiImage: source), contentMode: item.playbackVideoContentMode)
                .frame(width: 90, height: 180)
        )
        renderer.scale = 1
        let rendered = try XCTUnwrap(renderer.uiImage?.cgImage)
        let left = try XCTUnwrap(rgbaPixel(in: rendered, x: 2, y: 90))
        let right = try XCTUnwrap(rgbaPixel(in: rendered, x: 87, y: 90))
        XCTAssertGreaterThan(left[0], 245)
        XCTAssertGreaterThan(right[1], 245)
        for y in [2, 177] {
            let pixel = try XCTUnwrap(rgbaPixel(in: rendered, x: 45, y: y))
            XCTAssertLessThan(pixel[0], 10)
            XCTAssertLessThan(pixel[1], 10)
            XCTAssertLessThan(pixel[2], 10)
        }
    }

    @MainActor
    func testStoryViewerImageFillsTheExtendedCanvasWithoutTopLetterboxing() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let source = UIGraphicsImageRenderer(size: CGSize(width: 90, height: 160), format: format)
            .image { context in
                UIColor.blue.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 90, height: 160))
            }
        let renderer = ImageRenderer(
            content: StoryCanvasImage(image: Image(uiImage: source), contentMode: .fill)
                .frame(width: 90, height: 180)
        )
        renderer.scale = 1
        let rendered = try XCTUnwrap(renderer.uiImage?.cgImage)

        for y in [1, rendered.height - 2] {
            let pixel = try XCTUnwrap(rgbaPixel(in: rendered, x: rendered.width / 2, y: y))
            XCTAssertGreaterThan(pixel[2], 245)
            XCTAssertLessThan(pixel[0], 10)
            XCTAssertLessThan(pixel[1], 10)
        }
    }

    func testStoryCanvasContractUsesCanonicalDerivativeSizes() {
        XCTAssertEqual(StoryCanvasLayout.playbackPixelSize.width, 1_080)
        XCTAssertEqual(StoryCanvasLayout.playbackPixelSize.height, 1_920)
        XCTAssertEqual(StoryCanvasLayout.thumbnailPixelSize.width, 360)
        XCTAssertEqual(StoryCanvasLayout.thumbnailPixelSize.height, 640)
        XCTAssertEqual(StoryMediaContract.maximumImageUploadBytes, 25 * 1024 * 1024)
        XCTAssertEqual(
            StoryMediaContract.maximumImageDisplayDerivativeBytes,
            1_500_000
        )
        XCTAssertEqual(
            StoryMediaContract.maximumImageThumbnailDerivativeBytes,
            150_000
        )
        XCTAssertEqual(
            StoryMediaContract.displayAVIFQualityCandidates,
            [0.75, 0.70, 0.65, 0.60]
        )
        XCTAssertEqual(
            StoryMediaContract.displayWebPQualityCandidates,
            [0.90, 0.85, 0.80, 0.75, 0.70]
        )
        XCTAssertEqual(
            StoryMediaContract.thumbnailWebPQualityCandidates,
            [0.80, 0.75, 0.70, 0.65, 0.60]
        )
        XCTAssertEqual(StoryMediaContract.maximumVideoUploadBytes, 512 * 1024 * 1024)
        XCTAssertEqual(StoryMediaContract.maximumVideoDurationSeconds, 120)
        XCTAssertEqual(
            StoryCanvasLayout.playbackPixelSize.width /
                StoryCanvasLayout.playbackPixelSize.height,
            StoryCanvasLayout.aspectRatio,
            accuracy: 0.000_1
        )
    }

    func testStoryImageDerivativeBuilderProducesCanonicalBoundedVariants() async throws {
        XCTAssertEqual(StoryImageDerivativeBuilder.displayContentMode, .fit)
        XCTAssertEqual(StoryImageDerivativeBuilder.thumbnailContentMode, .fill)

        let sourceData = makeCropTestImageData(width: 1_600, height: 1_200)
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("story-derivative-\(UUID().uuidString).png")
        try sourceData.write(to: fileURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let derivatives = try await StoryImageDerivativeBuilder.build(fileURL: fileURL)

        XCTAssertEqual(derivatives.display.width, 1_080)
        XCTAssertEqual(derivatives.display.height, 1_920)
        XCTAssertLessThanOrEqual(
            derivatives.display.data.count,
            StoryMediaContract.maximumImageDisplayDerivativeBytes
        )
        XCTAssertTrue(["image/avif", "image/webp"].contains(derivatives.display.contentType))
        XCTAssertEqual(derivatives.thumbnail.width, 360)
        XCTAssertEqual(derivatives.thumbnail.height, 640)
        XCTAssertEqual(derivatives.thumbnail.contentType, "image/webp")
        XCTAssertLessThanOrEqual(
            derivatives.thumbnail.data.count,
            StoryMediaContract.maximumImageThumbnailDerivativeBytes
        )
        XCTAssertFalse(derivatives.thumbHash.isEmpty)

        if derivatives.display.contentType == "image/avif" {
            let avifURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("story-source-\(UUID().uuidString).avif")
            try derivatives.display.data.write(to: avifURL, options: .atomic)
            defer { try? FileManager.default.removeItem(at: avifURL) }
            let preparedUpload = await StoryImageUpload.prepare(fileURL: avifURL)
            let upload = try XCTUnwrap(preparedUpload)
            XCTAssertEqual(upload.mimeType, "image/jpeg")
            XCTAssertNotEqual(upload.data, derivatives.display.data)
            XCTAssertEqual(upload.image.cgImage?.width, StoryImageUpload.playbackCanvasWidth)
            XCTAssertEqual(upload.image.cgImage?.height, StoryImageUpload.playbackCanvasHeight)
        }
    }

    @MainActor
    func testStoryCanvasImageFitsWithoutCroppingNonCanonicalMedia() throws {
        let sourceImage = try XCTUnwrap(
            UIImage(data: makeTestImageData(width: 400, height: 400))
        )
        let renderer = ImageRenderer(
            content: StoryCanvasImage(image: Image(uiImage: sourceImage))
                .frame(width: 360, height: 640)
        )
        renderer.scale = 1
        let renderedUIImage = try XCTUnwrap(renderer.uiImage)
        let renderedImage = try XCTUnwrap(renderedUIImage.cgImage)
        let topPixel = try XCTUnwrap(
            rgbaPixel(in: renderedImage, x: renderedImage.width / 2, y: 2)
        )
        let bottomPixel = try XCTUnwrap(
            rgbaPixel(
                in: renderedImage,
                x: renderedImage.width / 2,
                y: renderedImage.height - 3
            )
        )

        for component in 0..<3 {
            XCTAssertLessThan(topPixel[component], 10)
            XCTAssertLessThan(bottomPixel[component], 10)
        }

        let centerPixel = try XCTUnwrap(
            rgbaPixel(in: renderedImage, x: renderedImage.width / 2, y: renderedImage.height / 2)
        )
        XCTAssertGreaterThan(centerPixel[2], centerPixel[0])
        XCTAssertGreaterThan(centerPixel[2], centerPixel[1])
    }

    @MainActor
    func testStoryImageVerticalAlignmentCorrectsOnlyAsymmetricTransparentPadding() {
        let format = UIGraphicsImageRendererFormat()
        format.opaque = false
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: 360, height: 640),
            format: format
        )
        let topAligned = renderer.image { context in
            UIColor.red.setFill()
            context.cgContext.fill(CGRect(x: 0, y: 0, width: 360, height: 270))
        }
        let centered = renderer.image { context in
            UIColor.red.setFill()
            context.cgContext.fill(CGRect(x: 0, y: 185, width: 360, height: 270))
        }

        XCTAssertEqual(
            StoryImageVerticalAlignmentPolicy.correctionFraction(for: topAligned),
            185 / 640,
            accuracy: 0.002
        )
        XCTAssertEqual(
            StoryImageVerticalAlignmentPolicy.correctionFraction(for: centered),
            0,
            accuracy: 0.002
        )
    }

    @MainActor
    func testProgressiveImageLoaderClearsPresentationStateBetweenRequests() async throws {
        let format = UIGraphicsImageRendererFormat()
        format.opaque = false
        format.scale = 1
        let image = UIGraphicsImageRenderer(
            size: CGSize(width: 36, height: 64),
            format: format
        ).image { context in
            UIColor.red.setFill()
            context.cgContext.fill(CGRect(x: 0, y: 0, width: 36, height: 27))
        }
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("progressive-loader-\(UUID().uuidString).png")
        try XCTUnwrap(image.pngData()).write(to: fileURL)
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let loader = ProgressiveImageLoader()
        await loader.load(
            placeholderURL: nil,
            thumbnailURL: nil,
            fullURL: fileURL,
            correctsAsymmetricTransparentPadding: true
        )

        XCTAssertNotNil(loader.image)
        XCTAssertEqual(loader.stage, .full)
        XCTAssertGreaterThan(loader.verticalContentOffsetFraction, 0)

        await loader.load(
            placeholderURL: nil,
            thumbnailURL: nil,
            fullURL: nil
        )

        XCTAssertNil(loader.image)
        XCTAssertEqual(loader.stage, .none)
        XCTAssertEqual(loader.verticalContentOffsetFraction, 0)
    }

    @MainActor
    func testStoryCanvasImageUsesStableBlackLetterboxInEveryColorScheme() throws {
        let sourceImage = try XCTUnwrap(
            UIImage(data: makeTestImageData(width: 400, height: 400))
        )
        let lightRenderer = ImageRenderer(
            content: StoryCanvasImage(image: Image(uiImage: sourceImage))
                .frame(width: 360, height: 640)
                .environment(\.colorScheme, .light)
        )
        let darkRenderer = ImageRenderer(
            content: StoryCanvasImage(image: Image(uiImage: sourceImage))
                .frame(width: 360, height: 640)
                .environment(\.colorScheme, .dark)
        )
        lightRenderer.scale = 1
        darkRenderer.scale = 1

        let lightImage = try XCTUnwrap(lightRenderer.uiImage?.cgImage)
        let darkImage = try XCTUnwrap(darkRenderer.uiImage?.cgImage)
        let lightTopPixel = try XCTUnwrap(rgbaPixel(in: lightImage, x: 180, y: 2))
        let lightBottomPixel = try XCTUnwrap(rgbaPixel(in: lightImage, x: 180, y: 637))
        let darkTopPixel = try XCTUnwrap(rgbaPixel(in: darkImage, x: 180, y: 2))
        let darkBottomPixel = try XCTUnwrap(rgbaPixel(in: darkImage, x: 180, y: 637))

        for pixel in [lightTopPixel, lightBottomPixel, darkTopPixel, darkBottomPixel] {
            for component in 0..<3 {
                XCTAssertLessThan(pixel[component], 10)
            }
        }
    }

    @MainActor
    func testCanonicalStoryCanvasImageStillFillsEveryEdge() throws {
        let sourceImage = try XCTUnwrap(
            UIImage(data: makeTestImageData(width: 360, height: 640))
        )
        let renderer = ImageRenderer(
            content: StoryCanvasImage(image: Image(uiImage: sourceImage))
                .frame(width: 360, height: 640)
        )
        renderer.scale = 1

        let renderedImage = try XCTUnwrap(renderer.uiImage?.cgImage)
        for y in [2, renderedImage.height / 2, renderedImage.height - 3] {
            let pixel = try XCTUnwrap(
                rgbaPixel(in: renderedImage, x: renderedImage.width / 2, y: y)
            )
            XCTAssertGreaterThan(pixel[2], pixel[0])
            XCTAssertGreaterThan(pixel[2], pixel[1])
        }
    }

    @MainActor
    func testStoryCardThumbnailImageFitsWithoutCropping() throws {
        let sourceImage = UIImage(data: makeTestImageData(width: 400, height: 400))!
        let renderer = ImageRenderer(
            content: StoryCardThumbnailImage(image: Image(uiImage: sourceImage))
                .frame(
                    width: HomeStoryCardMetrics.width,
                    height: HomeStoryCardMetrics.height
                )
                .clipped()
        )
        renderer.scale = 1

        let renderedImage = try XCTUnwrap(renderer.uiImage?.cgImage)
        let centerX = renderedImage.width / 2
        let topPixel = try XCTUnwrap(rgbaPixel(in: renderedImage, x: centerX, y: 2))
        let centerPixel = try XCTUnwrap(
            rgbaPixel(in: renderedImage, x: centerX, y: renderedImage.height / 2)
        )
        let bottomPixel = try XCTUnwrap(
            rgbaPixel(in: renderedImage, x: centerX, y: renderedImage.height - 3)
        )

        for component in 0..<3 {
            XCTAssertLessThan(topPixel[component], 10)
            XCTAssertLessThan(bottomPixel[component], 10)
        }
        XCTAssertGreaterThan(centerPixel[2], centerPixel[0])
        XCTAssertGreaterThan(centerPixel[2], centerPixel[1])
    }

    func testHomeStoryCardUsesTheStoryCanvasAspectRatio() {
        XCTAssertEqual(
            HomeStoryCardMetrics.width / HomeStoryCardMetrics.height,
            StoryMediaContract.aspectRatio,
            accuracy: 0.000_001
        )
    }

    func testStoryCardThumbnailSelectionUsesVersionedFitPreviewForImages() {
        let playbackURL = URL(string: "https://cdn.example.com/story.avif?token=playback")!
        let thumbnailURL = URL(string: "https://cdn.example.com/story-fit-thumb.webp?token=thumb")!
        let originalURL = URL(string: "https://cdn.example.com/original.jpg?token=original")!

        func imageCard(thumbnail: URL) -> StoryCard {
            StoryCard(
                id: UUID().uuidString,
                creator: "Creator",
                handle: "creator",
                assetKind: .image,
                mediaUrl: playbackURL,
                thumbnailUrl: thumbnail,
                placeholderUrl: nil,
                renditions: StoryMediaRenditions(
                    playback: StoryMediaRendition(
                        mediaUrl: playbackURL,
                        thumbnailUrl: thumbnail,
                        placeholderUrl: nil,
                        storageProvider: "vercel-blob",
                        storageKey: "stories/playback.avif",
                        contentType: "image/avif",
                        byteSize: 100,
                        checksum: nil,
                        width: 1_080,
                        height: 1_920,
                        durationMs: nil,
                        processingStatus: "ready"
                    ),
                    original: StoryMediaRendition(
                        mediaUrl: originalURL,
                        thumbnailUrl: nil,
                        placeholderUrl: nil,
                        storageProvider: "vercel-blob",
                        storageKey: "stories/original.jpg",
                        contentType: "image/jpeg",
                        byteSize: 1_000,
                        checksum: nil,
                        width: 1_600,
                        height: 1_200,
                        durationMs: nil,
                        processingStatus: "ready"
                    )
                ),
                title: "",
                processingStatus: "ready",
                textOverlays: nil,
                durationSeconds: nil,
                lastUploadedAt: nil,
                progressPercent: nil,
                timelineSegmentCount: nil
            )
        }

        XCTAssertEqual(imageCard(thumbnail: thumbnailURL).cardThumbnailUrl, thumbnailURL)

        let legacyPlaybackThumbnail = URL(
            string: "https://cdn.example.com/story-thumb.webp?token=legacy-thumbnail-signature"
        )!
        XCTAssertEqual(
            imageCard(thumbnail: legacyPlaybackThumbnail).cardThumbnailUrl,
            legacyPlaybackThumbnail
        )
    }

    @MainActor
    func testPreferredPlaybackAlwaysUsesCanonicalAdaptiveStream() {
        let defaultURL = URL(string: "https://example.com/playback/video.m3u8")!
        let selected = MediaPlaybackQuality.preferredPlaybackURL(defaultURL: defaultURL)

        XCTAssertEqual(selected.url, defaultURL)
        XCTAssertEqual(selected.quality, "adaptive_hls")
    }

    @MainActor
    func testPreferredPlaybackRemovesLegacyFixedBandwidthHint() {
        let defaultURL = URL(
            string: "https://example.com/playback/video.m3u8?token=abc&clientBandwidthHint=8.256"
        )!
        let selected = MediaPlaybackQuality.preferredPlaybackURL(defaultURL: defaultURL)

        XCTAssertEqual(
            selected.url,
            URL(string: "https://example.com/playback/video.m3u8?token=abc")!
        )
        XCTAssertEqual(selected.quality, "adaptive_hls")
    }

    @MainActor
    func testCloudflareStartupPlaybackLocksThePrerolledRendition() throws {
        let json = #"""
        {"version":"test","startupMode":"focused","startupExperiment":"quality-first",
        "imageDerivativeUploadEnabled":true,"qoeAccessLogSampleRate":0.1,"uploadChunkBytes":5242880,
        "mediaFileCacheMaxBytes":1073741824,"imagePreheatLimit":{"constrained":2,"standard":4},
        "stackPreheatLimit":{"constrained":2,"standard":2},"preparedPlayerLimit":{"constrained":1,"standard":2},
        "persistentVideoPreheatLimit":{"constrained":0,"standard":1},"offlineHLSPreheatLimit":{"constrained":0,"standard":0},
        "offlineHLSCacheMaxAssets":2,"startupStreamingPeakBitRate":{"constrained":1600000,"standard":4000000},
        "startupStreamingMaximumResolution":{"constrained":{"width":540,"height":960},"standard":{"width":720,"height":1280}}}
        """#
        MediaControlConfig.shared.apply(try JSONDecoder().decode(MobileMediaConfigResponse.Media.self, from: Data(json.utf8)))
        let adaptiveURL = try XCTUnwrap(
            URL(
                string: "https://www.ubeye.ai/api/story-media/cloudflare-stream/abc/manifest/video.m3u8?token=signed"
            )
        )
        let startupURL = MediaPlaybackQuality.startupPlaybackURL(for: adaptiveURL)
        let components = try XCTUnwrap(
            URLComponents(url: startupURL, resolvingAgainstBaseURL: false)
        )

        XCTAssertEqual(
            components.queryItems?.first(where: { $0.name == "token" })?.value,
            "signed"
        )
        XCTAssertEqual(
            components.queryItems?.first(where: {
                $0.name == MediaPlaybackQuality.clientBandwidthHintQueryName
            })?.value,
            "8.000"
        )
        XCTAssertTrue(MediaPlaybackQuality.isStartupQualityLocked(startupURL))
        XCTAssertEqual(
            MediaPlaybackQuality.adaptivePlaybackURL(for: startupURL),
            adaptiveURL
        )
    }

    @MainActor
    func testAdaptiveStartupCanaryKeepsAllRenditionsAndSignedAccess() throws {
        let json = #"""
        {"version":"test","startupMode":"adaptive","startupExperiment":"adaptive-canary",
        "imageDerivativeUploadEnabled":true,"qoeAccessLogSampleRate":0.1,"uploadChunkBytes":5242880,
        "mediaFileCacheMaxBytes":1073741824,"imagePreheatLimit":{"constrained":2,"standard":4},
        "stackPreheatLimit":{"constrained":2,"standard":2},"preparedPlayerLimit":{"constrained":1,"standard":2},
        "persistentVideoPreheatLimit":{"constrained":0,"standard":1},"offlineHLSPreheatLimit":{"constrained":0,"standard":0},
        "offlineHLSCacheMaxAssets":2,"startupStreamingPeakBitRate":{"constrained":1600000,"standard":4000000},
        "startupStreamingMaximumResolution":{"constrained":{"width":540,"height":960},"standard":{"width":720,"height":1280}}}
        """#
        let config = try JSONDecoder().decode(MobileMediaConfigResponse.Media.self, from: Data(json.utf8))
        let baseline = try JSONDecoder().decode(MobileMediaConfigResponse.Media.self, from: Data(json.replacingOccurrences(of: "adaptive", with: "focused").utf8))
        MediaControlConfig.shared.apply(config)
        defer { MediaControlConfig.shared.apply(baseline) }
        let url = try XCTUnwrap(URL(string: "https://www.ubeye.ai/api/story-media/cloudflare-stream/abc/manifest/video.m3u8?token=signed&clientBandwidthHint=8.000"))
        let startup = MediaPlaybackQuality.startupPlaybackURL(for: url)
        XCTAssertEqual(startup.absoluteString, "https://www.ubeye.ai/api/story-media/cloudflare-stream/abc/manifest/video.m3u8?token=signed")
        XCTAssertFalse(MediaPlaybackQuality.isStartupQualityLocked(startup))
        XCTAssertFalse(MediaPlaybackQuality.allowsPreparedPlaybackURL(url))
        XCTAssertTrue(MediaPlaybackQuality.allowsPreparedPlaybackURL(startup))
        XCTAssertEqual(MediaControlConfig.shared.startupExperiment, "adaptive-canary")
    }

    @MainActor
    func testNonCloudflareStartupPlaybackRemainsAdaptive() {
        let url = URL(string: "https://cdn.example.com/media/master.m3u8?token=signed")!

        XCTAssertEqual(MediaPlaybackQuality.startupPlaybackURL(for: url), url)
        XCTAssertFalse(MediaPlaybackQuality.isStartupQualityLocked(url))
    }

    func testStoryNavigationPolicyMovesWithinStackAndFinishesAtEnd() {
        XCTAssertEqual(
            StoryNavigationPolicy.action(currentIndex: 0, itemCount: 3, delta: 1),
            .move(to: 1)
        )
        XCTAssertEqual(
            StoryNavigationPolicy.action(currentIndex: 1, itemCount: 3, delta: -1),
            .move(to: 0)
        )
        XCTAssertEqual(
            StoryNavigationPolicy.action(currentIndex: 0, itemCount: 3, delta: -1),
            .stay
        )
        XCTAssertEqual(
            StoryNavigationPolicy.action(currentIndex: 2, itemCount: 3, delta: 1),
            .finish
        )
        XCTAssertEqual(
            StoryNavigationPolicy.action(currentIndex: 0, itemCount: 0, delta: 1),
            .stay
        )
    }

    func testExplicitStoryNavigationDoesNotWaitForPressPauseToEnd() {
        XCTAssertFalse(
            StoryCompletionPolicy.shouldDefer(
                trigger: .explicitNavigation,
                progressIsPaused: true
            )
        )
        XCTAssertTrue(
            StoryCompletionPolicy.shouldDefer(
                trigger: .automaticPlayback,
                progressIsPaused: true
            )
        )
    }

    func testStoryStackRefreshPreservesActiveIdentityAndClampsRemovedPendingItem() {
        XCTAssertEqual(
            StoryStackRefreshPolicy.resolvedIndex(
                activeItemID: "active",
                previousIndex: 2,
                itemIDs: ["first", "active", "last"]
            ),
            1
        )
        XCTAssertEqual(
            StoryStackRefreshPolicy.resolvedIndex(
                activeItemID: "pending-story-finished",
                previousIndex: 2,
                itemIDs: ["first", "last"]
            ),
            1
        )
        XCTAssertNil(
            StoryStackRefreshPolicy.resolvedIndex(
                activeItemID: "pending-story-finished",
                previousIndex: 0,
                itemIDs: []
            )
        )
    }

    func testPendingStoryMergeDropsCompletedLocalPlaceholders() {
        XCTAssertEqual(
            PendingStoryMergePolicy.merge(
                base: ["server-story", "pending-story-completed"],
                pending: ["pending-story-active"],
                id: { $0 }
            ),
            ["server-story", "pending-story-active"]
        )
    }

    func testPendingProgressUpdatesDoNotReprepareUnchangedMediaTopology() {
        XCTAssertFalse(
            StoryStackRefreshPolicy.mediaTopologyChanged(
                previousIdentities: ["server", "pending"],
                nextIdentities: ["server", "pending"]
            )
        )
        XCTAssertTrue(
            StoryStackRefreshPolicy.mediaTopologyChanged(
                previousIdentities: ["server", "pending"],
                nextIdentities: ["server", "published"]
            )
        )
    }

    func testStoryReadinessPollingUsesFastInitialCadenceWithinBounds() {
        XCTAssertEqual(
            StoryReadinessPollingPolicy.delayMilliseconds(
                requestedMilliseconds: nil,
                attempt: 0
            ),
            750
        )
        XCTAssertEqual(
            StoryReadinessPollingPolicy.delayMilliseconds(
                requestedMilliseconds: 250,
                attempt: 0
            ),
            500
        )
        XCTAssertEqual(
            StoryReadinessPollingPolicy.delayMilliseconds(
                requestedMilliseconds: 12_000,
                attempt: 0
            ),
            10_000
        )
    }

    func testStoryDeletionPolicyPrefersNextThenPreviousItem() {
        let itemIDs = ["first", "current", "next"]

        XCTAssertEqual(
            StoryDeletionPolicy.replacementItemID(
                deleting: "current",
                from: itemIDs
            ),
            "next"
        )
        XCTAssertEqual(
            StoryDeletionPolicy.replacementItemID(
                deleting: "next",
                from: itemIDs
            ),
            "current"
        )
        XCTAssertNil(
            StoryDeletionPolicy.replacementItemID(
                deleting: "missing",
                from: itemIDs
            )
        )
    }

    func testStoryMediaBufferAdaptsToResourceMode() {
        XCTAssertEqual(
            StoryMediaBufferPolicy.indices(activeIndex: 0, itemCount: 4),
            [0, 1]
        )
        XCTAssertEqual(
            StoryMediaBufferPolicy.indices(activeIndex: 2, itemCount: 4),
            [2, 3, 1]
        )
        XCTAssertEqual(
            StoryMediaBufferPolicy.indices(activeIndex: 3, itemCount: 4),
            [3, 2]
        )
        XCTAssertEqual(
            StoryMediaBufferPolicy.indices(activeIndex: 4, itemCount: 4),
            []
        )
        XCTAssertEqual(
            StoryMediaBufferPolicy.indices(activeIndex: 2, itemCount: 4, mode: .constrained),
            [2, 3]
        )
        XCTAssertEqual(
            StoryMediaBufferPolicy.indices(activeIndex: 2, itemCount: 4, mode: .critical),
            [2]
        )
    }

    func testStoryMediaBufferUsesStableSourceOrderAcrossAdjacentMoves() {
        XCTAssertEqual(
            StoryMediaBufferPolicy.stableIndices(activeIndex: 0, itemCount: 4),
            [0, 1]
        )
        XCTAssertEqual(
            StoryMediaBufferPolicy.stableIndices(activeIndex: 1, itemCount: 4),
            [0, 1, 2]
        )
        XCTAssertEqual(
            StoryMediaBufferPolicy.stableIndices(activeIndex: 2, itemCount: 4),
            [1, 2, 3]
        )
    }

    func testCellularAndLowPowerReduceSpeculationWithoutBlockingHDRecovery() {
        for lowPower in [false, true] {
            let mode = UBEYEAdaptivePolicy.mode(lowPowerMode: lowPower, thermalState: .nominal,
                recentMemoryPressure: false, limitedNetwork: true)
            XCTAssertEqual(mode, .constrained)
            XCTAssertFalse(VisibleVideoQualityPolicy.isRestricted(lowDataMode: false, resourceMode: mode))
            XCTAssertEqual(StoryPreheatPolicy.playerLimit(throughput: 20_000_000, isLimited: true), 1)
        }
        XCTAssertTrue(VisibleVideoQualityPolicy.isRestricted(lowDataMode: true, resourceMode: .standard))
        for thermal in [ProcessInfo.ThermalState.serious, .critical] {
            let mode = UBEYEAdaptivePolicy.mode(lowPowerMode: false, thermalState: thermal,
                recentMemoryPressure: false, limitedNetwork: false)
            XCTAssertTrue(VisibleVideoQualityPolicy.isRestricted(lowDataMode: false, resourceMode: mode))
        }
        let pressure = UBEYEAdaptivePolicy.mode(lowPowerMode: false, thermalState: .nominal,
            recentMemoryPressure: true, limitedNetwork: false)
        XCTAssertTrue(VisibleVideoQualityPolicy.isRestricted(lowDataMode: false, resourceMode: pressure))
    }

    func testQualityRecoveryCanUpgradeAfterProlongedPoorReception() {
        var recovery = VideoQualityRecoveryState()
        // 32 initial quarter-second samples, then a full minute of weak service.
        for _ in 0..<92 {
            XCTAssertEqual(recovery.observe(allowed: true, healthy: false, advancing: true), .none)
        }
        XCTAssertEqual(VideoQualityRampPolicy.observationInterval(elapsed: 7), .milliseconds(250))
        XCTAssertEqual(VideoQualityRampPolicy.observationInterval(elapsed: 60), .seconds(1))
        XCTAssertEqual(recovery.observe(allowed: true, healthy: true, advancing: true), .none)
        XCTAssertEqual(recovery.observe(allowed: true, healthy: true, advancing: true), .relax)
        XCTAssertTrue(recovery.isRelaxed)
        for _ in 0..<10 { XCTAssertEqual(recovery.observe(allowed: true, healthy: true, advancing: true), .none) }
    }

    func testQualityRecoveryRespectsMidStoryRestrictionsAndRequiresFreshRecovery() {
        var recovery = VideoQualityRecoveryState(isRelaxed: true)
        XCTAssertEqual(recovery.observe(allowed: false, healthy: true, advancing: true), .restrict)
        XCTAssertFalse(recovery.isRelaxed)
        XCTAssertEqual(recovery.observe(allowed: false, healthy: true, advancing: true), .none)
        XCTAssertEqual(recovery.observe(allowed: true, healthy: true, advancing: true), .none)
        // Paused/interrupted playback cannot supply a second healthy sample.
        XCTAssertEqual(recovery.observe(allowed: true, healthy: true, advancing: false), .none)
        XCTAssertEqual(recovery.observe(allowed: true, healthy: true, advancing: true), .none)
        XCTAssertEqual(recovery.observe(allowed: true, healthy: false, advancing: true), .none)
        XCTAssertEqual(recovery.observe(allowed: true, healthy: true, advancing: true), .none)
        XCTAssertEqual(recovery.observe(allowed: true, healthy: true, advancing: true), .relax)
    }

    func testCellularPreparationUsesOneDeeperBufferAndPromotesVisibleBudget() {
        XCTAssertEqual(VisibleVideoQualityPolicy.preparedBufferSeconds(restricted: false), 4)
        XCTAssertEqual(VisibleVideoQualityPolicy.activeBufferSeconds(restricted: false), 8)
        XCTAssertEqual(VisibleVideoQualityPolicy.preparedBufferSeconds(restricted: true), 2)
        XCTAssertEqual(VisibleVideoQualityPolicy.activeBufferSeconds(restricted: true), 4)
    }

    func testVideoQualityRampRecognizesPortraitAndLandscape1080p() {
        XCTAssertTrue(
            VideoQualityRampPolicy.hasReached1080p(
                CGSize(width: 1_080, height: 1_920)
            )
        )
        XCTAssertTrue(
            VideoQualityRampPolicy.hasReached1080p(
                CGSize(width: 1_920, height: 1_080)
            )
        )
        XCTAssertFalse(
            VideoQualityRampPolicy.hasReached1080p(
                CGSize(width: 720, height: 1_280)
            )
        )
        XCTAssertFalse(VideoQualityRampPolicy.hasReached1080p(.zero))
    }

    func testVideoQualityRampWaitsForAHealthyForwardBuffer() {
        XCTAssertEqual(VideoQualityRampPolicy.requiredHealthySamples, 2)
        XCTAssertFalse(
            VideoQualityRampPolicy.shouldRelaxStreamingHints(
                isPlaybackLikelyToKeepUp: false,
                bufferedAheadSeconds: 12,
                remainingSeconds: 20
            )
        )
        XCTAssertFalse(
            VideoQualityRampPolicy.shouldRelaxStreamingHints(
                isPlaybackLikelyToKeepUp: true,
                bufferedAheadSeconds: 1.9,
                remainingSeconds: 20
            )
        )
        XCTAssertTrue(
            VideoQualityRampPolicy.shouldRelaxStreamingHints(
                isPlaybackLikelyToKeepUp: true,
                bufferedAheadSeconds: 2,
                remainingSeconds: 20
            )
        )
        XCTAssertTrue(
            VideoQualityRampPolicy.shouldRelaxStreamingHints(
                isPlaybackLikelyToKeepUp: true,
                bufferedAheadSeconds: 3,
                remainingSeconds: 3
            )
        )
    }

    func testVideoCompletionFallbackOnlyAcceptsTheAuthoritativeFinalFrameWindow() {
        XCTAssertFalse(
            VideoPlaybackCompletionPolicy.isAtEnd(
                currentSeconds: 9.4,
                durationSeconds: 10
            )
        )
        XCTAssertFalse(
            VideoPlaybackCompletionPolicy.isAtEnd(
                currentSeconds: 9.8,
                durationSeconds: 10
            )
        )
        XCTAssertTrue(
            VideoPlaybackCompletionPolicy.isAtEnd(
                currentSeconds: 9.96,
                durationSeconds: 10
            )
        )
        XCTAssertFalse(
            VideoPlaybackCompletionPolicy.isAtEnd(
                currentSeconds: .nan,
                durationSeconds: 10
            )
        )
    }

    func testNormalizedVideoEnvelopeDoesNotDependOnNetworkConditions() {
        XCTAssertEqual(
            StoryVideoUploadNormalizer.normalizedTargetBitsPerSecond,
            8_200_000
        )
        XCTAssertEqual(
            StoryVideoUploadNormalizer.normalizedFileLengthLimit(durationSeconds: 10),
            10_250_000
        )
        XCTAssertNil(
            StoryVideoUploadNormalizer.normalizedFileLengthLimit(durationSeconds: 0)
        )
        XCTAssertNil(
            StoryVideoUploadNormalizer.normalizedFileLengthLimit(durationSeconds: .infinity)
        )
    }

    func testPressPausePolicyOnlyPausesPlayableVideoWhileTouchIsDown() {
        XCTAssertTrue(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .video,
                processingStatus: "ready",
                isPressing: true
            )
        )
        XCTAssertTrue(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .video,
                processingStatus: nil,
                isPressing: true
            )
        )
        XCTAssertFalse(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .image,
                processingStatus: "ready",
                isPressing: true
            )
        )
        XCTAssertFalse(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .video,
                processingStatus: "processing",
                isPressing: true
            )
        )
        XCTAssertFalse(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .video,
                processingStatus: "ready",
                isPressing: false
            )
        )
    }

    func testReleasingVideoPressDoesNotOverrideAnotherPauseReason() {
        var policy = StoryViewerPausePolicy(isPressingPlayableVideo: true)
        XCTAssertTrue(policy.shouldPausePlayback)

        policy.isPressingPlayableVideo = false
        policy.isOwnerSheetPresented = true
        XCTAssertTrue(policy.shouldPausePlayback)

        policy.isOwnerSheetPresented = false
        policy.sceneIsActive = false
        XCTAssertTrue(policy.shouldPausePlayback)

        policy.sceneIsActive = true
        XCTAssertFalse(policy.shouldPausePlayback)
    }

    func testStoryProgressPausesForImagePressAndDismissGestureHandoff() {
        XCTAssertTrue(
            StoryProgressPausePolicy.shouldPause(
                playbackIsPaused: false,
                isPressingMedia: true,
                isDismissTransitionActive: false,
                isWaitingForVideo: false
            )
        )
        XCTAssertTrue(
            StoryProgressPausePolicy.shouldPause(
                playbackIsPaused: false,
                isPressingMedia: false,
                isDismissTransitionActive: true,
                isWaitingForVideo: false
            )
        )
        XCTAssertFalse(
            StoryProgressPausePolicy.shouldPause(
                playbackIsPaused: false,
                isPressingMedia: false,
                isDismissTransitionActive: false,
                isWaitingForVideo: false
            )
        )
    }

    @MainActor
    func testPlayerPoolUsesLimitForAdjacentURLsInsteadOfActiveURL() {
        let first = URL(string: "https://example.com/first.m3u8")!
        let active = URL(string: "https://example.com/active.m3u8")!
        let third = URL(string: "https://example.com/third.m3u8")!
        let fourth = URL(string: "https://example.com/fourth.m3u8")!

        let prioritized = StoryVideoPlaybackPool.prioritizedURLs(
            urls: [first, active, third, fourth, active],
            activeURL: active,
            limit: 3
        )

        XCTAssertEqual(prioritized, [first, third, fourth])
    }

    @MainActor
    func testPlayerPoolReturnsNoURLsWhenPrefetchIsDisabled() {
        let url = URL(string: "https://example.com/video.m3u8")!

        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedURLs(urls: [url], activeURL: url, limit: 0),
            []
        )
    }

    @MainActor
    func testPlayerPoolOnlyPrerollsWhenPlayerAndItemAreReady() {
        XCTAssertTrue(
            StoryVideoPlaybackPool.canPreroll(
                playerStatus: .readyToPlay,
                itemStatus: .readyToPlay
            )
        )
        XCTAssertFalse(
            StoryVideoPlaybackPool.canPreroll(
                playerStatus: .unknown,
                itemStatus: .readyToPlay
            )
        )
        XCTAssertFalse(
            StoryVideoPlaybackPool.canPreroll(
                playerStatus: .readyToPlay,
                itemStatus: .unknown
            )
        )
    }

    @MainActor
    func testAspectFitPlayerViewPreservesMediaAndUsesBlackLetterboxing() {
        let view = AspectFitPlayerView(frame: CGRect(x: 0, y: 0, width: 360, height: 640))
        let firstPlayer = AVPlayer()
        let secondPlayer = AVPlayer()

        XCTAssertEqual(view.playerLayer.videoGravity, .resizeAspect)
        XCTAssertEqual(view.backgroundColor, .black)
        XCTAssertEqual(view.playerLayer.backgroundColor, UIColor.black.cgColor)
        XCTAssertTrue(view.isOpaque)

        view.attach(firstPlayer)
        XCTAssertTrue(view.player === firstPlayer)

        view.attach(secondPlayer)
        XCTAssertTrue(view.player === secondPlayer)

        view.attach(nil)
        XCTAssertNil(view.player)
        XCTAssertNil(view.playerLayer.player)
    }

    @MainActor
    func testPlayerPoolCoalescesRefreshedSignedURLsByCanonicalIdentity() {
        let first = URL(string: "https://customer.cloudflarestream.com/id/manifest/video.m3u8?token=first&quality=auto")!
        let refreshed = URL(string: "https://customer.cloudflarestream.com/id/manifest/video.m3u8?quality=auto&token=second&v=2")!

        XCTAssertEqual(
            StoryVideoPlaybackPool.canonicalURL(for: first),
            StoryVideoPlaybackPool.canonicalURL(for: refreshed)
        )
        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedURLs(
                urls: [first, refreshed],
                activeURL: nil,
                limit: 3
            ),
            [first]
        )
    }

    @MainActor
    func testStableAssetIdentitySurvivesCloudflareSignedPathRotation() {
        let storageKey = String(repeating: "a", count: 32)
        let firstURL = URL(
            string: "https://customer.cloudflarestream.com/header.payload.signature-one/manifest/video.m3u8"
        )!
        let refreshedURL = URL(
            string: "https://customer.cloudflarestream.com/header.payload.signature-two/manifest/video.m3u8"
        )!
        let first = makeStoryCard(
            id: "story-1",
            playbackURL: firstURL,
            storageKey: storageKey
        ).playbackSource
        let refreshed = makeStoryCard(
            id: "story-1",
            playbackURL: refreshedURL,
            storageKey: storageKey
        ).playbackSource

        XCTAssertNotEqual(first.url, refreshed.url)
        XCTAssertEqual(first.identity, "storage:\(storageKey)")
        XCTAssertTrue(refreshed.representsSameMedia(as: first))
        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedSources(
                sources: [first, refreshed],
                activeIdentity: nil,
                limit: 3
            ),
            [first]
        )
    }

    @MainActor
    func testDistinctStorageAssetsRemainDistinctPlaybackSources() {
        let first = makeStoryCard(
            id: "story-1",
            playbackURL: URL(string: "https://customer.cloudflarestream.com/first-token/manifest/video.m3u8")!,
            storageKey: String(repeating: "a", count: 32)
        ).playbackSource
        let second = makeStoryCard(
            id: "story-2",
            playbackURL: URL(string: "https://customer.cloudflarestream.com/second-token/manifest/video.m3u8")!,
            storageKey: String(repeating: "b", count: 32)
        ).playbackSource

        XCTAssertFalse(second.representsSameMedia(as: first))
        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedSources(
                sources: [first, second],
                activeIdentity: nil,
                limit: 3
            ),
            [first, second]
        )
    }

    func testPlaybackIdentityFallsBackToStoryIDWithoutRenditionMetadata() {
        let card = StoryCard(
            id: "story-without-rendition",
            creator: "Creator",
            handle: "creator",
            assetKind: .video,
            mediaUrl: URL(string: "https://example.com/video.mp4")!,
            thumbnailUrl: nil,
            placeholderUrl: nil,
            renditions: nil,
            title: "",
            processingStatus: "ready",
            textOverlays: nil,
            durationSeconds: 10,
            lastUploadedAt: nil,
            progressPercent: nil,
            timelineSegmentCount: nil
        )

        XCTAssertEqual(card.playbackIdentity, "story:story-without-rendition")
    }

    @MainActor
    func testPlayerPoolWaitsForAndHandsOffOwnedPreparation() async {
        let url = URL(string: "https://example.com/video.m3u8")!
        let expectedPlayer = AVPlayer()
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { requestedURL in
            XCTAssertEqual(requestedURL, url)
            try? await Task.sleep(for: .milliseconds(40))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: expectedPlayer,
                playbackURL: requestedURL,
                cacheState: "miss"
            )
        }

        pool.prepare(urls: [url], activeURL: nil)
        let prepared = await pool.takePreparedPlayer(
            for: url,
            waitUpTo: .milliseconds(250)
        )

        XCTAssertTrue(prepared?.player === expectedPlayer)
        XCTAssertEqual(prepared?.playbackURL, url)
    }

    @MainActor
    func testPlayerPoolDoesNotPruneAPlayerWhileItIsBeingAcquired() async {
        let requestedURL = URL(string: "https://example.com/requested.m3u8?token=one")!
        let unrelatedURL = URL(string: "https://example.com/unrelated.m3u8")!
        let expectedPlayer = AVPlayer()
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { url in
            try? await Task.sleep(for: .milliseconds(60))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: url == requestedURL ? expectedPlayer : AVPlayer(),
                playbackURL: url,
                cacheState: "miss"
            )
        }

        pool.prepare(urls: [requestedURL], activeURL: nil)
        let acquisition = Task { @MainActor in
            await pool.takePreparedPlayer(for: requestedURL, waitUpTo: .milliseconds(250))
        }
        await Task.yield()
        pool.prepare(urls: [unrelatedURL], activeURL: nil)

        let prepared = await acquisition.value
        XCTAssertTrue(prepared?.player === expectedPlayer)
    }

    @MainActor
    func testPlayerPoolTimesOutWithoutWaitingIndefinitely() async {
        let url = URL(string: "https://example.com/slow-video.m3u8")!
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { requestedURL in
            try? await Task.sleep(for: .seconds(1))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: AVPlayer(),
                playbackURL: requestedURL,
                cacheState: "miss"
            )
        }

        pool.prepare(urls: [url], activeURL: nil)
        let startedAt = Date()
        let prepared = await pool.takePreparedPlayer(
            for: url,
            waitUpTo: .milliseconds(30)
        )

        XCTAssertNil(prepared)
        XCTAssertLessThan(Date().timeIntervalSince(startedAt), 0.5)
    }

    @MainActor
    func testPlayerPoolCancelsTimedOutPreparationToPreventDuplicateStreaming() async {
        let url = URL(string: "https://example.com/continued-video.m3u8")!
        let expectedPlayer = AVPlayer()
        var buildCount = 0
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { requestedURL in
            buildCount += 1
            try? await Task.sleep(for: .milliseconds(70))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: expectedPlayer,
                playbackURL: requestedURL,
                cacheState: "miss",
                wasPrerolled: true
            )
        }

        pool.prepare(urls: [url], activeURL: nil)
        let timedOut = await pool.takePreparedPlayer(
            for: url,
            waitUpTo: .milliseconds(10)
        )
        XCTAssertNil(timedOut)

        try? await Task.sleep(for: .milliseconds(100))
        let prepared = await pool.takePreparedPlayer(
            for: url,
            waitUpTo: .milliseconds(10)
        )

        XCTAssertNil(prepared)
        XCTAssertEqual(buildCount, 1)

        pool.prepare(urls: [url], activeURL: nil)
        try? await Task.sleep(for: .milliseconds(100))
        let rebuilt = await pool.takePreparedPlayer(
            for: url,
            waitUpTo: .milliseconds(10)
        )
        XCTAssertTrue(rebuilt?.player === expectedPlayer)
        XCTAssertTrue(rebuilt?.wasPrerolled == true)
        XCTAssertEqual(buildCount, 2)
    }

    @MainActor
    func testPlayerPoolImmediatelyTransfersAStagedLoadingPlayer() async {
        let source = StoryVideoPlaybackSource(
            identity: "story:staged",
            url: URL(string: "https://example.com/staged-video.m3u8")!
        )
        let expectedPlayer = AVPlayer()
        let pool = StoryVideoPlaybackPool(
            maxPreparedPlayers: 1,
            stagedPlayerBuilder: { requestedSource, publishStaged in
                XCTAssertEqual(requestedSource, source)
                try? await Task.sleep(for: .milliseconds(15))
                let staged = StoryVideoPlaybackPool.PreparedPlayer(
                    player: expectedPlayer,
                    playbackURL: requestedSource.url,
                    cacheState: "miss",
                    handoffStage: .staged
                )
                publishStaged(staged)
                try? await Task.sleep(for: .seconds(1))
                return StoryVideoPlaybackPool.PreparedPlayer(
                    player: expectedPlayer,
                    playbackURL: requestedSource.url,
                    cacheState: "miss",
                    wasPrerolled: true
                )
            }
        )

        pool.prepare(sources: [source], activeIdentity: source.identity)
        let startedAt = Date()
        let prepared = await pool.takePreparedPlayer(
            for: source,
            waitUpTo: .milliseconds(100)
        )

        XCTAssertTrue(prepared?.player === expectedPlayer)
        XCTAssertEqual(prepared?.handoffStage, .staged)
        XCTAssertFalse(prepared?.wasPrerolled ?? true)
        XCTAssertLessThan(Date().timeIntervalSince(startedAt), 0.25)
    }

    @MainActor
    func testPlayerPoolPromotesActiveSourceWhenLaunchWarmMisses() async {
        let active = StoryVideoPlaybackSource(
            identity: "story:active",
            url: URL(string: "https://example.com/active.m3u8")!
        )
        let adjacent = StoryVideoPlaybackSource(
            identity: "story:adjacent",
            url: URL(string: "https://example.com/adjacent.m3u8")!
        )
        let expectedPlayer = AVPlayer()
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { sourceURL in
            try? await Task.sleep(for: .milliseconds(20))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: sourceURL == active.url ? expectedPlayer : AVPlayer(),
                playbackURL: sourceURL,
                cacheState: "miss"
            )
        }

        pool.prepare(
            sources: [active, adjacent],
            activeIdentity: active.identity
        )
        let prepared = await pool.takePreparedPlayer(
            for: active,
            waitUpTo: .milliseconds(100)
        )

        XCTAssertTrue(prepared?.player === expectedPlayer)
        XCTAssertEqual(prepared?.playbackURL, active.url)
    }

    @MainActor
    func testPlayerPoolDoesNotDuplicateAnAlreadyBufferedActiveSource() async {
        let active = StoryVideoPlaybackSource(
            identity: "story:active",
            url: URL(string: "https://example.com/active.m3u8")!
        )
        let next = StoryVideoPlaybackSource(
            identity: "story:next",
            url: URL(string: "https://example.com/next.m3u8")!
        )
        var requestedURLs: [URL] = []
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 2) { url in
            requestedURLs.append(url)
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: AVPlayer(),
                playbackURL: url,
                cacheState: "miss",
                wasPrerolled: true
            )
        }

        pool.prepare(
            sources: [active, next],
            activeIdentity: active.identity,
            promoteActiveIfNeeded: false
        )
        try? await Task.sleep(for: .milliseconds(50))

        XCTAssertFalse(requestedURLs.contains(active.url))
        XCTAssertTrue(requestedURLs.contains(next.url))
    }

    @MainActor
    func testVisibleStackWarmSelectsOneEarlyVideoPerStack() {
        let firstVideo = makeStoryStackItem(id: "video-1", assetKind: .video)
        let secondVideo = makeStoryStackItem(id: "video-2", assetKind: .video)
        let stacks = [
            makeStoryStack(
                id: "stack-1",
                items: [
                    makeStoryStackItem(id: "image-1", assetKind: .image),
                    firstVideo,
                ]
            ),
            makeStoryStack(
                id: "stack-2",
                items: [
                    makeStoryStackItem(
                        id: "processing-video",
                        assetKind: .video,
                        processingStatus: "processing"
                    ),
                    secondVideo,
                ]
            ),
            makeStoryStack(id: "stack-3", items: [firstVideo]),
        ]

        let sources = MediaEngine.initialVideoSources(in: stacks, limit: 4)

        XCTAssertEqual(sources.map(\.identity), ["story:video-1", "story:video-2"])
        XCTAssertEqual(sources.map(\.url), [firstVideo.mediaUrl, secondVideo.mediaUrl])
    }

    @MainActor
    func testVisibleStackWarmHonorsPlayerLimit() {
        let stacks = (0..<4).map { index in
            makeStoryStack(
                id: "stack-\(index)",
                items: [makeStoryStackItem(id: "video-\(index)", assetKind: .video)]
            )
        }

        XCTAssertEqual(
            MediaEngine.initialVideoSources(in: stacks, limit: 2).map(\.identity),
            ["story:video-0", "story:video-1"]
        )
        XCTAssertTrue(MediaEngine.initialVideoSources(in: stacks, limit: 0).isEmpty)
    }

    @MainActor
    func testSeekInvalidatesPreviouslyCompletedPreroll() {
        XCTAssertTrue(
            StoryVideoPlaybackPool.retainsPreroll(
                wasPrerolled: true,
                neededSeek: false
            )
        )
        XCTAssertFalse(
            StoryVideoPlaybackPool.retainsPreroll(
                wasPrerolled: true,
                neededSeek: true
            )
        )
        XCTAssertFalse(
            StoryVideoPlaybackPool.retainsPreroll(
                wasPrerolled: false,
                neededSeek: false
            )
        )
    }

    func testVideoStartupFastPathRequiresMatchingCompletedPreroll() {
        XCTAssertEqual(VideoStartupPolicy.freshForwardBufferDuration, 8)
        XCTAssertEqual(VideoStartupPolicy.firstFrameTimeout(isLimitedNetwork: false), 8)
        XCTAssertEqual(VideoStartupPolicy.firstFrameTimeout(isLimitedNetwork: true), 12)
        XCTAssertEqual(
            VideoStartupPolicy.readinessTimeoutAction(
                playerStatus: .unknown,
                itemStatus: .unknown
            ),
            .continueBufferedPlayback
        )
        XCTAssertEqual(
            VideoStartupPolicy.readinessTimeoutAction(
                playerStatus: .readyToPlay,
                itemStatus: .unknown
            ),
            .continueBufferedPlayback
        )
        XCTAssertEqual(
            VideoStartupPolicy.readinessTimeoutAction(
                playerStatus: .readyToPlay,
                itemStatus: .failed
            ),
            .fail
        )
        XCTAssertTrue(
            VideoStartupPolicy.canReuseCompletedPreroll(
                wasPrerolled: true,
                targetSeconds: 0,
                currentSeconds: 0.04
            )
        )
        XCTAssertFalse(
            VideoStartupPolicy.canReuseCompletedPreroll(
                wasPrerolled: false,
                targetSeconds: 0,
                currentSeconds: 0
            )
        )
        XCTAssertFalse(
            VideoStartupPolicy.canReuseCompletedPreroll(
                wasPrerolled: true,
                targetSeconds: 0,
                currentSeconds: 0.2
            )
        )
    }

    func testStoryVideoVisitPolicyRewindsOnlyWhenLeavingActiveStory() {
        XCTAssertTrue(
            StoryVideoVisitPolicy.shouldRewindForNextVisit(
                previousIsActive: true,
                nextIsActive: false
            )
        )
        XCTAssertFalse(
            StoryVideoVisitPolicy.shouldRewindForNextVisit(
                previousIsActive: false,
                nextIsActive: true
            )
        )
        XCTAssertFalse(
            StoryVideoVisitPolicy.shouldRewindForNextVisit(
                previousIsActive: true,
                nextIsActive: true
            )
        )
    }

    func testVideoStallRecoveryRequiresTimeAdvancementEvenWhenPlayerReportsPlaying() {
        XCTAssertFalse(
            VideoStallRecoveryPolicy.hasRecovered(
                timeControlStatus: .playing,
                playbackAdvanced: false
            )
        )
        XCTAssertTrue(
            VideoStallRecoveryPolicy.hasRecovered(
                timeControlStatus: .waitingToPlayAtSpecifiedRate,
                playbackAdvanced: true
            )
        )
        XCTAssertFalse(
            VideoStallRecoveryPolicy.hasRecovered(
                timeControlStatus: .waitingToPlayAtSpecifiedRate,
                playbackAdvanced: false
            )
        )
        XCTAssertFalse(
            VideoStallRecoveryPolicy.hasRecovered(
                timeControlStatus: .paused,
                playbackAdvanced: false
            )
        )
    }

    func testVideoPlaybackWatchdogRequiresSustainedVisiblePlaybackWithoutProgress() {
        XCTAssertTrue(
            VideoPlaybackWatchdogPolicy.madeProgress(
                previousSeconds: 4,
                currentSeconds: 4.05
            )
        )
        XCTAssertFalse(
            VideoPlaybackWatchdogPolicy.madeProgress(
                previousSeconds: 4,
                currentSeconds: 4.02
            )
        )
        XCTAssertFalse(
            VideoPlaybackWatchdogPolicy.shouldDeclareStall(
                isVisible: true,
                isPaused: false,
                didFinish: false,
                secondsWithoutProgress: 1.24
            )
        )
        XCTAssertTrue(
            VideoPlaybackWatchdogPolicy.shouldDeclareStall(
                isVisible: true,
                isPaused: false,
                didFinish: false,
                secondsWithoutProgress: 1.25
            )
        )
        XCTAssertFalse(
            VideoPlaybackWatchdogPolicy.shouldDeclareStall(
                isVisible: true,
                isPaused: true,
                didFinish: false,
                secondsWithoutProgress: 2
            )
        )
        XCTAssertFalse(
            VideoPlaybackWatchdogPolicy.shouldDeclareStall(
                isVisible: false,
                isPaused: false,
                didFinish: false,
                secondsWithoutProgress: 2
            )
        )
    }

    func testVideoRecoveryPolicyUsesBoundedRecoveryLadder() {
        XCTAssertEqual(
            VideoPlaybackRecoveryPolicy.action(
                itemIsReady: true,
                currentItemRecoveryCount: 0,
                playerRebuildCount: 0
            ),
            .recoverCurrentItem
        )
        XCTAssertEqual(
            VideoPlaybackRecoveryPolicy.action(
                itemIsReady: true,
                currentItemRecoveryCount: 1,
                playerRebuildCount: 0
            ),
            .rebuildPlayer
        )
        XCTAssertEqual(
            VideoPlaybackRecoveryPolicy.action(
                itemIsReady: false,
                currentItemRecoveryCount: 0,
                playerRebuildCount: 0
            ),
            .rebuildPlayer
        )
        XCTAssertEqual(
            VideoPlaybackRecoveryPolicy.action(
                itemIsReady: true,
                currentItemRecoveryCount: 1,
                playerRebuildCount: 1
            ),
            .fail
        )
    }

    func testOfflineHLSPolicyClampsUnsafeLimits() {
        let policy = HLSOfflineCache.Policy(
            maximumAssets: -4,
            maximumBytes: -1,
            expiration: -20
        )

        XCTAssertEqual(policy.maximumAssets, 0)
        XCTAssertEqual(policy.maximumBytes, 0)
        XCTAssertEqual(policy.expiration, 0)
        XCTAssertEqual(HLSOfflineCache.Policy().maximumAssets, 2)
        XCTAssertEqual(
            HLSOfflineCache.Policy().maximumBytes,
            128 * 1024 * 1024
        )
    }

    func testOfflineHLSOnlyAcceptsBoundedOnDemandCandidates() {
        let eligible = StoryVideoPlaybackSource(
            identity: "story:short",
            url: URL(string: "https://example.com/short.m3u8")!,
            durationSeconds: 12
        )
        let long = StoryVideoPlaybackSource(
            identity: "story:long",
            url: URL(string: "https://example.com/long.m3u8")!,
            durationSeconds: 90
        )
        let unknown = StoryVideoPlaybackSource(
            identity: "story:unknown",
            url: URL(string: "https://example.com/unknown.m3u8")!
        )
        let progressive = StoryVideoPlaybackSource(
            identity: "story:mp4",
            url: URL(string: "https://example.com/video.mp4")!,
            durationSeconds: 10
        )

        XCTAssertTrue(HLSOfflineCache.isEligibleForOfflineCache(eligible))
        XCTAssertFalse(HLSOfflineCache.isEligibleForOfflineCache(long))
        XCTAssertFalse(HLSOfflineCache.isEligibleForOfflineCache(unknown))
        XCTAssertFalse(HLSOfflineCache.isEligibleForOfflineCache(progressive))
    }

    func testOfflineHLSCacheOnlyReusesTheSameCanonicalRemoteMedia() {
        let original = URL(
            string: "https://cdn.example.com/story/master.m3u8?token=old&v=1"
        )!
        let refreshed = URL(
            string: "https://cdn.example.com/story/master.m3u8?token=new&v=2"
        )!
        let replacement = URL(
            string: "https://cdn.example.com/story-v2/master.m3u8?token=new"
        )!

        XCTAssertTrue(
            HLSOfflineCache.representsSameRemoteMedia(original, refreshed)
        )
        XCTAssertFalse(
            HLSOfflineCache.representsSameRemoteMedia(original, replacement)
        )
    }

    func testProcessingStoryUsesPrivateOriginalUntilAdaptivePlaybackIsReady() {
        let adaptiveURL = URL(string: "https://cdn.example.com/media/master.m3u8")!
        let originalURL = URL(string: "https://app.example.com/api/story-media/media-originals/user/upload/source.mp4?token=test")!
        let thumbnailURL = URL(string: "https://cdn.example.com/media/poster.jpg")!
        let item = StoryStackItem(
            id: "story-processing",
            assetKind: .video,
            mediaUrl: adaptiveURL,
            thumbnailUrl: thumbnailURL,
            placeholderUrl: thumbnailURL,
            renditions: StoryMediaRenditions(
                playback: StoryMediaRendition(
                    mediaUrl: adaptiveURL,
                    thumbnailUrl: thumbnailURL,
                    placeholderUrl: thumbnailURL,
                    storageProvider: "vercel-blob",
                    storageKey: "media/hls-v1/output/master.m3u8",
                    contentType: "application/vnd.apple.mpegurl",
                    byteSize: nil,
                    checksum: nil,
                    width: 540,
                    height: 960,
                    durationMs: 10_000,
                    processingStatus: "processing"
                ),
                original: StoryMediaRendition(
                    mediaUrl: originalURL,
                    thumbnailUrl: thumbnailURL,
                    placeholderUrl: thumbnailURL,
                    storageProvider: "vercel-blob",
                    storageKey: "media-originals/user/upload/source.mp4",
                    contentType: "video/mp4",
                    byteSize: 8_000_000,
                    checksum: "source-etag",
                    width: 1920,
                    height: 1080,
                    durationMs: 10_000,
                    processingStatus: "ready"
                )
            ),
            title: "",
            processingStatus: "processing",
            textOverlays: nil,
            postedAt: "2026-08-25T00:00:00.000Z",
            durationSeconds: 10,
            captionVerticalPercent: nil,
            stats: nil
        )

        XCTAssertFalse(item.isProcessingVideo)
        XCTAssertTrue(item.isPlayableVideo)
        XCTAssertEqual(item.playbackMediaUrl, originalURL)
        XCTAssertEqual(item.playbackVideoContentMode, .fit)
        XCTAssertTrue(item.playbackIdentity.contains("media-originals/user/upload/source.mp4"))
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

    private func makeStoryCard(
        id: String,
        playbackURL: URL,
        storageKey: String,
        textOverlays: [StoryTextOverlay]? = nil
    ) -> StoryCard {
        StoryCard(
            id: id,
            creator: "Creator",
            handle: "creator",
            assetKind: .video,
            mediaUrl: playbackURL,
            thumbnailUrl: nil,
            placeholderUrl: nil,
            renditions: StoryMediaRenditions(
                playback: StoryMediaRendition(
                    mediaUrl: playbackURL,
                    thumbnailUrl: nil,
                    placeholderUrl: nil,
                    storageProvider: "cloudflare-stream",
                    storageKey: storageKey,
                    contentType: "application/x-mpegURL",
                    byteSize: nil,
                    checksum: nil,
                    width: nil,
                    height: nil,
                    durationMs: 10_000,
                    processingStatus: "ready"
                ),
                original: nil
            ),
            title: "",
            processingStatus: "ready",
            textOverlays: textOverlays,
            durationSeconds: 10,
            lastUploadedAt: nil,
            progressPercent: nil,
            timelineSegmentCount: nil
        )
    }

    private func makeStoryStack(id: String, items: [StoryStackItem]) -> StoryStack {
        StoryStack(
            id: id,
            creatorId: "creator-\(id)",
            creator: "Creator",
            handle: "creator",
            avatarUrl: nil,
            items: items
        )
    }

    private func makeStoryStackItem(
        id: String,
        assetKind: SocialAssetKind,
        processingStatus: String = "ready",
        renditions: StoryMediaRenditions? = nil
    ) -> StoryStackItem {
        StoryStackItem(
            id: id,
            assetKind: assetKind,
            mediaUrl: URL(string: "https://example.com/\(id).\(assetKind == .video ? "m3u8" : "jpg")")!,
            thumbnailUrl: nil,
            placeholderUrl: nil,
            renditions: renditions,
            title: "",
            processingStatus: processingStatus,
            textOverlays: nil,
            postedAt: "2026-08-23T00:00:00.000Z",
            durationSeconds: assetKind == .video ? 10 : nil,
            captionVerticalPercent: nil,
            stats: nil
        )
    }

    private func makeCropTestImageData(width: Int, height: Int) -> Data {
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
            UIColor.systemRed.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: 100))
            context.fill(CGRect(x: 0, y: height - 100, width: width, height: 100))
        }
    }

    private func makeHorizontalEdgeMarkerImage(width: Int, height: Int) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height),
            format: format
        ).image { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
            UIColor.systemRed.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 24, height: height))
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: width - 24, y: 0, width: 24, height: height))
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
}

private actor PerformanceUploadRecorder {
    private var recordedBatches: [[MobilePerformanceEventUpload]] = []
    private var recordedAt: [Date] = []

    func record(_ events: [MobilePerformanceEventUpload]) {
        recordedBatches.append(events)
        recordedAt.append(Date())
    }

    func count() -> Int {
        recordedBatches.count
    }

    func batches() -> [[MobilePerformanceEventUpload]] {
        recordedBatches
    }

    func timestamps() -> [Date] {
        recordedAt
    }
}
