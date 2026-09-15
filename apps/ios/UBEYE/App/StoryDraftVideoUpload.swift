import Foundation

/// Private bytes only. Story registration and moderation still happen after Post.
struct StoryDraftVideoUpload {
    let clientUploadId: String
    let video: PreparedStoryVideo
    let upload: VideoUploadResponse
    let blobUploadId: String?
    let checksum: String
    let fingerprint: StoryUploadFileFingerprint
    let originalFingerprint: StoryUploadFileFingerprint
}

/// The composer relinquishes ownership only after the submitted manifest is durable.
@MainActor
final class StoryDraftVideoOwnership {
    var isSubmitted = false
    var onProgress: ((Double) -> Void)?
}

@MainActor
struct StoryDraftVideoTransfer {
    let clientUploadId: String
    let account: String
    let origin: String
    let video: PreparedStoryVideo
    let fingerprint: StoryUploadFileFingerprint
    let originalFingerprint: StoryUploadFileFingerprint
    let ownership: StoryDraftVideoOwnership
    let task: Task<StoryDraftVideoUpload, Error>
}
