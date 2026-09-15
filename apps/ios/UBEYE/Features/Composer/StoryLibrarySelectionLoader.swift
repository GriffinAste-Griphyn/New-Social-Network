import Foundation
import SwiftUI

/// Imports stay ordered, but preview presentation never waits for the whole batch.
@MainActor
final class StoryLibrarySelectionLoader: ObservableObject {
    @Published private(set) var isLoading = false
    @Published private(set) var completedCount = 0
    @Published private(set) var totalCount = 0
    private var requestID = UUID()
    private var task: Task<Void, Never>?

    func load(
        count: Int,
        importItem: @escaping (Int) async throws -> PickedStoryMedia?,
        onMediaLoaded: @escaping ([PickedStoryMedia]) -> Void,
        onComplete: @escaping ([PickedStoryMedia], Int) -> Void
    ) {
        cancel()
        guard count > 0 else { return }
        let request = requestID
        totalCount = count
        isLoading = true
        task = Task { @MainActor [weak self] in
            var media: [PickedStoryMedia] = []
            var failures = 0
            for index in 0..<count {
                guard let self, self.requestID == request, !Task.isCancelled else { return }
                let imported = try? await importItem(index)
                guard self.requestID == request, !Task.isCancelled else {
                    // Photos may finish an import even after the requesting task is cancelled.
                    if case .video(let video) = imported { await StoryUploadFileIO.remove([video.url]) }
                    return
                }
                if let imported {
                    media.append(imported)
                    onMediaLoaded(media)
                } else {
                    failures += 1
                }
                self.completedCount = index + 1
            }
            guard let self, self.requestID == request, !Task.isCancelled else { return }
            self.isLoading = false
            self.task = nil
            onComplete(media, failures)
        }
    }

    @discardableResult
    func cancel() -> Task<Void, Never>? {
        let cancelledTask = task
        requestID = UUID()
        task?.cancel()
        task = nil
        isLoading = false
        completedCount = 0
        totalCount = 0
        return cancelledTask
    }

    deinit { task?.cancel() }
}
