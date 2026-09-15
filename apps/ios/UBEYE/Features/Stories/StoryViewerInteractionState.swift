import AVKit
import CryptoKit
import SwiftUI
import UIKit

struct StoryViewerPausePolicy {
    var sceneIsActive = true
    var isPressingPlayableVideo = false
    var isReplyFieldFocused = false
    var isOwnerSheetPresented = false
    var isSendingReply = false
    var hasReplyDraft = false

    var shouldPausePlayback: Bool {
        !sceneIsActive ||
            isPressingPlayableVideo ||
            isReplyFieldFocused ||
            isOwnerSheetPresented ||
            isSendingReply ||
            hasReplyDraft
    }

    static func isPressingPlayableVideo(
        assetKind: SocialAssetKind?,
        processingStatus: String?,
        isPressing: Bool
    ) -> Bool {
        guard isPressing, assetKind == .video else {
            return false
        }

        return processingStatus == nil || processingStatus == "ready"
    }
}

enum StoryProgressPausePolicy {
    static func shouldPause(
        playbackIsPaused: Bool,
        isPressingMedia: Bool,
        isDismissTransitionActive: Bool,
        isWaitingForVideo: Bool
    ) -> Bool {
        playbackIsPaused ||
            isPressingMedia ||
            isDismissTransitionActive ||
            isWaitingForVideo
    }
}


struct StoryViewerGestureState {
    var verticalDragOffset: CGFloat = 0
    var gestureAxis: GestureAxisIntent = .undecided
    var isDismissTransitionActive: Bool = false
    var didPlayDismissHaptic: Bool = false
}
