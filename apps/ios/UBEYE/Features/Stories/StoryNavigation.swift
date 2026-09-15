import AVKit
import CryptoKit
import SwiftUI
import UIKit

struct StoryRoute: Identifiable, Hashable {
    let id: String
    var source: StoryRouteSource = .homeFollowing
    var openedAt = Date()
}

enum StoryRouteSource: Hashable {
    case homeFollowing
    case discover
    case followingFeed
    case replies
    case ownStory
}

enum StoryNavigationAction: Equatable {
    case stay
    case move(to: Int)
    case finish
}

enum StoryNavigationPolicy {
    static func action(
        currentIndex: Int,
        itemCount: Int,
        delta: Int
    ) -> StoryNavigationAction {
        guard itemCount > 0,
              (0..<itemCount).contains(currentIndex),
              delta != 0 else {
            return .stay
        }

        if delta > 0, currentIndex == itemCount - 1 {
            return .finish
        }

        let nextIndex = min(max(currentIndex + delta, 0), itemCount - 1)
        return nextIndex == currentIndex ? .stay : .move(to: nextIndex)
    }
}

enum StoryCompletionTrigger: Equatable {
    case automaticPlayback
    case explicitNavigation
}

enum StoryCompletionPolicy {
    static func shouldDefer(
        trigger: StoryCompletionTrigger,
        progressIsPaused: Bool
    ) -> Bool {
        trigger == .automaticPlayback && progressIsPaused
    }
}

enum StoryStackRefreshPolicy {
    static func resolvedIndex(
        activeItemID: String?,
        previousIndex: Int,
        itemIDs: [String]
    ) -> Int? {
        guard !itemIDs.isEmpty else {
            return nil
        }
        if let activeItemID,
           let preservedIndex = itemIDs.firstIndex(of: activeItemID) {
            return preservedIndex
        }
        return min(max(previousIndex, 0), itemIDs.count - 1)
    }

    static func mediaTopologyChanged(
        previousIdentities: [String],
        nextIdentities: [String]
    ) -> Bool {
        previousIdentities != nextIdentities
    }
}

enum StoryDismissGesturePolicy {
    enum Outcome: Equatable {
        case ignored
        case swipeUp
        case dismiss
        case cancel
    }

    static func distanceThreshold(viewportHeight: CGFloat) -> CGFloat {
        min(max(viewportHeight * 0.07, 44), 72)
    }

    static func shouldDismiss(
        translation: CGFloat,
        predictedTranslation: CGFloat,
        viewportHeight: CGFloat
    ) -> Bool {
        let distanceThreshold = distanceThreshold(viewportHeight: viewportHeight)
        let velocityThreshold = min(max(viewportHeight * 0.28, 180), 320)
        return translation >= 8 &&
            (translation >= distanceThreshold || predictedTranslation >= velocityThreshold)
    }

    static func outcome(
        axis: GestureAxisIntent,
        translation: CGFloat,
        predictedTranslation: CGFloat,
        viewportHeight: CGFloat
    ) -> Outcome {
        guard axis == .vertical else { return .ignored }
        if translation < 0 {
            return translation <= -58 ? .swipeUp : .cancel
        }
        return shouldDismiss(
            translation: translation,
            predictedTranslation: predictedTranslation,
            viewportHeight: viewportHeight
        ) ? .dismiss : .cancel
    }

    static func progress(translation: CGFloat, viewportHeight: CGFloat) -> CGFloat {
        min(max(translation / max(viewportHeight * 0.55, 1), 0), 1)
    }

    static func displayedOffset(translation: CGFloat, viewportHeight: CGFloat) -> CGFloat {
        max(translation, 0)
    }
}

enum StoryDeletionPolicy {
    static func replacementItemID(
        deleting itemID: String,
        from orderedItemIDs: [String]
    ) -> String? {
        guard let deletedIndex = orderedItemIDs.firstIndex(of: itemID) else {
            return nil
        }

        return orderedItemIDs[safe: deletedIndex + 1]
            ?? orderedItemIDs[safe: deletedIndex - 1]
    }
}

struct StoryMediaBufferPolicy {
    static func indices(
        activeIndex: Int,
        itemCount: Int,
        mode: UBEYEAdaptiveMode = .standard
    ) -> [Int] {
        UBEYEAdaptivePolicy.storyBufferIndices(
            activeIndex: activeIndex,
            itemCount: itemCount,
            mode: mode
        )
    }

    static func stableIndices(
        activeIndex: Int,
        itemCount: Int,
        mode: UBEYEAdaptiveMode = .standard
    ) -> [Int] {
        Set(
            indices(
                activeIndex: activeIndex,
                itemCount: itemCount,
                mode: mode
            )
        ).sorted()
    }
}

struct BufferedStoryMedia: Identifiable {
    let item: StoryStackItem
    let isActive: Bool

    var id: String { item.id }
}

struct StoryTransitionMeasurement {
    let destinationItemId: String
    let direction: String
    let sourceKind: SocialAssetKind
    let destinationKind: SocialAssetKind
    let startedAt: Date
}

final class StoryInteractionLatencyTracker {
    private var touchBeganAt: Date?

    func beginTouchIfNeeded(at date: Date = Date()) {
        if touchBeganAt == nil {
            touchBeganAt = date
        }
    }

    func consumeTouchStart(fallback: Date = Date()) -> Date {
        defer { touchBeganAt = nil }
        return touchBeganAt ?? fallback
    }

    func cancelTouch() {
        touchBeganAt = nil
    }
}

struct PendingStoryDeletion {
    let id = UUID()
    let item: StoryStackItem
    let originalStack: StoryStack
    let originalIndex: Int
}

struct StoryViewerPageState {
    var viewers: [StoryViewerProfile]
    var totalViewers: Int
    var totalViews: Int
    var nextCursor: String?
}

enum StoryOwnerSheet: Identifiable {
    case viewers(StoryStackItem)
    case replies(StoryStackItem)

    var id: String {
        switch self {
        case .viewers(let item):
            "viewers-\(item.id)"
        case .replies(let item):
            "replies-\(item.id)"
        }
    }
}

