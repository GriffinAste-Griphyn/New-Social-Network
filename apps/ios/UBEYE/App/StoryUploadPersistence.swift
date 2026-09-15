import Foundation

/// All manifest writes share one queue so a delayed progress checkpoint can never
/// overwrite a newer completion/removal. Durable ownership transitions still wait
/// for their write before permitting a transfer or deleting the previous source.
final class StoryUploadManifestWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "ubeye.upload-manifest", qos: .utility)

    @discardableResult
    func write(_ manifest: PendingStoryUploadManifest, to url: URL, wait: Bool) -> Bool {
        let operation = {
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                let data = try JSONEncoder().encode(manifest)
                try data.write(to: url, options: .atomic)
                return true
            } catch {
                MediaPerformance.mark("pending_story_upload_persist_failed")
                return false
            }
        }
        if wait { return queue.sync(execute: operation) }
        queue.async { _ = operation() }
        return true // Queued checkpoint; not a durability acknowledgement.
    }
}


/// Serial actor ownership keeps receipt append/take atomic without filesystem work
/// on the main actor. A failed consume retains the receipt for a later attempt.
actor StoryUploadReceiptStore {
    func append(_ response: StoryUploadResponse, to url: URL) -> Bool {
        var receipts = read(url)
        receipts.removeAll { $0.response.storyId == response.storyId }
        receipts.append(RecoveredStoryUploadReceipt(response: response, completedAt: Date()))
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(Array(receipts.suffix(12))).write(to: url, options: .atomic)
            return true
        } catch { return false }
    }

    func take(from url: URL) -> [StoryUploadResponse] {
        let receipts = read(url)
        guard !receipts.isEmpty else { return [] }
        do {
            try FileManager.default.removeItem(at: url)
            return receipts.map(\.response)
        } catch { return [] }
    }

    private func read(_ url: URL) -> [RecoveredStoryUploadReceipt] {
        guard let data = try? Data(contentsOf: url),
              let receipts = try? JSONDecoder().decode([RecoveredStoryUploadReceipt].self, from: data) else { return [] }
        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        return receipts.filter { $0.completedAt >= cutoff }
    }
}
