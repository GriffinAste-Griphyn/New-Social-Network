import Foundation

/// Photo transfers may overlap, while their publication stays in selection order.
/// Videos act as barriers so they never compete with another story's transfer.
@MainActor
final class StoryBatchTransferQueue {
    private var tail: Task<Void, Never>?
    private var videoBarrier: Task<Void, Never>?
    private let maxConcurrentPhotos: Int
    private var photoSlots: [Task<Void, Never>] = []
    private var preparationFinished = false
    private var deferredRegistrations: [() -> Void] = []

    init(maxConcurrentPhotos: Int = 1) {
        self.maxConcurrentPhotos = min(max(maxConcurrentPhotos, 1), 2)
    }

    func registerAfterPreparation(_ action: @escaping () -> Void) {
        if preparationFinished { action() }
        else { deferredRegistrations.append(action) }
    }

    func finishPreparation() {
        preparationFinished = true
        let registrations = deferredRegistrations
        deferredRegistrations.removeAll()
        registrations.forEach { $0() }
    }

    func enqueue(_ operation: @escaping @MainActor () async -> Void) {
        enqueue(assetKind: .video) { _ in await operation() }
    }

    func enqueue(assetKind: SocialAssetKind,
                 operation: @escaping @MainActor (@escaping () async throws -> Void) async -> Void) {
        let predecessor = tail
        if assetKind == .image {
            let barrier = videoBarrier
            let previousSlot = photoSlots.count >= maxConcurrentPhotos ? photoSlots.removeFirst() : nil
            tail = Task { @MainActor in
                await barrier?.value
                await previousSlot?.value
                await operation { await predecessor?.value; try Task.checkCancellation() }
                // Failures before the commit gate must also preserve the chain.
                await predecessor?.value
            }
            if let tail { photoSlots.append(tail) }
        } else {
            tail = Task { @MainActor in
                await predecessor?.value
                await operation { try Task.checkCancellation() }
            }
            videoBarrier = tail
        }
    }

    func finish() async { await tail?.value }
}
