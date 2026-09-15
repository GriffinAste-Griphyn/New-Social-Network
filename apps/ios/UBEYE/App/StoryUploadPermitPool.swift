import Foundation

/// FIFO permits; cancelled waiters do not consume capacity or stall later work.
@MainActor
final class StoryUploadPermitPool {
    static let videoPreparation = StoryUploadPermitPool(limit: 1)
    static let videoTransfer = StoryUploadPermitPool(limit: 1)
    private let limit: Int
    private var active = 0
    private var waiters: [(UUID, CheckedContinuation<Void, Error>)] = []

    init(limit: Int) { self.limit = max(limit, 1) }

    func acquire() async throws {
        try Task.checkCancellation()
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()) }
                else if active < limit { active += 1; continuation.resume() }
                else { waiters.append((id, continuation)) }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancel(id) }
        }
        if Task.isCancelled { release(); throw CancellationError() }
    }

    func release() {
        if !waiters.isEmpty { waiters.removeFirst().1.resume() }
        else { active = max(active - 1, 0) }
    }

    private func cancel(_ id: UUID) {
        guard let index = waiters.firstIndex(where: { $0.0 == id }) else { return }
        waiters.remove(at: index).1.resume(throwing: CancellationError())
    }
}
