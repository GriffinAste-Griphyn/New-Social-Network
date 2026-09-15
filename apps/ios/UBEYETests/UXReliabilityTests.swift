import XCTest
@testable import UBEYE

@MainActor
final class UXReliabilityTests: XCTestCase {
    private func preferences() -> UserDefaults {
        let name = "ux-reliability-\(UUID())"
        addTeardownBlock { UserDefaults.standard.removePersistentDomain(forName: name) }
        return UserDefaults(suiteName: name)!
    }

    func testQueueDrainsNewActionsWithoutLosingOppositeIntent() async {
        let queue = PendingSocialActionQueue(preferences: preferences())
        queue.enqueue(.follow, targetId: "creator", accountScope: "a")
        var performed: [PendingSocialActionQueue.Kind] = []
        await queue.flush(scope: "a", currentScope: { "a" }, isConnected: { true }) { action in
            performed.append(action.kind)
            if action.kind == .follow {
                queue.enqueue(.unfollow, targetId: "creator", accountScope: "a")
                await Task.yield()
            }
        }
        XCTAssertEqual(performed, [.follow, .unfollow])
        XCTAssertTrue(queue.actions.isEmpty)
    }

    func testQueueRetainsOtherAccountsAndStopsOnAccountChange() async {
        let queue = PendingSocialActionQueue(preferences: preferences())
        queue.enqueue(.follow, targetId: "one", accountScope: "a")
        queue.enqueue(.follow, targetId: "two", accountScope: "a")
        queue.enqueue(.unfollow, targetId: "one", accountScope: "b")
        var current = "a"
        var count = 0
        await queue.flush(scope: "a", currentScope: { current }, isConnected: { true }) { _ in
            count += 1
            current = "b"
        }
        XCTAssertEqual(count, 1)
        XCTAssertEqual(queue.actions.count, 2)
        XCTAssertEqual(Set(queue.actions.compactMap(\.accountScope)), ["a", "b"])
    }

    func testQueuePersistsRateLimitsAndNewActionsAcrossRestart() async {
        let prefs = preferences()
        let queue = PendingSocialActionQueue(preferences: prefs)
        queue.enqueue(.follow, targetId: "one", accountScope: "a")
        await queue.flush(scope: "a", currentScope: { "a" }, isConnected: { true }) { _ in
            queue.enqueue(.reaction, targetId: "story", value: "❤️", accountScope: "a")
            throw APIClientError.server("Try later", 429)
        }
        let restored = PendingSocialActionQueue(preferences: prefs)
        XCTAssertEqual(restored.actions.count, 2)
    }

    func testQueueCannotReplayLegacyOrUnownedActions() async {
        let prefs = preferences()
        prefs.set(Data("[]".utf8), forKey: "ubeye.pending-social-actions.v1")
        let queue = PendingSocialActionQueue(preferences: prefs)
        queue.enqueue(.follow, targetId: "one", accountScope: nil)
        XCTAssertTrue(queue.actions.isEmpty)
        XCTAssertNotNil(prefs.object(forKey: "ubeye.pending-social-actions.v1"))
    }

    func testAccountScopeSurvivesTokenRotationAndSeparatesOrigins() {
        let api = APIClient()
        let origin = api.baseURLString
        defer { api.baseURLString = origin }
        api.accountIdentifier = "person@example.test"
        api.authToken = "token-one"
        let first = api.accountScope
        api.authToken = "token-two"
        XCTAssertEqual(api.accountScope, first)
        api.baseURLString = "https://other.example.test"
        XCTAssertNotEqual(api.accountScope, first)
        api.authToken = nil
        XCTAssertNil(api.accountScope)
    }

    func testComposerDraftIsolationAndImmediateFlush() {
        let prefs = preferences()
        let store = StoryComposerStore(preferences: prefs)
        store.configureDraft(accountScope: "a")
        store.textOverlay = "My exact  draft"
        store.textOverlayPositionX = 73
        store.persistTextDraft()
        store.configureDraft(accountScope: "b")
        XCTAssertEqual(store.textOverlay, "")
        store.textOverlay = "Second account"
        store.persistTextDraft()
        let restored = StoryComposerStore(preferences: prefs)
        restored.configureDraft(accountScope: "a")
        XCTAssertEqual(restored.textOverlay, "My exact  draft")
        XCTAssertEqual(restored.textOverlayPositionX, 73)
        restored.configureDraft(accountScope: "b")
        XCTAssertEqual(restored.textOverlay, "Second account")
    }

