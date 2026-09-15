import Foundation

/// A push is a hint to re-read authenticated status, never proof of publication.
@MainActor
final class StoryReadinessSignals {
    static let shared = StoryReadinessSignals()
    private var generations: [String: Int] = [:]
    private var waiters: [String: [UUID: AsyncStream<Void>.Continuation]] = [:]

    func generation(for storyId: String) -> Int { generations[storyId] ?? 0 }

    func signal(storyId: String) {
        // Bound hints even when no active uploader exists (another device may post).
        if generations.count >= 200, generations[storyId] == nil { generations.removeAll() }
        generations[storyId] = generation(for: storyId) + 1
        if let continuations = waiters[storyId] {
            for continuation in continuations.values { continuation.yield(()) }
        }
    }

    func wait(storyId: String, after generation: Int, milliseconds: Int) async {
        guard !Task.isCancelled, self.generation(for: storyId) == generation else { return }
        let id = UUID()
        let (stream, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        waiters[storyId, default: [:]][id] = continuation
        defer {
            continuation.finish()
            waiters[storyId]?[id] = nil
            if waiters[storyId]?.isEmpty == true { waiters[storyId] = nil }
        }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { for await _ in stream { return } }
            group.addTask { try? await Task.sleep(for: .milliseconds(max(milliseconds, 1))) }
            await group.next()
            group.cancelAll()
        }
    }
}
