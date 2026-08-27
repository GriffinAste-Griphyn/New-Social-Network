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
