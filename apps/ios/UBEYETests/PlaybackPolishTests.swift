import AVFoundation
import XCTest
import UIKit
@testable import UBEYE

final class PlaybackPolishTests: XCTestCase {
    func testReversalPrioritizesPreviousItemsWithoutLosingActive() {
        XCTAssertEqual(StoryWarmOrder.indices(active: 4, count: 8, mode: .standard, direction: -1), [4, 3, 2, 1, 5])
        XCTAssertEqual(StoryWarmOrder.indices(active: 4, count: 8, mode: .constrained, direction: -1), [4, 3])
        XCTAssertEqual(StoryWarmOrder.indices(active: 4, count: 8, mode: .critical, direction: -1), [4])
    }
    func testWarmOrderIsBoundedAcrossSustainedReversals() {
        for count in 0...40 {
            for index in -1...count {
                for direction in [-1, 1] {
                    for mode in [UBEYEAdaptiveMode.standard, .constrained, .critical] {
                        let order = StoryWarmOrder.indices(active: index, count: count, mode: mode, direction: direction)
                        XCTAssertEqual(order.count, Set(order).count)
                        XCTAssertTrue(order.allSatisfy { $0 >= 0 && $0 < count })
                        XCTAssertLessThanOrEqual(order.count, mode == .standard ? 5 : (mode == .constrained ? 2 : 1))
                        if index >= 0, index < count { XCTAssertEqual(order.first, index) }
                    }
                }
            }
        }
    }
    func testRepeatedStallsReserveBandwidthAndExpire() {
        var history = PlaybackRecoveryHistory()
        XCTAssertEqual(history.requiredReserve(at: 100), 0)
        history.recordStall(at: 100)
        XCTAssertTrue(history.isCoolingDown(at: 102.99))
        XCTAssertFalse(history.isCoolingDown(at: 103))
        XCTAssertEqual(history.requiredReserve(at: 103), 2)
        history.recordStall(at: 104)
        history.recordStall(at: 108)
        history.recordStall(at: 109)
        XCTAssertEqual(history.requiredReserve(at: 110), 4)
        XCTAssertEqual(history.requiredReserve(at: 170), 0)
        history.reset()
        XCTAssertEqual(history.requiredReserve(at: 110), 0)
    }
    func testRecoveredStreamNeedsCooldownAndContiguousReserve() {
        XCTAssertFalse(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: false, local: false, likelyToKeepUp: true, bufferedAhead: 10, throughput: 20_000_000, recoveryReserve: 3, coolingDown: true))
        XCTAssertFalse(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: false, local: false, likelyToKeepUp: true, bufferedAhead: 2, throughput: 20_000_000, recoveryReserve: 3))
        XCTAssertTrue(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: false, local: false, likelyToKeepUp: true, bufferedAhead: 3, throughput: 20_000_000, recoveryReserve: 3))
        XCTAssertTrue(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: false, local: true, likelyToKeepUp: false, bufferedAhead: 0, throughput: nil, recoveryReserve: 4, coolingDown: true))
        XCTAssertFalse(StoryPreheatPolicy.canResumePreparation(visible: false, stalled: false, local: true, likelyToKeepUp: true, bufferedAhead: 4, throughput: nil))
    }
    func testNearEndPlaybackCanRecoverWithoutAnImpossibleReserve() {
        XCTAssertTrue(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: false, local: false, likelyToKeepUp: true, bufferedAhead: 0.98, throughput: 20_000_000, recoveryReserve: 4, remainingSeconds: 1))
        XCTAssertFalse(StoryPreheatPolicy.canResumePreparation(visible: true, stalled: false, local: false, likelyToKeepUp: true, bufferedAhead: 1, throughput: 20_000_000, recoveryReserve: 4, remainingSeconds: .nan))
    }
    func testCadenceDistinguishes60And120Hz() {
        for hz in [60.0, 120.0] {
            var cadence = FramePacingAccumulator()
            for frame in 0...600 { _ = cadence.sample(timestamp: Double(frame) / hz, expected: 1 / hz) }
            XCTAssertEqual(cadence.frames, 600)
            XCTAssertEqual(cadence.hitches, 0)
            XCTAssertTrue(cadence.sample(timestamp: 600 / hz + 3 / hz, expected: 1 / hz))
            XCTAssertEqual(cadence.hitches, 1)
            XCTAssertEqual(cadence.hitchTime, 2 / hz, accuracy: 0.000001)
        }
    }
    func testLongActiveMainThreadFreezeIsReported() {
        var cadence = FramePacingAccumulator()
        _ = cadence.sample(timestamp: 100, expected: 1 / 60)
        XCTAssertTrue(cadence.sample(timestamp: 101.2, expected: 1 / 60))
        XCTAssertEqual(cadence.hitches, 1)
        XCTAssertEqual(cadence.maximumGap, 1.2, accuracy: 0.000001)
    }
    func testCadenceExcludesSuspensionAndRefreshChanges() {
        var cadence = FramePacingAccumulator()
        _ = cadence.sample(timestamp: 0, expected: 1 / 120)
        XCTAssertFalse(cadence.sample(timestamp: 1 / 60, expected: 1 / 60))
        cadence.interrupt()
        XCTAssertFalse(cadence.sample(timestamp: 5, expected: 1 / 60))
        cadence.interrupt()
        XCTAssertFalse(cadence.sample(timestamp: 20, expected: 1 / 60))
        XCTAssertFalse(cadence.sample(timestamp: .nan, expected: 1 / 60))
        XCTAssertFalse(cadence.sample(timestamp: 20 + 1 / 60, expected: 1 / 60))
        XCTAssertEqual(cadence.frames, 1)
        XCTAssertEqual(cadence.hitches, 0)
    }
    @MainActor
    func testVisibleCommitRetainsStagedDestinationWithoutStartingDuplicatePreparation() async throws {
        let destination = StoryVideoPlaybackSource.urlBacked(URL(string: "https://media.example/destination.m3u8")!)
        let next = StoryVideoPlaybackSource.urlBacked(URL(string: "https://media.example/next.m3u8")!)
        let player = AVPlayer(playerItem: AVPlayerItem(asset: AVMutableComposition()))
        var builds = 0
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1, stagedPlayerBuilder: { source, publish in
            builds += 1
            let prepared = StoryVideoPlaybackPool.PreparedPlayer(player: player, playbackURL: source.url, cacheState: "fixture")
            publish(prepared)
            try? await Task.sleep(for: .seconds(2))
            return prepared
        })
        pool.prepare(sources: [destination], activeIdentity: nil)
        try await Task.sleep(for: .milliseconds(30))
        // The budget observer can run after visibility changes but before checkout.
        pool.prepare(sources: [destination, next], activeIdentity: destination.identity, promoteActiveIfNeeded: false, suspendNewWork: true)
        XCTAssertNotNil(player.currentItem, "Navigation destroyed the destination's staged player")
        let handedOff = await pool.takePreparedPlayer(for: destination, waitUpTo: .milliseconds(10))
        XCTAssertTrue(handedOff?.player === player)
        XCTAssertEqual(builds, 1)
        pool.removeAll()
        player.replaceCurrentItem(with: nil)
    }

    @MainActor
    func testRapidReturnRewindsRetainedVideoBeforeReportingReady() async throws {
        let fixture = MediaRegressionFixtures.directory.appendingPathComponent("audit-motion.mp4")
        guard FileManager.default.fileExists(atPath: fixture.path) else { throw XCTSkip("Generate the synthetic motion fixture") }
        let controller = AutoPlayVideoPlaybackController()
        var readyCount = 0
        controller.play(source: .urlBacked(fixture), expectedDuration: 4, playerPool: nil, refreshSource: { nil }, isPaused: true, onReadyForPlayback: { readyCount += 1 }, onProgress: { _ in }, onFinished: {})
        defer { controller.stop(reason: "test_cleanup") }
        for _ in 0..<200 where controller.player == nil { try await Task.sleep(for: .milliseconds(10)) }
        let player = try XCTUnwrap(controller.player)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        window.rootViewController = UIViewController()
        let surface = try XCTUnwrap(controller.displaySurface)
        surface.frame = window.bounds
        window.rootViewController?.view.addSubview(surface)
        window.isHidden = false
        defer { window.isHidden = true; surface.removeFromSuperview() }
        controller.playerDidAttach(player)
        for _ in 0..<300 where !controller.isReadyForPlayback {
            if surface.playerLayer.isReadyForDisplay { controller.revealVideo(player: player, reason: "fixture_layer") }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(controller.isReadyForPlayback)
        controller.setPaused(false)
        for _ in 0..<300 where player.currentTime().seconds < 0.9 { try await Task.sleep(for: .milliseconds(10)) }
        controller.setPaused(true)
        XCTAssertGreaterThan(player.currentTime().seconds, 0.9)
        controller.setVisible(false)
        let beforeReturn = readyCount
        // Return immediately, before the 180 ms deferred rewind could run.
        controller.setVisible(true)
        XCTAssertEqual(readyCount, beforeReturn, "The previous position must not be reported as the new first frame")
        controller.setPaused(true)
        for _ in 0..<300 where !controller.isReadyForPlayback {
            if surface.playerLayer.isReadyForDisplay { controller.revealVideo(player: player, reason: "fixture_reentry_layer") }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(controller.isReadyForPlayback)
        XCTAssertTrue(controller.player === player)
        XCTAssertEqual(player.currentTime().seconds, 0, accuracy: 0.05)
        XCTAssertGreaterThan(readyCount, beforeReturn)
    }

    @MainActor
    func testSustainedPoolReversalsReleaseDiscardedPlayersAndKeepActiveHandoff() async throws {
        var players: [AVPlayer] = []
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 2) { url in
            let player = AVPlayer(playerItem: AVPlayerItem(asset: AVMutableComposition()))
            players.append(player)
            return .init(player: player, playbackURL: url, cacheState: "stress")
        }
        for turn in 0..<100 {
            let direction = turn.isMultiple(of: 2) ? 1 : -1
            let indices = StoryWarmOrder.indices(active: turn % 8, count: 8, mode: .standard, direction: direction)
            let urls = indices.map { URL(string: "https://media.example/stress-\($0).m3u8")! }
            pool.prepare(urls: urls, activeURL: nil)
            for _ in 0..<8 { await Task.yield() }
            let handedOff = await pool.takePreparedPlayer(for: urls[0], waitUpTo: .milliseconds(100))
            XCTAssertNotNil(handedOff)
            pool.suspendSpeculativePreparations(activeIdentity: nil)
            pool.removeAll()
            XCTAssertNotNil(handedOff?.player.currentItem)
            handedOff?.player.replaceCurrentItem(with: nil)
            XCTAssertTrue(players.allSatisfy { $0.currentItem == nil }, "Turn \(turn) leaked a retained player item")
        }
    }
}
