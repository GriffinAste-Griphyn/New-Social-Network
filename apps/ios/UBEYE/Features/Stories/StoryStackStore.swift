import AVKit
import CryptoKit
import SwiftUI
import UIKit

@MainActor
final class StoryStackStore: ObservableObject {
    @Published var stack: StoryStack?
    @Published var isLoading = false
    @Published var error: String?
    @Published var replyText = "" {
        didSet {
            persistActiveReplyDraft()
        }
    }
    @Published var replyConfirmation: String?
    @Published var reportConfirmation: String?
    @Published var isSendingReply = false
    @Published var isPerformingAction = false
    @Published var followedIds = Set<String>()
    @Published var locallyUnfollowedIds = Set<String>()
    @Published private(set) var reactedStoryIds = Set<String>()
    @Published private(set) var sendingReactionIds = Set<String>()
    @Published var storyReplies: [String: [StoryInteractionEvent]] = [:]
    @Published var repliesError: String?
    @Published var loadingRepliesStoryId: String?
    @Published private(set) var storyViewerPages: [String: StoryViewerPageState] = [:]
    @Published private(set) var viewerErrors: [String: String] = [:]
    @Published private(set) var loadingViewersStoryId: String?
    @Published private(set) var loadingMoreViewersStoryId: String?

    private var impressionStartedAt = Date()
    private var lastImpressionStoryId: String?
    private struct ImpressionReport: Equatable {
        let viewedMs: Int
        let completed: Bool
    }
    private var impressionReports: [String: ImpressionReport] = [:]
    private var activeReplyDraftStoryId: String?
    private var isRestoringReplyDraft = false
    private let replyDraftDefaults = UserDefaults.standard

    func load(
        storyId: String,
        api: APIClient,
        mediaEngine: MediaEngine,
        pendingUploads: PendingStoryUploadStore? = nil,
        account: MobileAccount? = nil
    ) async {
        if stack == nil, let cached = await api.cachedStoryStackForDisplay(storyId: storyId) {
            let displayStack = pendingUploads?.storyStackByMergingPendingUploads(into: cached.story, account: account) ?? cached.story
            applyLoadedStack(displayStack)
            mediaEngine.prepare(stack: displayStack, around: 0, activeIdentity: nil)
        } else if stack == nil,
                  storyId == "my-story",
                  let pendingStack = pendingUploads?.storyStackByMergingPendingUploads(into: nil, account: account) {
            applyLoadedStack(pendingStack)
            mediaEngine.prepare(stack: pendingStack, around: 0, activeIdentity: nil)
        }

        isLoading = stack == nil
        error = nil
        do {
            let response = try await api.storyStack(storyId: storyId, refresh: true)
            let displayStack = pendingUploads?.storyStackByMergingPendingUploads(into: response.story, account: account) ?? response.story
            applyLoadedStack(displayStack)
            mediaEngine.prepare(stack: displayStack, around: 0, activeIdentity: nil)
        } catch {
            if storyId == "my-story",
               let pendingStack = pendingUploads?.storyStackByMergingPendingUploads(into: stack, account: account) {
                applyLoadedStack(pendingStack)
                mediaEngine.prepare(stack: pendingStack, around: 0, activeIdentity: nil)
                self.error = nil
            } else {
                self.error = error.localizedDescription
            }
        }
        isLoading = false
    }

    private func applyLoadedStack(_ nextStack: StoryStack) {
        stack = nextStack
        impressionStartedAt = Date()
        lastImpressionStoryId = nextStack.items.first?.id
        if let firstStoryId = nextStack.items.first?.id {
            activateReplyDraft(for: firstStoryId)
        }
    }

    func applyPendingUploads(
        pendingUploads: PendingStoryUploadStore,
        account: MobileAccount?,
        mediaEngine: MediaEngine,
        around index: Int
    ) {
        guard stack != nil || !pendingUploads.visibleUploads.isEmpty else {
            return
        }
        guard let mergedStack = pendingUploads.storyStackByMergingPendingUploads(into: stack, account: account) else {
            return
        }

        let previousMediaIdentities = stack?.items.map(\.playbackIdentity) ?? []
        let nextMediaIdentities = mergedStack.items.map(\.playbackIdentity)
        stack = mergedStack
        if lastImpressionStoryId == nil {
            lastImpressionStoryId = mergedStack.items.first?.id
            impressionStartedAt = Date()
        }
        if StoryStackRefreshPolicy.mediaTopologyChanged(
            previousIdentities: previousMediaIdentities,
            nextIdentities: nextMediaIdentities
        ) {
            mediaEngine.prepare(stack: mergedStack, around: index, activeIdentity: nil)
        }
    }

