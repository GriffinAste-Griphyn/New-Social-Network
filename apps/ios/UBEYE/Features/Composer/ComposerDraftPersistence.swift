import Foundation

struct StoryComposerTextDraft: Codable, Equatable {
    let caption: String
    let brandTags: String
    let textOverlay: String
    let textOverlayPositionX: Double
    let textOverlayPositionY: Double
    let linkUrl: String
    let linkLabel: String
    let linkOverlayPositionX: Double
    let linkOverlayPositionY: Double
    let quotedReply: QuotedStoryReply?
    let quoteReplyPositionX: Double
    let quoteReplyPositionY: Double

    var isEmpty: Bool {
        caption.isEmpty &&
            brandTags.isEmpty &&
            textOverlay.isEmpty &&
            linkUrl.isEmpty &&
            linkLabel.isEmpty &&
            quotedReply == nil
    }
}

@MainActor
final class ComposerDraftPersistence {
    private let preferences: UserDefaults
    private(set) var accountScope: String?
    private var saveTask: Task<Void, Never>?
    private var lastSaved: StoryComposerTextDraft?
    private(set) var writeCount = 0

    init(preferences: UserDefaults = .standard) {
        self.preferences = preferences
        // An unowned legacy draft must never appear in another account.
        // Preserve the legacy draft bytes, but do not guess their owner.
    }

    func activate(accountScope: String?) -> StoryComposerTextDraft? {
        saveTask?.cancel()
        self.accountScope = accountScope
        lastSaved = key.flatMap { preferences.data(forKey: $0) }
            .flatMap { try? JSONDecoder().decode(StoryComposerTextDraft.self, from: $0) }
        return lastSaved
    }

    private var key: String? { accountScope.map { "ubeye.story-composer-text-draft.v2.\($0)" } }

    func schedule(_ draft: StoryComposerTextDraft) {
        saveTask?.cancel()
        guard key != nil, draft != lastSaved else { return }
        saveTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            guard !Task.isCancelled else { return }
            self?.flush(draft)
        }
    }

    func flush(_ draft: StoryComposerTextDraft) {
        saveTask?.cancel()
        saveTask = nil
        guard let key, draft != lastSaved else { return }
        if draft.isEmpty { preferences.removeObject(forKey: key) }
        else if let data = try? JSONEncoder().encode(draft) { preferences.set(data, forKey: key) }
        lastSaved = draft
        writeCount += 1
    }

    func clear() {
        saveTask?.cancel()
        saveTask = nil
        if let key { preferences.removeObject(forKey: key) }
        lastSaved = nil
    }
}
