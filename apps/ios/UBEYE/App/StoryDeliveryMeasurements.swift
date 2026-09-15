import Foundation

/// Correlation uses a random installation ID, never a hardware identifier. Each
/// phase is bounded/deduplicated; only actual rendered media records first_frame.
@MainActor
final class StoryDeliveryMeasurements {
    static let shared = StoryDeliveryMeasurements()
    static let installationID: String = {
        let key = "media-delivery-installation-v1"
        if let saved = UserDefaults.standard.string(forKey: key) { return saved }
        let value = UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: key)
        return value
    }()
    private var observations: [String: Date] = [:]

    func observe(storyID: String, phase: String, openedAt: Date? = nil) {
        guard !PendingStoryUploadStore.isPendingStoryId(storyID), storyID != "my-story",
              ["feed_visible", "first_frame"].contains(phase) else { return }
        let key = storyID + ":" + phase, now = Date()
        guard observations[key].map({ now.timeIntervalSince($0) < 300 }) != true else { return }
        observations[key] = now
        if observations.count > 500 { observations = observations.filter { now.timeIntervalSince($0.value) < 300 } }
        if observations.count > 500 { observations.removeAll(); observations[key] = now }
        let event = "media_delivery_observed story=\(storyID) phase=\(phase) installation=\(Self.installationID)"
        if let openedAt { MediaPerformance.measure(event, since: openedAt) }
        else { MediaPerformance.mark(event) }
    }
}
