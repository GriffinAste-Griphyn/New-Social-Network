import XCTest
@testable import UBEYE

final class UXPolishTests: XCTestCase {
    func testTabSelectionDistinguishesSwitchFromReselect() {
        XCTAssertEqual(
            AppTabSelectionPolicy.decision(current: .home, requested: .discover),
            .switchTo(.discover)
        )
        XCTAssertEqual(
            AppTabSelectionPolicy.decision(current: .replies, requested: .replies),
            .reselect(.replies)
        )
    }

    func testStoryDismissUsesDistanceThreshold() {
        XCTAssertTrue(
            StoryDismissGesturePolicy.shouldDismiss(
                translation: 120,
                predictedTranslation: 120,
                viewportHeight: 800
            )
        )
        XCTAssertFalse(
            StoryDismissGesturePolicy.shouldDismiss(
                translation: 60,
                predictedTranslation: 100,
                viewportHeight: 800
            )
        )
    }

    func testStoryDismissUsesFlickPrediction() {
        XCTAssertTrue(
            StoryDismissGesturePolicy.shouldDismiss(
                translation: 42,
                predictedTranslation: 260,
                viewportHeight: 800
            )
        )
    }

    func testGestureIntentWaitsForDominanceBeforeClaimingAxis() {
        XCTAssertEqual(
            GestureIntentPolicy.axis(translation: CGSize(width: 4, height: 5)),
            .undecided
        )
        XCTAssertEqual(
            GestureIntentPolicy.axis(translation: CGSize(width: 30, height: 8)),
            .horizontal
        )
        XCTAssertEqual(
            GestureIntentPolicy.axis(translation: CGSize(width: 8, height: 30)),
            .vertical
        )
        XCTAssertEqual(
            GestureIntentPolicy.axis(translation: CGSize(width: 20, height: 20)),
            .undecided
        )
    }

    func testStoryDismissProgressIsClampedAndRubberBandsPastViewport() {
        XCTAssertEqual(
            StoryDismissGesturePolicy.progress(translation: -30, viewportHeight: 800),
            0
        )
        XCTAssertEqual(
            StoryDismissGesturePolicy.progress(translation: 800, viewportHeight: 800),
            1
        )
        XCTAssertLessThan(
            StoryDismissGesturePolicy.displayedOffset(translation: 900, viewportHeight: 800),
            900
        )
    }

    func testAdaptivePolicyEscalatesForPowerThermalAndMemoryPressure() {
        XCTAssertEqual(
            UBEYEAdaptivePolicy.mode(
                lowPowerMode: false,
                thermalState: .nominal,
                recentMemoryPressure: false,
                limitedNetwork: false
            ),
            .standard
        )
        XCTAssertEqual(
            UBEYEAdaptivePolicy.mode(
                lowPowerMode: true,
                thermalState: .nominal,
                recentMemoryPressure: false,
                limitedNetwork: false
            ),
            .constrained
        )
        XCTAssertEqual(
            UBEYEAdaptivePolicy.mode(
                lowPowerMode: false,
                thermalState: .serious,
                recentMemoryPressure: false,
                limitedNetwork: false
            ),
            .critical
        )
        XCTAssertEqual(
            UBEYEAdaptivePolicy.mode(
                lowPowerMode: false,
                thermalState: .nominal,
                recentMemoryPressure: true,
                limitedNetwork: false
            ),
            .critical
        )
    }

    func testDirectionalPrefetchExpandsAheadAndReversesImmediately() {
        var tracker = DirectionalPrefetchTracker()
        let start = Date(timeIntervalSince1970: 100)
        let first = tracker.record(
            visibleIndex: 2,
            itemCount: 10,
            mode: .standard,
            now: start
        )
        XCTAssertEqual(first.direction, .forward)
        XCTAssertEqual(first.indices, [2, 3, 4, 5])

        let fastForward = tracker.record(
            visibleIndex: 4,
            itemCount: 10,
            mode: .standard,
            now: start.addingTimeInterval(0.2)
        )
        XCTAssertEqual(fastForward.indices, [4, 5, 6, 7, 8])
        XCTAssertGreaterThan(fastForward.velocityItemsPerSecond, 4)

        let reverse = tracker.record(
            visibleIndex: 3,
            itemCount: 10,
            mode: .constrained,
            now: start.addingTimeInterval(0.4)
        )
        XCTAssertEqual(reverse.direction, .backward)
        XCTAssertEqual(reverse.indices, [3, 2, 1])
    }

    @MainActor
    func testQueuedFollowAndUnfollowCoalesceToLatestIntent() {
        let now = Date()
        let follow = PendingSocialActionQueue.Action(
            id: "follow",
            kind: .follow,
            targetId: "creator-1",
            value: nil,
            createdAt: now
        )
        let unfollow = PendingSocialActionQueue.Action(
            id: "unfollow",
            kind: .unfollow,
            targetId: "creator-1",
            value: nil,
            createdAt: now.addingTimeInterval(1)
        )

        let actions = PendingSocialActionQueue.coalescing(
            unfollow,
            into: PendingSocialActionQueue.coalescing(follow, into: [])
        )

        XCTAssertEqual(actions, [unfollow])
    }

    @MainActor
    func testQueuedReactionDeduplicatesSameStoryAndValue() {
        let reaction = PendingSocialActionQueue.Action(
            id: "reaction",
            kind: .reaction,
            targetId: "story-1",
            value: "❤️",
            createdAt: Date()
        )

        let actions = PendingSocialActionQueue.coalescing(
            reaction,
            into: PendingSocialActionQueue.coalescing(reaction, into: [])
        )

        XCTAssertEqual(actions, [reaction])
    }

    func testQuotedReplyDraftRoundTripsThroughCodable() throws {
        let draft = QuotedStoryReply(
            id: "reply-1",
            actorName: "Ari",
            actorHandle: "ari",
            actorAvatarUrl: URL(string: "https://example.com/avatar.jpg"),
            message: "Keep this thought"
        )

        let encoded = try JSONEncoder().encode(draft)
        XCTAssertEqual(try JSONDecoder().decode(QuotedStoryReply.self, from: encoded), draft)
    }
}