    func loadFollows(api: APIClient) async {
        do {
            let response: FollowStateResponse = try await api.get("/api/mobile/follows")
            followedIds = Set(response.followedCreatorIds)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func markActiveItem(_ item: StoryStackItem) {
        activateReplyDraft(for: item.id)
        if lastImpressionStoryId != item.id {
            impressionStartedAt = Date()
            lastImpressionStoryId = item.id
        }
    }

    func recordImpression(item: StoryStackItem, completed: Bool, api: APIClient) async {
        guard !PendingStoryUploadStore.isPendingStoryId(item.id) else {
            return
        }

        let viewedMs = max(0, Int(Date().timeIntervalSince(impressionStartedAt) * 1000))
        let previous = impressionReports[item.id]
        if previous?.completed == true {
            return
        }
        if !completed {
            guard viewedMs >= 1_000 else {
                return
            }
            if let previous, viewedMs - previous.viewedMs < 5_000 {
                return
            }
        }

        let report = ImpressionReport(viewedMs: viewedMs, completed: completed)
        impressionReports[item.id] = report
        do {
            try await api.recordStoryImpression(
                storyId: item.id,
                viewedMs: viewedMs,
                completed: completed
            )
        } catch {
            if impressionReports[item.id] == report {
                impressionReports[item.id] = previous
            }
        }
    }

    func sendReply(item: StoryStackItem, api: APIClient) async {
        let trimmed = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        isSendingReply = true
        UBEYEFeedback.impact(.light)
        error = nil
        replyConfirmation = nil
        do {
            let _: StoryInteractionResponse = try await api.sendStoryReply(storyId: item.id, body: trimmed, reaction: nil)
            replyText = ""
            replyConfirmation = "Message sent"
            UBEYEFeedback.success()
        } catch {
            self.error = error.localizedDescription
            UBEYEFeedback.error()
        }
        isSendingReply = false
    }

    private func activateReplyDraft(for storyId: String) {
        guard activeReplyDraftStoryId != storyId else {
            return
        }

        activeReplyDraftStoryId = storyId
        isRestoringReplyDraft = true
        replyText = replyDraftDefaults.string(forKey: replyDraftKey(for: storyId)) ?? ""
        isRestoringReplyDraft = false
    }

    private func persistActiveReplyDraft() {
        guard !isRestoringReplyDraft, let activeReplyDraftStoryId else {
            return
        }

        let key = replyDraftKey(for: activeReplyDraftStoryId)
        let trimmed = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            replyDraftDefaults.removeObject(forKey: key)
        } else {
            replyDraftDefaults.set(replyText, forKey: key)
        }
    }

    private func replyDraftKey(for storyId: String) -> String {
        "ubeye.story-reply-draft.\(storyId)"
    }

    func clearReplyConfirmation() {
        replyConfirmation = nil
    }

    func clearReportConfirmation() {
        reportConfirmation = nil
    }

    func loadReplies(item: StoryStackItem, api: APIClient, force: Bool = false) async {
        if !force, storyReplies[item.id] != nil {
            return
        }

        loadingRepliesStoryId = item.id
        repliesError = nil
        defer {
            if loadingRepliesStoryId == item.id {
                loadingRepliesStoryId = nil
            }
        }

        do {
            let response: StoryInteractionInboxResponse = try await api.get("/api/mobile/stories/\(item.id)/interactions")
            storyReplies[item.id] = response.interactions
        } catch {
            repliesError = error.localizedDescription
        }
    }

    func loadViewers(item: StoryStackItem, api: APIClient, force: Bool = false) async {
        if !force, storyViewerPages[item.id] != nil {
            return
        }

        loadingViewersStoryId = item.id
        viewerErrors.removeValue(forKey: item.id)
        defer {
            if loadingViewersStoryId == item.id {
                loadingViewersStoryId = nil
            }
        }

        do {
            let response = try await api.storyViewers(storyId: item.id)
            storyViewerPages[item.id] = StoryViewerPageState(
                viewers: response.viewers,
                totalViewers: response.totalViewers,
                totalViews: response.totalViews,
                nextCursor: response.nextCursor
            )
        } catch {
            viewerErrors[item.id] = error.localizedDescription
        }
    }

    func loadMoreViewers(item: StoryStackItem, api: APIClient) async {
        guard loadingMoreViewersStoryId != item.id,
              let page = storyViewerPages[item.id],
              let cursor = page.nextCursor else {
            return
        }

        loadingMoreViewersStoryId = item.id
        viewerErrors.removeValue(forKey: item.id)
        defer {
            if loadingMoreViewersStoryId == item.id {
                loadingMoreViewersStoryId = nil
            }
        }

        do {
            let response = try await api.storyViewers(
                storyId: item.id,
                cursor: cursor
            )
            var updatedPage = storyViewerPages[item.id] ?? page
            let existingViewerIds = Set(updatedPage.viewers.map(\.id))
            updatedPage.viewers.append(
                contentsOf: response.viewers.filter { !existingViewerIds.contains($0.id) }
            )
            updatedPage.totalViewers = response.totalViewers
            updatedPage.totalViews = response.totalViews
            updatedPage.nextCursor = response.nextCursor
            storyViewerPages[item.id] = updatedPage
        } catch {
            viewerErrors[item.id] = error.localizedDescription
        }
    }

    func sendReaction(_ reaction: String, item: StoryStackItem, api: APIClient) async {
        guard !sendingReactionIds.contains(item.id) else {
            return
        }

        reactedStoryIds.insert(item.id)
        sendingReactionIds.insert(item.id)
        error = nil
        defer { sendingReactionIds.remove(item.id) }
        do {
            let _: StoryInteractionResponse = try await api.sendStoryReply(storyId: item.id, body: nil, reaction: reaction)
        } catch {
            if !NetworkQualityMonitor.shared.isConnected {
                PendingSocialActionQueue.shared.enqueue(
                    .reaction,
                    targetId: item.id,
                    value: reaction
                )
                return
            }
            reactedStoryIds.remove(item.id)
            self.error = error.localizedDescription
        }
    }

    func followCreator(api: APIClient) async {
        guard let creatorId = stack?.creatorId else {
            return
        }

        struct Body: Encodable {
            let creatorId: String
        }

        isPerformingAction = true
        error = nil
        defer { isPerformingAction = false }

        followedIds.insert(creatorId)
        locallyUnfollowedIds.remove(creatorId)
        UBEYEFeedback.selection()

        do {
            let _: BasicOkResponse = try await api.post("/api/mobile/follows", body: Body(creatorId: creatorId))
            NotificationCenter.default.post(name: .followingQueueDidChange, object: nil)
            UBEYEFeedback.success()
        } catch {
            if !NetworkQualityMonitor.shared.isConnected {
                PendingSocialActionQueue.shared.enqueue(.follow, targetId: creatorId)
                return
            }
            followedIds.remove(creatorId)
            self.error = error.localizedDescription
            UBEYEFeedback.error()
        }
    }

    func unfollowCreator(api: APIClient) async {
        guard let creatorId = stack?.creatorId else {
            return
        }

        struct Body: Encodable {
            let creatorId: String
        }

        isPerformingAction = true
        error = nil
        defer { isPerformingAction = false }

        followedIds.remove(creatorId)
        locallyUnfollowedIds.insert(creatorId)
        UBEYEFeedback.selection()

        do {
            let _: BasicOkResponse = try await api.delete("/api/mobile/follows", body: Body(creatorId: creatorId))
            NotificationCenter.default.post(name: .followingQueueDidChange, object: nil)
            UBEYEFeedback.success()
        } catch {
            if !NetworkQualityMonitor.shared.isConnected {
                PendingSocialActionQueue.shared.enqueue(.unfollow, targetId: creatorId)
                return
            }
            followedIds.insert(creatorId)
            locallyUnfollowedIds.remove(creatorId)
            self.error = error.localizedDescription
            UBEYEFeedback.error()
        }
    }

    func commitDelete(item: StoryStackItem, api: APIClient) async -> Bool {
        guard !PendingStoryUploadStore.isPendingStoryId(item.id) else {
            return false
        }

        isPerformingAction = true
        defer { isPerformingAction = false }
        do {
            let _: BasicOkResponse = try await api.delete("/api/mobile/stories/\(item.id)", body: EmptyPayload())
            api.invalidateStoryStacks(ids: [item.id, "my-story", stack?.id].compactMap { $0 })
            api.invalidateMobileFeedCache()
            NotificationCenter.default.post(name: .storyDidDelete, object: item.id)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func removeItemForUndo(_ itemID: String) {
        guard let stack else {
            return
        }

        self.stack = StoryStack(
            id: stack.id,
            creatorId: stack.creatorId,
            creator: stack.creator,
            handle: stack.handle,
            avatarUrl: stack.avatarUrl,
            items: stack.items.filter { $0.id != itemID }
        )
        storyReplies.removeValue(forKey: itemID)
        storyViewerPages.removeValue(forKey: itemID)
        viewerErrors.removeValue(forKey: itemID)
    }

    func restoreStackForUndo(_ restoredStack: StoryStack) {
        stack = restoredStack
    }

    func report(item: StoryStackItem, reason: StoryReportReason, details: String?, api: APIClient) async -> Bool {
        isPerformingAction = true
        defer { isPerformingAction = false }
        do {
            let _: SafetyReportResponse = try await api.submitReport(
                targetKind: "story",
                targetId: item.id,
                reason: reason.rawValue,
                details: details
            )
            api.invalidateStoryStacks(ids: [item.id, stack?.id].compactMap { $0 })
            api.invalidateMobileFeedCache()
            reportConfirmation = "Story reported"
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func blockCreator(api: APIClient) async -> Bool {
        guard let creatorId = stack?.creatorId else {
            return false
        }

        isPerformingAction = true
        defer { isPerformingAction = false }
        do {
            try await api.blockUser(userId: creatorId, reason: "Blocked from story viewer")
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

struct EmptyPayload: Encodable {}

