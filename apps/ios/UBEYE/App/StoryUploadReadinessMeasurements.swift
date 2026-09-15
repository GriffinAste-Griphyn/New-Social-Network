import Foundation

/// Server-confirmed readiness timings. These do not claim playback on a second
/// device; that remains a separate real-device acceptance test.
@MainActor
final class StoryUploadReadinessMeasurements {
    static let shared = StoryUploadReadinessMeasurements()
    private struct Entry: Codable {
        let attempt: String
        let kind: SocialAssetKind
        let submittedAt: Date
        let acceptedAt: Date
        let bytes: Int64
    }
    private let defaults: UserDefaults
    private var entries: [String: Entry]
    private var completed: [String: Date]
    private let key = "story-upload-readiness-v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        completed = defaults.data(forKey: key + "-completed").flatMap { try? JSONDecoder().decode([String: Date].self, from: $0) } ?? [:]
        completed = completed.filter { Date().timeIntervalSince($0.value) < 24 * 3600 }
        entries = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode([String: Entry].self, from: $0) } ?? [:]
        entries = entries.filter { Date().timeIntervalSince($0.value.submittedAt) < 24 * 3600 }
    }

    func accept(storyId: String, attempt: String, kind: SocialAssetKind, submittedAt: Date, bytes: Int64, alreadyReady: Bool) {
        guard completed[storyId] == nil else { return }
        if entries[storyId] == nil {
            MediaPerformance.measure("media_delivery_accepted story=\(storyId) installation=\(StoryDeliveryMeasurements.installationID) attempt=\(attempt)", since: submittedAt)
            entries[storyId] = Entry(attempt: attempt, kind: kind, submittedAt: submittedAt, acceptedAt: Date(), bytes: bytes)
        }
        // Bound durable diagnostic state even if readiness polling is interrupted.
        if entries.count > 50 {
            let keep = Set(entries.sorted { $0.value.acceptedAt > $1.value.acceptedAt }.prefix(50).map(\.key))
            entries = entries.filter { keep.contains($0.key) }
        }
        persist()
        if alreadyReady { ready(storyId: storyId) }
    }

    func ready(storyId: String) {
        guard let entry = entries.removeValue(forKey: storyId) else { return }
        completed[storyId] = Date()
        if completed.count > 200 {
            let keep = Set(completed.sorted { $0.value > $1.value }.prefix(200).map(\.key))
            completed = completed.filter { keep.contains($0.key) }
        }
        MediaPerformance.measure("media_delivery_ready story=\(storyId) installation=\(StoryDeliveryMeasurements.installationID)", since: entry.acceptedAt)
        let kind = entry.kind == .image ? "image" : "video"
        MediaPerformance.measure("\(kind)_upload_phase attempt=\(entry.attempt) phase=accepted_to_ready bytes=\(entry.bytes)", since: entry.acceptedAt)
        MediaPerformance.measure("\(kind)_upload_phase attempt=\(entry.attempt) phase=tap_to_ready bytes=\(entry.bytes)", since: entry.submittedAt)
        persist()
        MediaPerformance.flushUploadEvents()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(entries) { defaults.set(data, forKey: key) }
        if let data = try? JSONEncoder().encode(completed) { defaults.set(data, forKey: key + "-completed") }
    }
}
