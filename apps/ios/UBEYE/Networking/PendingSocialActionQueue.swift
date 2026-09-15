import Foundation

extension Notification.Name {
    static let replyInboxDidChange = Notification.Name("ubeye.replyInboxDidChange")
}

@MainActor
final class PendingSocialActionQueue {
    static let shared = PendingSocialActionQueue()

    enum Kind: String, Codable {
        case follow
        case unfollow
        case reaction
        case deleteReply
    }

    struct Action: Codable, Identifiable, Equatable {
        let id: String
        let kind: Kind
        let targetId: String
        let value: String?
        let createdAt: Date
        var accountScope: String? = nil
    }

    private struct CreatorPayload: Encodable {
        let creatorId: String
    }

    private let defaultsKey = "ubeye.pending-social-actions.v2"
    private let preferences: UserDefaults
    private(set) var actions: [Action]
    private var isFlushing = false

    init(preferences: UserDefaults = .standard) {
        self.preferences = preferences
        // Legacy actions have no owner and cannot safely be replayed.
        // Keep the legacy bytes for recovery, without assigning them to an account.
        if let data = preferences.data(forKey: defaultsKey),
           let decoded = try? JSONDecoder().decode([Action].self, from: data) {
            actions = decoded.filter { $0.accountScope != nil }
        } else {
            actions = []
        }
    }

    func enqueue(_ kind: Kind, targetId: String, value: String? = nil, accountScope: String?) {
        guard let accountScope else { return }
        let action = Action(
            id: UUID().uuidString.lowercased(),
            kind: kind,
            targetId: targetId,
            value: value,
            createdAt: Date(),
            accountScope: accountScope
        )
        actions = Self.coalescing(action, into: actions)
        persist()
        MediaPerformance.mark("social_action_queued kind=\(kind.rawValue)")
    }

    static func coalescing(_ action: Action, into existing: [Action]) -> [Action] {
        if action.kind == .follow || action.kind == .unfollow {
            return existing.filter {
                !(($0.kind == .follow || $0.kind == .unfollow) && $0.targetId == action.targetId && $0.accountScope == action.accountScope)
            } + [action]
        }

        guard !existing.contains(where: {
            $0.accountScope == action.accountScope && $0.kind == action.kind && $0.targetId == action.targetId && $0.value == action.value
        }) else {
            return existing
        }

        return existing + [action]
    }

    func flush(api: APIClient) async {
        await flush(scope: api.accountScope, currentScope: { api.accountScope },
                    isConnected: { NetworkQualityMonitor.shared.isConnected }) { action in
            try await self.perform(action, api: api)
        }
    }

    // Track operation IDs only. Successful completion removes that exact operation, so
    // edits/new actions arriving during an await remain durable.
    func flush(scope: String?, currentScope: () -> String?,
               isConnected: () -> Bool, perform: (Action) async throws -> Void) async {
        guard let scope, !isFlushing, isConnected() else { return }
        isFlushing = true
        defer { isFlushing = false }
        var attempted = Set<String>()
        var changedFollows = false
        var changedReplies = false
        defer {
            if changedFollows { NotificationCenter.default.post(name: .followingQueueDidChange, object: nil) }
            if changedReplies { NotificationCenter.default.post(name: .replyInboxDidChange, object: nil) }
        }
        while currentScope() == scope, isConnected(), !Task.isCancelled,
              let action = actions.first(where: { $0.accountScope == scope && !attempted.contains($0.id) }) {
            attempted.insert(action.id)
            do {
                try await perform(action)
                actions.removeAll { $0.id == action.id }
                changedFollows = changedFollows || action.kind == .follow || action.kind == .unfollow
                changedReplies = changedReplies || action.kind == .deleteReply || action.kind == .reaction
            } catch {
                guard currentScope() == scope, !Task.isCancelled else { break }
                let status = (error as? APIClientError)?.statusCode
                // Auth, rate limits and transport failures are retryable. A reply
                // already removed on the server is an idempotent success.
                if let status, (400..<500).contains(status), ![401, 403, 408, 429].contains(status) {
                    actions.removeAll { $0.id == action.id }
                } else {
                    persist()
                    break
                }
            }
            persist()
        }
    }

    private func perform(_ action: Action, api: APIClient) async throws {
        switch action.kind {
        case .follow:
            let _: BasicOkResponse = try await api.post(
                "/api/mobile/follows",
                body: CreatorPayload(creatorId: action.targetId)
            )
        case .unfollow:
            let _: BasicOkResponse = try await api.delete(
                "/api/mobile/follows",
                body: CreatorPayload(creatorId: action.targetId)
            )
        case .reaction:
            let _: StoryInteractionResponse = try await api.sendStoryReply(
                storyId: action.targetId,
                body: nil,
                reaction: action.value ?? "❤️"
            )
        case .deleteReply:
            try await api.deleteStoryInteraction(id: action.targetId)
        }
    }

    private func persist() {
        if actions.isEmpty {
            preferences.removeObject(forKey: defaultsKey)
        } else if let data = try? JSONEncoder().encode(actions) {
            preferences.set(data, forKey: defaultsKey)
        }
    }
}
