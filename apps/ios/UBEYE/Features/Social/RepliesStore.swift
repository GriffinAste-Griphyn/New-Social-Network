import Foundation
import SwiftUI

@MainActor
final class RepliesStore: ObservableObject {
    @Published private(set) var inbox: StoryInteractionInboxResponse?
    @Published private(set) var receivedThreads: [ReplyThreadData] = []
    @Published private(set) var sentThreads: [ReplyThreadData] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published private(set) var deletingReplyIds: Set<String> = []
    private var loadGeneration = 0
    private var mutationRevision = 0
    private var pendingDeletedIds: Set<String> = []
    private let deleteRequest: ((String, APIClient) async throws -> Void)?

    init(deleteRequest: ((String, APIClient) async throws -> Void)? = nil) {
        self.deleteRequest = deleteRequest
    }

    func load(api: APIClient) async {
        loadGeneration += 1
        let generation = loadGeneration
        let revision = mutationRevision
        isLoading = true
        error = nil
        defer { if generation == loadGeneration { isLoading = false } }
        do {
            let response: StoryInteractionInboxResponse = try await api.get("/api/mobile/stories/inbox/interactions")
            guard generation == loadGeneration, revision == mutationRevision, !Task.isCancelled else { return }
            apply(response)
        } catch {
            guard generation == loadGeneration, !error.isCancellation else { return }
            self.error = error.localizedDescription
        }
    }

    func apply(_ response: StoryInteractionInboxResponse) {
        inbox = StoryInteractionInboxResponse(ok: response.ok,
            interactions: response.interactions.filter { !pendingDeletedIds.contains($0.id) },
            sentInteractions: response.sentInteractions.filter { !pendingDeletedIds.contains($0.id) })
        rebuildThreads()
    }

    func thread(id: String) -> ReplyThreadData? {
        receivedThreads.first { $0.id == id } ?? sentThreads.first { $0.id == id }
    }

    func deleteReply(id: String, api: APIClient) async {
        let actionScope = api.accountScope
        guard !deletingReplyIds.contains(id), let inbox else { return }
        let received = inbox.interactions.first { $0.id == id }
        let sent = inbox.sentInteractions.first { $0.id == id }
        mutationRevision += 1
        deletingReplyIds.insert(id)
        pendingDeletedIds.insert(id)
        error = nil
        apply(inbox)
        UBEYEFeedback.impact(.light)
        defer { deletingReplyIds.remove(id); mutationRevision += 1 }
        do {
            if let deleteRequest { try await deleteRequest(id, api) }
            else { try await api.deleteStoryInteraction(id: id) }
        } catch {
            guard api.accountScope == actionScope else { return }
            if !NetworkQualityMonitor.shared.isConnected {
                PendingSocialActionQueue.shared.enqueue(.deleteReply, targetId: id, accountScope: actionScope)
                return
            }
            pendingDeletedIds.remove(id)
            // Roll back only this item against the current inbox. Other deletions
            // and replies received during the request remain intact.
            if let current = self.inbox {
                var incoming = current.interactions
                var outgoing = current.sentInteractions
                if let received, !incoming.contains(where: { $0.id == id }) { incoming.append(received) }
                if let sent, !outgoing.contains(where: { $0.id == id }) { outgoing.append(sent) }
                apply(StoryInteractionInboxResponse(ok: current.ok, interactions: incoming, sentInteractions: outgoing))
            }
            if !error.isCancellation { self.error = error.localizedDescription; UBEYEFeedback.error() }
        }
    }

    private func rebuildThreads() {
        guard let inbox else { receivedThreads = []; sentThreads = []; return }
        receivedThreads = Self.group(inbox.interactions.map { event in
            (event.actor, ReplyThreadItem(received: event))
        }, prefix: "received")
        sentThreads = Self.group(inbox.sentInteractions.map { event in
            (StoryInteractionEvent.Actor(id: event.target.id, name: event.target.name, handle: event.target.handle, imageUrl: event.target.imageUrl), ReplyThreadItem(sent: event))
        }, prefix: "sent")
    }

    private static func group(_ entries: [(StoryInteractionEvent.Actor, ReplyThreadItem)], prefix: String) -> [ReplyThreadData] {
        let grouped = Dictionary(grouping: entries, by: { $0.0.id })
        return grouped.values.compactMap { entries in
            let items = entries.map { $0.1 }.sortedByCreatedAt()
            guard let latest = items.last, let person = entries.first?.0 else { return nil }
            let creator = FixtureCreator(id: person.id, name: person.name, handle: person.handle,
                imageUrl: person.imageUrl, initials: String(person.name.prefix(2)).uppercased(), isFollowing: true)
            let id = "\(prefix):\(person.id)"
            return ReplyThreadData(id: id, creator: creator,
                row: ExpoReplyRowData(id: id, creator: creator, timestamp: displayTimestamp(latest.createdAt), message: latest.message),
                items: items)
        }.sorted {
            let left = parseReplyDate($0.items.last?.createdAt ?? "") ?? .distantPast
            let right = parseReplyDate($1.items.last?.createdAt ?? "") ?? .distantPast
            return left == right ? $0.id < $1.id : left > right
        }
    }
}
