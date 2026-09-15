import Foundation

/// Counts server-confirmed completions independently of a growing durable queue.
/// Preparation, retries and removal never turn missing files into successes.
struct StoryUploadBatchProgress: Codable, Equatable {
    let id: String
    let totalCount: Int
    var createdAt: Date = Date()
    var preparationFinished = false
    private(set) var preparedUploadIds: Set<String> = []
    private(set) var completedUploadIds: Set<String> = []
    private(set) var removedUploadIds: Set<String> = []
    private var progressByUploadId: [String: Double] = [:]
    private(set) var progress: Double = 0

    init(id: String, totalCount: Int, createdAt: Date = Date()) {
        self.id = id
        self.totalCount = totalCount
        self.createdAt = createdAt
    }

    var completedCount: Int { completedUploadIds.count }
    var unavailableCount: Int {
        (preparationFinished ? max(totalCount - preparedUploadIds.count, 0) : 0)
            + removedUploadIds.count
    }

    mutating func register(_ uploadId: String, progress: Double) {
        preparedUploadIds.insert(uploadId)
        recordProgress(uploadId, progress: progress)
    }

    mutating func recordProgress(_ uploadId: String, progress value: Double) {
        guard preparedUploadIds.contains(uploadId), value.isFinite else { return }
        progressByUploadId[uploadId] = max(progressByUploadId[uploadId] ?? 0, min(max(value, 0), 1))
        updateProgress()
    }

    mutating func complete(_ uploadId: String) {
        guard preparedUploadIds.contains(uploadId), !removedUploadIds.contains(uploadId) else { return }
        completedUploadIds.insert(uploadId)
        progressByUploadId[uploadId] = 1
        updateProgress()
    }

    mutating func remove(_ uploadId: String) {
        guard preparedUploadIds.contains(uploadId), !completedUploadIds.contains(uploadId) else { return }
        removedUploadIds.insert(uploadId)
    }

    private mutating func updateProgress() {
        guard totalCount > 0 else { return }
        // High water marks prevent provider retries from rewinding batch progress.
        progress = max(progress, min(progressByUploadId.values.reduce(0, +) / Double(totalCount), 1))
    }
}

struct PendingStoryUploadManifest: Codable {
    let uploads: [PendingStoryUpload]
    let batches: [String: StoryUploadBatchProgress]
}