    func testDraftAutosaveCombinesRapidEditsAndCancelsOldAccountSave() async throws {
        let persistence = ComposerDraftPersistence(preferences: preferences())
        _ = persistence.activate(accountScope: "a")
        for x in 0..<100 { persistence.schedule(draft(text: "draft \(x)")) }
        XCTAssertEqual(persistence.writeCount, 0)
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertEqual(persistence.writeCount, 1)
        persistence.schedule(draft(text: "obsolete"))
        _ = persistence.activate(accountScope: "b")
        persistence.flush(draft(text: "b"))
        try await Task.sleep(for: .milliseconds(350))
        XCTAssertEqual(persistence.activate(accountScope: "a")?.textOverlay, "draft 99")
        XCTAssertEqual(persistence.activate(accountScope: "b")?.textOverlay, "b")
    }

    func testInactiveTabReleasesItsViewCallback() {
        weak var releasedController: TabRefreshController?
        do {
            let controller = TabRefreshController()
            releasedController = controller
            controller.setActive(false) { _ in controller.request() }
        }
        XCTAssertNil(releasedController)
    }

    func testHiddenTabCoalescesInvalidationsAndRefreshesWhenActivated() async throws {
        let controller = TabRefreshController(debounce: .milliseconds(5))
        var forced: [Bool] = []
        controller.setActive(false) { forced.append($0) }
        for _ in 0..<20 { controller.request() }
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertTrue(forced.isEmpty)
        controller.setActive(true) { forced.append($0) }
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(forced, [true])
        controller.setActive(false) { forced.append($0) }
        controller.request()
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(forced, [true])
    }

    func testRepliesGroupOncePerPersonAndKeepStableConversationIdentity() {
        let store = RepliesStore()
        store.apply(inbox([event("one", person: "a"), event("two", person: "a"), event("three", person: "b")]))
        XCTAssertEqual(store.receivedThreads.count, 2)
        XCTAssertEqual(store.thread(id: "received:a")?.items.map(\.id), ["one", "two"])
        store.apply(inbox([event("four", person: "a")]))
        XCTAssertEqual(store.receivedThreads.first?.id, "received:a")
    }

    func testFailedReplyDeletionRestoresOnlyThatItemAndPreservesNewReplies() async {
        let started = expectation(description: "delete started")
        let gate = UXTestGate()
        let store = RepliesStore(deleteRequest: { id, _ in
            if id == "a" {
                started.fulfill()
                await gate.wait()
                throw APIClientError.server("Could not delete", 500)
            }
        })
        let api = APIClient()
        api.authToken = "test"
        store.apply(inbox([event("a"), event("b")]))
        let failedDelete = Task { await store.deleteReply(id: "a", api: api) }
        await fulfillment(of: [started], timeout: 2)
        await store.deleteReply(id: "b", api: api)
        store.apply(inbox([event("a"), event("b"), event("new")]))
        gate.release()
        await failedDelete.value
        XCTAssertEqual(Set(store.inbox!.interactions.map(\.id)), ["a", "new"])
        XCTAssertEqual(Set(store.receivedThreads.flatMap(\.items).map(\.id)), ["a", "new"])
        XCTAssertNotNil(store.error)
    }

    private func inbox(_ events: [StoryInteractionEvent]) -> StoryInteractionInboxResponse {
        StoryInteractionInboxResponse(ok: true, interactions: events, sentInteractions: [])
    }

    private func event(_ id: String, person: String = "person") -> StoryInteractionEvent {
        StoryInteractionEvent(id: id, storyId: "story", creatorId: "owner",
            story: .init(assetKind: .image, mediaUrl: URL(string: "https://example.test/photo.jpg")!, thumbnailUrl: nil, placeholderUrl: nil),
            actor: .init(id: person, name: person, handle: person, imageUrl: nil), kind: "reply", body: id,
            reaction: nil, mediaUrl: nil, mediaThumbnailUrl: nil, mediaAssetKind: nil, createdAt: "2026-09-15T00:00:00Z")
    }

    private func draft(text: String) -> StoryComposerTextDraft {
        StoryComposerTextDraft(caption: "", brandTags: "", textOverlay: text, textOverlayPositionX: 50,
            textOverlayPositionY: 68, linkUrl: "", linkLabel: "", linkOverlayPositionX: 50,
            linkOverlayPositionY: 78, quotedReply: nil, quoteReplyPositionX: 50, quoteReplyPositionY: 58)
    }
}

@MainActor
private final class UXTestGate {
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async { await withCheckedContinuation { continuation = $0 } }
    func release() { continuation?.resume(); continuation = nil }
}
