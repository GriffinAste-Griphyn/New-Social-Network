import Foundation

/// Explicit retry/recovery may leave a terminal transfer phase. Late network
/// progress cannot move a completing, paused or failed upload back to uploading.
enum StoryUploadStateMachine {
    static func allows(from: PendingStoryUploadState, to: PendingStoryUploadState) -> Bool {
        if from == to { return true }
        switch to {
        case .queued, .recovering: return true
        case .paused, .failed: return true
        case .uploading: return from == .queued || from == .recovering
        case .completing: return from == .uploading || from == .recovering || from == .queued
        }
    }
}
