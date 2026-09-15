import XCTest
@testable import UBEYE

final class UXPolishTests: XCTestCase {
    func testPendingModerationCanRemainVisibleWhileStoryFinishes() {
        XCTAssertTrue(
            StoryUploadVisibilityPolicy.shouldPublishImmediately(
                moderationStatus: "pending"
            )
        )
        XCTAssertFalse(
            StoryUploadVisibilityPolicy.shouldPublishImmediately(
                moderationStatus: "flagged"
            )
        )
    }

    func testStoryOverlayTextCollapsesRepeatedWhitespace() {
        XCTAssertEqual(
            normalizedStoryOverlayText("  one\u{00a0} \t two\nthree  "),
            "one two three"
        )
        XCTAssertEqual(
            normalizedStoryOverlayText(
                "one  ",
                preservesTrailingSpace: true
            ),
            "one "
        )
    }

    @MainActor
    func testStoryComposerClearsStaleUploadStatusForNewPresentation() {
        let store = StoryComposerStore()
        store.uploadStatus = "Story posted"

        store.beginPresentation()

        XCTAssertNil(store.uploadStatus)
    }

    @MainActor
    func testStoryComposerPersistsTheMostRecentExactOverlayText() {
        let draftKey = "ubeye.story-composer-text-draft.v1"
        let defaults = UserDefaults.standard
        let previousDraft = defaults.data(forKey: draftKey)
        defer {
            if let previousDraft {
                defaults.set(previousDraft, forKey: draftKey)
            } else {
                defaults.removeObject(forKey: draftKey)
            }
        }
        defaults.removeObject(forKey: draftKey)

        let store = StoryComposerStore()
        store.textOverlay = "First sentence.  Second sentence."
        store.persistTextDraft()
        store.textOverlay = "First sentence. Second sentence."
        store.persistTextDraft()

        let restoredStore = StoryComposerStore()
        XCTAssertEqual(
            restoredStore.textOverlay,
            "First sentence. Second sentence."
        )
    }

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

    func testStoryUploadActivityUsesTruthfulRecoveryStates() {
        let recovering = StoryUploadActivityPolicy.presentation(
            state: .recovering,
            assetKind: .video,
            progress: 0.42,
            errorMessage: nil
        )
        XCTAssertEqual(recovering.title, "Resuming upload…")
        XCTAssertTrue(recovering.showsIndeterminateProgress)
        XCTAssertFalse(recovering.needsAttention)

        let paused = StoryUploadActivityPolicy.presentation(
            state: .paused,
            assetKind: .video,
            progress: 0.42,
            errorMessage: "Waiting for a connection"
        )
        XCTAssertEqual(paused.title, "Upload paused")
        XCTAssertEqual(paused.message, "Waiting for a connection")
        XCTAssertTrue(paused.needsAttention)
    }

    func testStoryUploadActivityClampsProgress() {
        let presentation = StoryUploadActivityPolicy.presentation(
            state: .uploading,
            assetKind: .image,
            progress: 1.7,
            errorMessage: nil
        )

        XCTAssertEqual(presentation.title, "Uploading · 100%")
        XCTAssertEqual(presentation.progress, 1)
    }

    func testStoryUploadRecoveryStatesRoundTripThroughPersistence() throws {
        for state in [PendingStoryUploadState.recovering, .paused] {
            let encoded = try JSONEncoder().encode(state)
            XCTAssertEqual(try JSONDecoder().decode(PendingStoryUploadState.self, from: encoded), state)
        }
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
                translation: 24,
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
        XCTAssertEqual(
            StoryDismissGesturePolicy.outcome(axis: .vertical, translation: 42,
                predictedTranslation: 260, viewportHeight: 800),
            .dismiss,
            "The end handler must not reject flicks shorter than 58 points"
        )
    }

    func testShortDeliberateDownwardSwipeDismissesAcrossPhoneSizes() {
        for height: CGFloat in [667, 800, 932] {
            XCTAssertEqual(
                StoryDismissGesturePolicy.outcome(axis: .vertical, translation: 72,
                    predictedTranslation: 72, viewportHeight: height), .dismiss
            )
        }
    }

    func testDismissIgnoresHorizontalMotionAndCancelsReversedOrAccidentalDrags() {
        XCTAssertEqual(StoryDismissGesturePolicy.outcome(axis: .undecided, translation: 4,
            predictedTranslation: 300, viewportHeight: 800), .ignored)
        XCTAssertEqual(StoryDismissGesturePolicy.outcome(axis: .horizontal, translation: 72,
            predictedTranslation: 300, viewportHeight: 800), .ignored)
        XCTAssertEqual(StoryDismissGesturePolicy.outcome(axis: .vertical, translation: 4,
            predictedTranslation: 300, viewportHeight: 800), .cancel)
        XCTAssertEqual(StoryDismissGesturePolicy.outcome(axis: .vertical, translation: -20,
            predictedTranslation: 300, viewportHeight: 800), .cancel)
        XCTAssertEqual(StoryDismissGesturePolicy.outcome(axis: .vertical, translation: -72,
            predictedTranslation: -300, viewportHeight: 800), .swipeUp)
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

    func testStoryDismissProgressIsClampedAndMovementFollowsFinger() {
        XCTAssertEqual(
            StoryDismissGesturePolicy.progress(translation: -30, viewportHeight: 800),
            0
        )
        XCTAssertEqual(
            StoryDismissGesturePolicy.progress(translation: 800, viewportHeight: 800),
            1
        )
        for translation: CGFloat in [-30, 0, 24, 72, 500, 900] {
            XCTAssertEqual(StoryDismissGesturePolicy.displayedOffset(
                translation: translation, viewportHeight: 800), max(translation, 0))
        }
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
