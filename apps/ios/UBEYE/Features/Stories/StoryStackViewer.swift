import AVKit
import SwiftUI

struct StoryRoute: Identifiable, Hashable {
    let id: String
    var source: StoryRouteSource = .homeFollowing
    var openedAt = Date()
}

enum StoryRouteSource: Hashable {
    case homeFollowing
    case discover
    case followingFeed
    case replies
    case ownStory
}

@MainActor
final class StoryStackStore: ObservableObject {
    @Published var stack: StoryStack?
    @Published var isLoading = false
    @Published var error: String?
    @Published var replyText = ""
    @Published var replyConfirmation: String?
    @Published var reportConfirmation: String?
    @Published var isSendingReply = false
    @Published var isPerformingAction = false
    @Published var followedIds = Set<String>()
    @Published var locallyUnfollowedIds = Set<String>()
    @Published var storyReplies: [String: [StoryInteractionEvent]] = [:]
    @Published var repliesError: String?
    @Published var loadingRepliesStoryId: String?

    private var impressionStartedAt = Date()
    private var lastImpressionStoryId: String?

    func load(
        storyId: String,
        api: APIClient,
        pendingUploads: PendingStoryUploadStore? = nil,
        account: MobileAccount? = nil
    ) async {
        if stack == nil, let cached = await api.cachedStoryStackForDisplay(storyId: storyId) {
            let displayStack = pendingUploads?.storyStackByMergingPendingUploads(into: cached.story, account: account) ?? cached.story
            applyLoadedStack(displayStack)
        } else if stack == nil,
                  storyId == "my-story",
                  let pendingStack = pendingUploads?.storyStackByMergingPendingUploads(into: nil, account: account) {
            applyLoadedStack(pendingStack)
        }

        isLoading = stack == nil
        error = nil
        do {
            let response = try await api.storyStack(storyId: storyId, refresh: true)
            let displayStack = pendingUploads?.storyStackByMergingPendingUploads(into: response.story, account: account) ?? response.story
            MediaPreheater.preheat(stack: displayStack)
            applyLoadedStack(displayStack)
        } catch {
            if storyId == "my-story",
               let pendingStack = pendingUploads?.storyStackByMergingPendingUploads(into: stack, account: account) {
                MediaPreheater.preheat(stack: pendingStack)
                applyLoadedStack(pendingStack)
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
    }

    func applyPendingUploads(
        pendingUploads: PendingStoryUploadStore,
        account: MobileAccount?
    ) -> StoryStack? {
        guard stack != nil || !pendingUploads.visibleUploads.isEmpty else {
            return nil
        }
        guard let mergedStack = pendingUploads.storyStackByMergingPendingUploads(into: stack, account: account) else {
            return nil
        }

        stack = mergedStack
        if lastImpressionStoryId == nil {
            lastImpressionStoryId = mergedStack.items.first?.id
            impressionStartedAt = Date()
        }
        MediaPreheater.preheat(stack: mergedStack)
        return mergedStack
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
        try? await api.recordStoryImpression(storyId: item.id, viewedMs: viewedMs, completed: completed)
    }

    func sendReply(item: StoryStackItem, api: APIClient) async {
        let trimmed = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        isSendingReply = true
        error = nil
        replyConfirmation = nil
        do {
            let _: StoryInteractionResponse = try await api.sendStoryReply(storyId: item.id, body: trimmed, reaction: nil)
            replyText = ""
            replyConfirmation = "Message sent"
        } catch {
            self.error = error.localizedDescription
        }
        isSendingReply = false
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

    func sendReaction(_ reaction: String, item: StoryStackItem, api: APIClient) async {
        isSendingReply = true
        error = nil
        do {
            let _: StoryInteractionResponse = try await api.sendStoryReply(storyId: item.id, body: nil, reaction: reaction)
        } catch {
            self.error = error.localizedDescription
        }
        isSendingReply = false
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

        do {
            let _: BasicOkResponse = try await api.post("/api/mobile/follows", body: Body(creatorId: creatorId))
            followedIds.insert(creatorId)
            locallyUnfollowedIds.remove(creatorId)
            NotificationCenter.default.post(name: .followingQueueDidChange, object: nil)
        } catch {
            self.error = error.localizedDescription
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

        do {
            let _: BasicOkResponse = try await api.delete("/api/mobile/follows", body: Body(creatorId: creatorId))
            followedIds.remove(creatorId)
            locallyUnfollowedIds.insert(creatorId)
            NotificationCenter.default.post(name: .followingQueueDidChange, object: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func delete(item: StoryStackItem, api: APIClient) async -> Bool {
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

private struct EmptyPayload: Encodable {}

struct StoryStackViewer: View {
    let route: StoryRoute
    var openingThumbnailUrl: URL?
    var onDismiss: (() -> Void)?
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var pendingStoryUploads: PendingStoryUploadStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = StoryStackStore()
    @State private var index = 0
    @State private var storyStartedAt = Date()
    @State private var storyProgress = 0.0
    @State private var timedStoryId: String?
    @State private var videoReadyItemId: String?
    @State private var didFinishCurrentItem = false
    @State private var deleteConfirmationItem: StoryStackItem?
    @State private var isDeleteConfirmationPresented = false
    @State private var reportingItem: StoryStackItem?
    @State private var repliesSheetItem: StoryStackItem?
    @State private var confirmationDismissTask: Task<Void, Never>?
    @State private var reportConfirmationDismissTask: Task<Void, Never>?
    @StateObject private var videoPlaybackPool = StoryVideoPlaybackPool()
    @FocusState private var isReplyFieldFocused: Bool

    private let defaultStoryDurationSeconds: TimeInterval = 10
    private let maxVideoStoryDurationSeconds: TimeInterval = 120
    private let storyTimer = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()
    private let storyAvatarSize: CGFloat = 42
    private let storyActionSize: CGFloat = 42
    private let ownerStatsHeight: CGFloat = 64
    private let replyComposerHeight: CGFloat = 46
    private let bottomChromeInset: CGFloat = 16
    private let captionBottomGap: CGFloat = 14
    private let storyTopChromeMinimumInset: CGFloat = 64
    private let storyTopChromeSafeAreaGap: CGFloat = 8
    private let verticalSwipeMinimumDistance: CGFloat = 58
    private let verticalSwipeDominanceRatio: CGFloat = 1.15

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black.ignoresSafeArea()

                if store.isLoading && store.stack == nil {
                    ProgressView()
                        .tint(.white)
                } else if let error = store.error, store.stack == nil {
                    EmptyStateView(title: "Story unavailable", message: error, systemImage: "exclamationmark.triangle")
                        .padding()
                } else if let stack = store.stack, let item = stack.items[safe: index] {
                    media(item)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .clipped()
                        .ignoresSafeArea()
                        .onAppear {
                            store.markActiveItem(item)
                            startStoryTimerIfNeeded(for: item)
                        }
                        .onDisappear {
                            Task { await store.recordImpression(item: item, completed: false, api: api) }
                        }

                    tapNavigationOverlay(item: item)
                        .frame(width: proxy.size.width, height: proxy.size.height)

                    storyChrome(stack: stack, item: item, safeAreaTop: proxy.safeAreaInsets.top)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .allowsHitTesting(true)
                        .zIndex(1)

                    if let repliesSheetItem {
                        Color.black.opacity(0.001)
                            .ignoresSafeArea()
                            .onTapGesture {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
                                    self.repliesSheetItem = nil
                                }
                            }

                        storyRepliesSheet(repliesSheetItem, maxHeight: proxy.size.height)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
            }
        }
        .simultaneousGesture(verticalStorySwipeGesture)
        .task {
            await store.load(
                storyId: route.id,
                api: api,
                pendingUploads: route.id == "my-story" ? pendingStoryUploads : nil,
                account: auth.account
            )
            MediaPerformance.measure("story_open id=\(route.id)", since: route.openedAt)
            if route.source != .ownStory {
                await store.loadFollows(api: api)
            }
            if let item = store.stack?.items[safe: index] {
                startStoryTimerIfNeeded(for: item)
                MediaPerformance.mark("story_viewer_bound id=\(route.id) item=\(item.id)")
            }
            if let stack = store.stack {
                MediaPreheater.preheat(stack: stack, around: index)
                videoPlaybackPool.prepare(
                    urls: adjacentVideoUrls(in: stack, around: index),
                    activeURL: nil
                )
            }
        }
        .onReceive(storyTimer) { now in
            updateStoryProgress(now: now)
        }
        .onReceive(pendingStoryUploads.$uploads) { _ in
            guard route.id == "my-story" else {
                return
            }

            if let stack = store.applyPendingUploads(
                pendingUploads: pendingStoryUploads,
                account: auth.account
            ) {
                index = min(index, max(stack.items.count - 1, 0))
                videoPlaybackPool.prepare(
                    urls: adjacentVideoUrls(in: stack, around: index),
                    activeURL: nil
                )
            }
        }
        .onChange(of: store.replyConfirmation) { _, confirmation in
            scheduleConfirmationDismiss(for: confirmation)
        }
        .onChange(of: store.reportConfirmation) { _, confirmation in
            scheduleReportConfirmationDismiss(for: confirmation)
        }
        .onDisappear {
            confirmationDismissTask?.cancel()
            reportConfirmationDismissTask?.cancel()
            videoPlaybackPool.removeAll()
        }
        .fullScreenCover(item: $reportingItem) { item in
            ReportStoryReasonView(
                creatorName: store.stack?.creator ?? "this creator",
                item: item,
                submit: { reason, details in
                    await store.report(item: item, reason: reason, details: details, api: api)
                }
            )
        }
        .confirmationDialog(
            "Delete this story?",
            isPresented: $isDeleteConfirmationPresented,
            titleVisibility: .visible
        ) {
            Button("Delete story", role: .destructive) {
                if let item = deleteConfirmationItem {
                    Task { await deleteStory(item) }
                }
            }
            Button("Cancel", role: .cancel) {
                deleteConfirmationItem = nil
            }
        } message: {
            Text("This removes the story from your profile and followers' feeds.")
        }
    }

    @ViewBuilder
    private func media(_ item: StoryStackItem) -> some View {
        ZStack {
            Color.black

            if item.isProcessingVideo {
                processingVideoPlaceholder(item)
            } else if item.assetKind == .video {
                AutoPlayVideoPlayer(
                    url: item.startupMediaUrl,
                    highQualityUrl: item.highQualityMediaUrl,
                    thumbnailUrl: thumbnailUrl(for: item),
                    preloadUrls: adjacentVideoUrls(for: item),
                    playerPool: videoPlaybackPool,
                    showsThumbnailWhileLoading: true,
                    isPaused: shouldPauseVideoPlayback,
                    onReadyForPlayback: {
                        guard timedStoryId == item.id else {
                            return
                        }
                        videoReadyItemId = item.id
                    },
                    onProgress: { progress in
                        updateVideoStoryProgress(progress, item: item)
                    },
                    onFinished: {
                        finishVideoStory(item)
                    }
                )
            } else {
                CachedAsyncImage(url: item.mediaUrl) { image in
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                } placeholder: {
                    storyImagePlaceholder(item)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func processingVideoPlaceholder(_ item: StoryStackItem) -> some View {
        ZStack {
            storyImagePlaceholder(item)
                .opacity(0.82)

            VStack(spacing: 12) {
                ProgressView()
                    .tint(.white)
                    .controlSize(.large)
                Text("Video processing")
                    .font(.system(size: 18, weight: .bold))
                Text("It will play here as soon as Cloudflare finishes preparing it.")
                    .font(.system(size: 13, weight: .semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.76))
                    .padding(.horizontal, 32)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.black.opacity(0.28))
        }
    }

    @ViewBuilder
    private func storyImagePlaceholder(_ item: StoryStackItem) -> some View {
        if let thumbnailUrl = thumbnailUrl(for: item) {
            CachedAsyncImage(url: thumbnailUrl) { image in
                image
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
            } placeholder: {
                Color.black
            }
        } else {
            ProgressView().tint(.white)
        }
    }

    private func thumbnailUrl(for item: StoryStackItem) -> URL? {
        item.playbackThumbnailUrl ?? (index == 0 ? openingThumbnailUrl : nil)
    }

    private func storyChrome(stack: StoryStack, item: StoryStackItem, safeAreaTop: CGFloat) -> some View {
        ZStack {
            storyTopChrome(stack: stack, item: item, topInset: storyTopChromeTopInset(for: safeAreaTop))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

            storyCaption(item)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.horizontal, UBEYEMetrics.screenInset)
                .padding(.bottom, captionBottomInset(for: stack, item: item))

            if let confirmation = store.replyConfirmation {
                replyConfirmationToast(confirmation)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.horizontal, UBEYEMetrics.screenInset)
                    .padding(.bottom, replyConfirmationBottomInset(for: stack))
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if let confirmation = store.reportConfirmation {
                replyConfirmationToast(confirmation)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.horizontal, UBEYEMetrics.screenInset)
                    .padding(.bottom, replyConfirmationBottomInset(for: stack))
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if let error = store.error, !error.isEmpty {
                replyConfirmationToast(error)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.horizontal, UBEYEMetrics.screenInset)
                    .padding(.bottom, replyConfirmationBottomInset(for: stack))
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            storyBottomChrome(stack: stack, item: item)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.horizontal, bottomChromeInset)
                .padding(.bottom, bottomChromeInset)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(.white)
    }

    private func storyTopChrome(stack: StoryStack, item: StoryStackItem, topInset: CGFloat) -> some View {
        VStack(spacing: 12) {
            storyProgressIndicator(stack: stack, item: item)
            storyHeader(stack: stack, item: item)
        }
        .padding(.horizontal, UBEYEMetrics.screenInset)
        .padding(.top, topInset)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private func storyTopChromeTopInset(for safeAreaTop: CGFloat) -> CGFloat {
        max(storyTopChromeMinimumInset, safeAreaTop + storyTopChromeSafeAreaGap)
    }

    @ViewBuilder
    private func storyCaption(_ item: StoryStackItem) -> some View {
        let overlays = item.textOverlays?.filter {
            !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        } ?? []

        if !overlays.isEmpty {
            GeometryReader { proxy in
                ForEach(overlays) { overlay in
                    storyOverlayChip(overlay, maxWidth: max(proxy.size.width - 32, 120))
                        .position(
                            x: overlayPosition(overlay.positionX, dimension: proxy.size.width),
                            y: overlayPosition(overlay.positionY, dimension: proxy.size.height)
                        )
                }
            }
        } else if !item.title.isEmpty {
            Text(item.title)
                .font(.headline)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.black.opacity(0.42), in: Capsule())
        }
    }

    @ViewBuilder
    private func storyOverlayChip(_ overlay: StoryTextOverlay, maxWidth: CGFloat) -> some View {
        if overlay.kind == "quote_reply" {
            storyQuoteReplyOverlay(overlay)
        } else if overlay.kind == "link", let href = overlay.href {
            Link(destination: href) {
                storyOverlayChipContent(overlay, maxWidth: maxWidth)
            }
            .buttonStyle(.plain)
            .contentShape(Capsule())
            .zIndex(2)
        } else {
            storyOverlayChipContent(overlay, maxWidth: maxWidth)
        }
    }

    private func storyQuoteReplyOverlay(_ overlay: StoryTextOverlay) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let actorName = overlay.sourceActorName {
                HStack(spacing: 8) {
                    RemoteAvatar(
                        url: overlay.sourceActorAvatarUrl,
                        size: 24,
                        name: actorName
                    )

                    VStack(alignment: .leading, spacing: 0) {
                        Text(actorName)
                            .font(.system(size: 13, weight: .bold))
                            .lineLimit(1)

                        if let handle = overlay.sourceActorHandle {
                            Text("@\(handle)")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                    }
                }
            }

            Text(overlay.label)
                .font(.system(size: 18, weight: .bold))
                .lineLimit(4)
                .multilineTextAlignment(.leading)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(width: 300, alignment: .leading)
        .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 14, y: 7)
    }

    private func storyOverlayChipContent(_ overlay: StoryTextOverlay, maxWidth: CGFloat) -> some View {
        HStack(spacing: 8) {
            if overlay.kind == "link" {
                Image(systemName: "link")
                    .font(.system(size: 15, weight: .bold))
            }

            Text(overlay.label)
                .font(.title3.bold())
                .multilineTextAlignment(.center)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: maxWidth)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: maxWidth)
        .background(.black.opacity(overlay.kind == "link" ? 0.56 : 0.42), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.22), lineWidth: 1))
        .shadow(color: .black.opacity(0.28), radius: 12, y: 6)
    }

    private func overlayPosition(_ percent: Double, dimension: CGFloat) -> CGFloat {
        let clampedPercent = min(max(percent, 0), 100)

        return dimension * CGFloat(clampedPercent / 100)
    }

    @ViewBuilder
    private func storyBottomChrome(stack: StoryStack, item: StoryStackItem) -> some View {
        if isOwnStack(stack) {
            if item.stats != nil {
                ownerStats(item)
                    .frame(height: ownerStatsHeight)
            } else {
                Color.clear
                    .frame(height: ownerStatsHeight)
            }
        } else if route.source != .discover {
            replyComposer(item)
                .frame(height: replyComposerHeight)
        }
    }

    private func captionBottomInset(for stack: StoryStack, item: StoryStackItem) -> CGFloat {
        if isOwnStack(stack) {
            return bottomChromeInset + ownerStatsHeight + captionBottomGap
        }

        if route.source != .discover {
            return bottomChromeInset + replyComposerHeight + captionBottomGap
        }

        return bottomChromeInset
    }

    private func replyConfirmationBottomInset(for stack: StoryStack) -> CGFloat {
        if isOwnStack(stack) || route.source == .discover {
            return bottomChromeInset
        }

        return bottomChromeInset + replyComposerHeight + 10
    }

    private func storyHeader(stack: StoryStack, item: StoryStackItem) -> some View {
        HStack(alignment: .center, spacing: 12) {
            StoryViewerAvatar(
                url: stack.avatarUrl,
                name: stack.creator,
                size: storyAvatarSize
            )

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(stack.creator)
                        .font(.system(size: 17, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)

                    if canFollowCreator(stack) {
                        discoverFollowButton()
                    }
                }

                Text(item.postedAt)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)

            StoryViewerActions(
                isOwnStack: isOwnStack(stack),
                canDeleteStory: !PendingStoryUploadStore.isPendingStoryId(item.id),
                actionSize: storyActionSize,
                isPerformingAction: store.isPerformingAction,
                deleteStory: {
                    deleteConfirmationItem = item
                    isDeleteConfirmationPresented = true
                },
                reportStory: {
                    presentReportScreen(for: item)
                },
                blockCreator: {
                    Task {
                        if await store.blockCreator(api: api) {
                            closeViewer()
                        }
                    }
                },
                canUnfollowCreator: canUnfollowCreator(stack),
                unfollowCreator: {
                    Task { await store.unfollowCreator(api: api) }
                },
                close: {
                    Task { await store.recordImpression(item: item, completed: false, api: api) }
                    closeViewer()
                }
            )
            .fixedSize()
        }
        .frame(maxWidth: .infinity, minHeight: storyAvatarSize, alignment: .leading)
    }

    private func deleteStory(_ item: StoryStackItem) async {
        if await store.delete(item: item, api: api) {
            closeViewer()
        }
    }

    private func discoverFollowButton() -> some View {
        Button {
            Task { await store.followCreator(api: api) }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "plus")
                    .font(.system(size: 10, weight: .bold))
                Text("Follow")
                    .font(.system(size: 13, weight: .bold))
            }
            .foregroundStyle(Color.ubeyeInk)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(.white, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(store.isPerformingAction)
        .opacity(store.isPerformingAction ? 0.7 : 1)
    }

    private func storyProgressIndicator(stack: StoryStack, item: StoryStackItem) -> some View {
        HStack(spacing: 5) {
            ForEach(stack.items.indices, id: \.self) { itemIndex in
                StoryProgressSegment(
                    progress: progressValue(for: itemIndex),
                    timing: progressTiming(for: itemIndex, activeItem: item)
                )
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 2)
        .accessibilityLabel("Story \(index + 1) of \(stack.items.count)")
    }

    private func progressValue(for itemIndex: Int) -> Double {
        if itemIndex < index {
            return 1
        }
        if itemIndex == index {
            return storyProgress
        }
        return 0
    }

    private func progressTiming(for itemIndex: Int, activeItem: StoryStackItem) -> StoryProgressTiming? {
        guard itemIndex == index,
              activeItem.assetKind != .video,
              !shouldPauseStoryProgress else {
            return nil
        }

        let duration = displayDuration(for: activeItem)
        guard duration > 0 else {
            return nil
        }

        return StoryProgressTiming(startedAt: storyStartedAt, duration: duration)
    }

    private func tapNavigationOverlay(item: StoryStackItem) -> some View {
        HStack(spacing: 0) {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture {
                    move(-1, item: item)
                }

            Color.clear
                .contentShape(Rectangle())
                .onTapGesture {
                    move(1, item: item)
                }
        }
        .ignoresSafeArea()
    }

    private func replyComposer(_ item: StoryStackItem) -> some View {
        HStack(spacing: 10) {
            TextField(
                "",
                text: $store.replyText,
                prompt: Text("Reply").foregroundStyle(.white.opacity(0.62))
            )
                .padding(.horizontal, 14)
                .frame(height: 46)
                .background(.white.opacity(0.14), in: Capsule())
                .foregroundStyle(.white)
                .tint(.white)
                .focused($isReplyFieldFocused)
                .submitLabel(.send)
                .onSubmit {
                    Task { await store.sendReply(item: item, api: api) }
                }
            Button {
                Task { await store.sendReply(item: item, api: api) }
            } label: {
                Image(systemName: store.isSendingReply ? "hourglass" : "paperplane.fill")
                    .frame(width: 46, height: 46)
                    .background(Color.ubeyeRed, in: Circle())
            }
            .disabled(store.isSendingReply || store.replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private func replyConfirmationToast(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .black))
                .frame(width: 22, height: 22)
                .foregroundStyle(Color.ubeyeInk)
                .background(.white, in: Circle())

            Text(message)
                .font(.system(size: 14, weight: .bold))
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .frame(height: 42)
        .background(.black.opacity(0.68), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.18), lineWidth: 1))
        .shadow(color: .black.opacity(0.22), radius: 12, y: 6)
    }

    @ViewBuilder
    private func ownerStats(_ item: StoryStackItem) -> some View {
        if let stats = item.stats {
            HStack {
                stat("Views", stats.views)
                Button {
                    showReplies(for: item)
                } label: {
                    stat("Replies", stats.replies)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Show \(stats.replies) story replies")
                stat("Earned", stats.earningsCents / 100)
            }
            .padding(12)
            .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func stat(_ label: String, _ value: Int) -> some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.headline)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.62))
        }
        .frame(maxWidth: .infinity)
    }

    private func showReplies(for item: StoryStackItem) {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
            repliesSheetItem = item
        }
        Task {
            await store.loadReplies(item: item, api: api)
        }
    }

    private func storyRepliesSheet(_ item: StoryStackItem, maxHeight: CGFloat) -> some View {
        StoryRepliesBottomSheet(
            count: item.stats?.replies ?? store.storyReplies[item.id]?.count ?? 0,
            replies: store.storyReplies[item.id] ?? [],
            isLoading: store.loadingRepliesStoryId == item.id,
            error: store.repliesError,
            retry: {
                Task { await store.loadReplies(item: item, api: api, force: true) }
            },
            close: {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
                    repliesSheetItem = nil
                }
            }
        )
        .frame(maxHeight: min(360, maxHeight * 0.44))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var verticalStorySwipeGesture: some Gesture {
        DragGesture(minimumDistance: 28, coordinateSpace: .local)
            .onEnded { value in
                handleVerticalStorySwipe(value)
            }
    }

    private func handleVerticalStorySwipe(_ value: DragGesture.Value) {
        guard repliesSheetItem == nil,
              let stack = store.stack,
              let item = stack.items[safe: index] else {
            return
        }

        let verticalDistance = value.translation.height
        let horizontalDistance = value.translation.width
        guard abs(verticalDistance) >= verticalSwipeMinimumDistance,
              abs(verticalDistance) > abs(horizontalDistance) * verticalSwipeDominanceRatio else {
            return
        }

        if verticalDistance < 0 {
            handleStorySwipeUp(stack: stack, item: item)
        } else {
            dismissStoryFromSwipe(item: item)
        }
    }

    private func handleStorySwipeUp(stack: StoryStack, item: StoryStackItem) {
        if canReplyFromSwipe(stack) {
            withAnimation(.easeOut(duration: 0.16)) {
                isReplyFieldFocused = true
            }
            return
        }

        if route.source == .discover {
            dismissStoryFromSwipe(item: item)
        }
    }

    private func dismissStoryFromSwipe(item: StoryStackItem) {
        Task { await store.recordImpression(item: item, completed: false, api: api) }
        closeViewer()
    }

    private func canReplyFromSwipe(_ stack: StoryStack) -> Bool {
        !isOwnStack(stack) && route.source != .discover && isFollowingCreator(stack)
    }

    private func move(_ delta: Int, item: StoryStackItem) {
        let nextIndex = min(max(index + delta, 0), max((store.stack?.items.count ?? 1) - 1, 0))
        guard nextIndex != index else {
            return
        }

        UBEYEHaptics.storyNavigation()
        Task { await store.recordImpression(item: item, completed: delta > 0, api: api) }
        repliesSheetItem = nil
        index = nextIndex
        if let next = store.stack?.items[safe: index] {
            store.markActiveItem(next)
            resetStoryTimer(for: next)
            if let stack = store.stack {
                MediaPreheater.preheat(stack: stack, around: index)
                videoPlaybackPool.prepare(
                    urls: adjacentVideoUrls(in: stack, around: index),
                    activeURL: next.isPlayableVideo ? next.startupMediaUrl : nil
                )
            }
        }
    }

    private func adjacentVideoUrls(for item: StoryStackItem) -> [URL] {
        guard let stack = store.stack,
              let itemIndex = stack.items.firstIndex(where: { $0.id == item.id }) else {
            return []
        }

        return adjacentVideoUrls(in: stack, around: itemIndex)
    }

    private func adjacentVideoUrls(in stack: StoryStack, around itemIndex: Int) -> [URL] {
        let lowerBound = max(itemIndex - 1, 0)
        let upperBound = min(itemIndex + 2, max(stack.items.count - 1, 0))

        guard lowerBound <= upperBound else {
            return []
        }

        return stack.items[lowerBound...upperBound].flatMap { item in
            item.videoPreloadUrls
        }
    }

    private func isOwnStack(_ stack: StoryStack) -> Bool {
        stack.id == "my-story" || stack.handle.trimmingCharacters(in: CharacterSet(charactersIn: "@")) == auth.account?.handle
    }

    private func canUnfollowCreator(_ stack: StoryStack) -> Bool {
        !isOwnStack(stack) && isFollowingCreator(stack)
    }

    private func canFollowCreator(_ stack: StoryStack) -> Bool {
        route.source == .discover && !isOwnStack(stack) && !isFollowingCreator(stack)
    }

    private func isFollowingCreator(_ stack: StoryStack) -> Bool {
        if store.locallyUnfollowedIds.contains(stack.creatorId) {
            return false
        }

        return store.followedIds.contains(stack.creatorId) || route.source == .homeFollowing || route.source == .followingFeed
    }

    private func startStoryTimerIfNeeded(for item: StoryStackItem) {
        guard timedStoryId != item.id else {
            return
        }
        resetStoryTimer(for: item)
    }

    private func resetStoryTimer(for item: StoryStackItem) {
        timedStoryId = item.id
        videoReadyItemId = item.assetKind == .video ? nil : item.id
        storyStartedAt = Date()
        storyProgress = 0
        didFinishCurrentItem = false
    }

    private func updateStoryProgress(now: Date) {
        guard let stack = store.stack, let item = stack.items[safe: index] else {
            return
        }

        startStoryTimerIfNeeded(for: item)

        if item.assetKind == .video {
            return
        }

        let duration = displayDuration(for: item)

        if shouldPauseStoryProgress {
            storyStartedAt = now.addingTimeInterval(-storyProgress * duration)
            return
        }

        storyProgress = min(max(now.timeIntervalSince(storyStartedAt) / duration, 0), 1)

        guard storyProgress >= 1, !didFinishCurrentItem else {
            return
        }

        finishCurrentItem(item)
    }

    private func updateVideoStoryProgress(_ progress: Double, item: StoryStackItem) {
        guard timedStoryId == item.id,
              videoReadyItemId == item.id,
              !didFinishCurrentItem else {
            return
        }

        storyProgress = min(max(progress, 0), 1)
    }

    private func finishVideoStory(_ item: StoryStackItem) {
        guard timedStoryId == item.id, !shouldPauseVideoPlayback else {
            return
        }

        finishCurrentItem(item)
    }

    private func finishCurrentItem(_ item: StoryStackItem) {
        guard let stack = store.stack, !didFinishCurrentItem else {
            return
        }

        didFinishCurrentItem = true
        storyProgress = 1

        if index < stack.items.count - 1 {
            move(1, item: item)
        } else {
            Task { await store.recordImpression(item: item, completed: true, api: api) }
            closeViewer()
        }
    }

    private func closeViewer() {
        if let onDismiss {
            onDismiss()
        } else {
            dismiss()
        }
    }

    private func displayDuration(for item: StoryStackItem) -> TimeInterval {
        if item.assetKind == .video, let durationSeconds = item.durationSeconds {
            return max(1, min(maxVideoStoryDurationSeconds, durationSeconds))
        }

        return defaultStoryDurationSeconds
    }

    private func presentReportScreen(for item: StoryStackItem) {
        reportingItem = nil
        DispatchQueue.main.async {
            reportingItem = item
        }
    }

    private var shouldPauseStoryProgress: Bool {
        shouldPauseVideoPlayback ||
            isWaitingForCurrentVideo
    }

    private var shouldPauseVideoPlayback: Bool {
        isReplyFieldFocused ||
            repliesSheetItem != nil ||
            store.isSendingReply ||
            !store.replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isWaitingForCurrentVideo: Bool {
        guard let item = store.stack?.items[safe: index], item.assetKind == .video else {
            return false
        }

        return videoReadyItemId != item.id
    }

    private func scheduleConfirmationDismiss(for confirmation: String?) {
        confirmationDismissTask?.cancel()
        guard confirmation != nil else {
            return
        }

        confirmationDismissTask = Task {
            try? await Task.sleep(for: .seconds(1.8))
            guard !Task.isCancelled else {
                return
            }
            await MainActor.run {
                withAnimation(.easeOut(duration: 0.18)) {
                    store.clearReplyConfirmation()
                }
            }
        }
    }

    private func scheduleReportConfirmationDismiss(for confirmation: String?) {
        reportConfirmationDismissTask?.cancel()
        guard confirmation != nil else {
            return
        }

        reportConfirmationDismissTask = Task {
            try? await Task.sleep(for: .seconds(1.8))
            guard !Task.isCancelled else {
                return
            }
            await MainActor.run {
                withAnimation(.easeOut(duration: 0.18)) {
                    store.clearReportConfirmation()
                }
            }
        }
    }
}

private struct StoryProgressTiming {
    let startedAt: Date
    let duration: TimeInterval

    func progress(at date: Date) -> Double {
        min(max(date.timeIntervalSince(startedAt) / duration, 0), 1)
    }
}

private struct StoryProgressSegment: View {
    let progress: Double
    let timing: StoryProgressTiming?

    var body: some View {
        Group {
            if let timing {
                TimelineView(.animation) { context in
                    track(progress: timing.progress(at: context.date))
                }
            } else {
                track(progress: progress)
            }
        }
        .frame(height: 4)
        .frame(maxWidth: .infinity)
    }

    private func track(progress: Double) -> some View {
        let clampedProgress = CGFloat(max(0, min(1, progress)))

        return ZStack(alignment: .leading) {
            Capsule()
                .fill(.white.opacity(0.32))
            Capsule()
                .fill(.white)
                .scaleEffect(x: clampedProgress, y: 1, anchor: .leading)
        }
    }
}

private struct StoryViewerAvatar: View {
    let url: URL?
    let name: String
    let size: CGFloat

    var body: some View {
        RemoteAvatar(url: url, size: size, name: name)
            .overlay(Circle().stroke(.white.opacity(0.24), lineWidth: 1))
            .frame(width: size, height: size, alignment: .center)
            .fixedSize()
            .accessibilityHidden(true)
    }
}

private struct StoryRepliesBottomSheet: View {
    let count: Int
    let replies: [StoryInteractionEvent]
    let isLoading: Bool
    let error: String?
    let retry: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header

            if isLoading && replies.isEmpty {
                loadingState
            } else if let error, replies.isEmpty {
                errorState(error)
            } else if replies.isEmpty {
                emptyState
            } else {
                replyList
            }
        }
        .foregroundStyle(.white)
        .background(Color.ubeyeInk.opacity(0.94), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.white.opacity(0.12), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.34), radius: 24, y: 12)
    }

    private var header: some View {
        VStack(spacing: 12) {
            Capsule()
                .fill(.white.opacity(0.32))
                .frame(width: 38, height: 4)

            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Replies")
                        .font(.system(size: 18, weight: .black))
                    Text("\(count) total")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.58))
                }

                Spacer()

                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .black))
                        .frame(width: 30, height: 30)
                        .background(.white.opacity(0.12), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close replies")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 12)
    }

    private var replyList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(replies) { reply in
                    StoryReplyPreviewRow(reply: reply)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 14)
        }
        .scrollIndicators(.visible)
    }

    private var loadingState: some View {
        VStack(spacing: 10) {
            ProgressView()
                .tint(.white)
            Text("Loading replies")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity, minHeight: 150)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "ellipsis.message")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white.opacity(0.55))
            Text("No replies yet")
                .font(.system(size: 15, weight: .bold))
            Text("Replies to this story will appear here.")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.55))
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, minHeight: 150)
        .padding(.horizontal, 24)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 10) {
            Text(message)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white.opacity(0.72))
                .multilineTextAlignment(.center)

            Button(action: retry) {
                Label("Try again", systemImage: "arrow.clockwise")
                    .font(.system(size: 13, weight: .black))
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .background(.white, in: Capsule())
                    .foregroundStyle(Color.ubeyeInk)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, minHeight: 150)
        .padding(.horizontal, 24)
    }
}

private struct StoryReplyPreviewRow: View {
    let reply: StoryInteractionEvent

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RemoteAvatar(url: reply.actor.imageUrl, size: 34, name: reply.actor.name)
                .overlay(Circle().stroke(.white.opacity(0.12), lineWidth: 1))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(reply.actor.name)
                        .font(.system(size: 13, weight: .black))
                        .lineLimit(1)

                    Text("@\(reply.actor.handle)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.5))
                        .lineLimit(1)

                    Spacer(minLength: 6)

                    Text(storyReplyTimestamp(reply.createdAt))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.5))
                        .lineLimit(1)
                }

                Text(reply.body ?? reply.reaction ?? "Reply")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.88))
                    .fixedSize(horizontal: false, vertical: true)

                if reply.mediaUrl != nil {
                    Label("Media reply", systemImage: "photo")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white.opacity(0.55))
                }
            }
        }
        .padding(10)
        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private func storyReplyTimestamp(_ value: String) -> String {
    guard let date = ISO8601DateFormatter.storyReplyWithFractionalSeconds.date(from: value) ??
        ISO8601DateFormatter.storyReply.date(from: value) else {
        return value
    }

    return DateFormatter.storyReplyTime.string(from: date)
}

private extension ISO8601DateFormatter {
    static let storyReply: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let storyReplyWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private extension DateFormatter {
    static let storyReplyTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
}

enum StoryReportReason: String, CaseIterable, Identifiable {
    case spam
    case harassment
    case hate
    case sexualContent = "sexual_content"
    case violence
    case selfHarm = "self_harm"
    case illegalGoods = "illegal_goods"
    case impersonation
    case intellectualProperty = "intellectual_property"
    case other

    var id: String { rawValue }

    var iconName: String {
        switch self {
        case .spam:
            return "exclamationmark.bubble"
        case .harassment:
            return "person.crop.circle.badge.exclamationmark"
        case .hate:
            return "hand.raised"
        case .sexualContent:
            return "eye.slash"
        case .violence:
            return "exclamationmark.triangle"
        case .selfHarm:
            return "heart.text.square"
        case .illegalGoods:
            return "shippingbox"
        case .impersonation:
            return "person.crop.circle.badge.questionmark"
        case .intellectualProperty:
            return "doc.badge.gearshape"
        case .other:
            return "ellipsis.circle"
        }
    }

    var title: String {
        switch self {
        case .spam:
            return "Spam, scam, or fraud"
        case .harassment:
            return "Harassment or bullying"
        case .hate:
            return "Hate speech or hateful symbols"
        case .sexualContent:
            return "Nudity or sexual content"
        case .violence:
            return "Violence or dangerous behavior"
        case .selfHarm:
            return "Self-harm, suicide, or eating disorder"
        case .illegalGoods:
            return "Illegal or regulated goods"
        case .impersonation:
            return "Impersonation"
        case .intellectualProperty:
            return "Intellectual property"
        case .other:
            return "Something else"
        }
    }

    var subtitle: String {
        switch self {
        case .spam:
            return "Fake giveaways, phishing, scams, bot activity, or deceptive engagement."
        case .harassment:
            return "Threats, intimidation, targeted insults, bullying, or unwanted attacks."
        case .hate:
            return "Attacks, slurs, or dehumanizing content based on protected traits."
        case .sexualContent:
            return "Explicit nudity, sexual solicitation, exploitation, or unwanted sexual content."
        case .violence:
            return "Graphic injury, credible threats, weapons, dangerous acts, or praise of violence."
        case .selfHarm:
            return "Content encouraging, instructing, or glorifying self-injury or suicide."
        case .illegalGoods:
            return "Drugs, weapons, counterfeit items, regulated sales, or other restricted products."
        case .impersonation:
            return "Pretending to be someone else, a brand, a public figure, or a business."
        case .intellectualProperty:
            return "Copyright, trademark, stolen media, or content used without permission."
        case .other:
            return "Something else that violates UBEYE's Community Guidelines."
        }
    }
}

private struct StoryReportReasonSection: Identifiable {
    let id: String
    let title: String
    let reasons: [StoryReportReason]

    static let all: [StoryReportReasonSection] = [
        StoryReportReasonSection(
            id: "safety",
            title: "Safety",
            reasons: [.harassment, .hate, .violence, .selfHarm]
        ),
        StoryReportReasonSection(
            id: "content",
            title: "Content",
            reasons: [.sexualContent, .illegalGoods, .spam]
        ),
        StoryReportReasonSection(
            id: "identity",
            title: "Identity and rights",
            reasons: [.impersonation, .intellectualProperty, .other]
        ),
    ]
}

private struct ReportStoryReasonView: View {
    @Environment(\.dismiss) private var dismiss
    let creatorName: String
    let item: StoryStackItem
    let submit: (StoryReportReason, String?) async -> Bool

    @State private var selectedReason: StoryReportReason?
    @State private var details = ""
    @State private var isSubmitting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header

                        ForEach(StoryReportReasonSection.all) { section in
                            reasonSection(section)
                        }

                        detailsSection

                        if let error {
                            InlineNotice(message: error, isError: true)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 22)
                }

                submitBar
            }
            .toolbar(.hidden, for: .navigationBar)
            .ubeyeScreen()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .bold))
                        .frame(width: 40, height: 40)
                        .foregroundStyle(Color.ubeyeInk)
                        .background(Color.ubeyeSubtle, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close report story")

                Spacer()
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("Report story")
                    .font(.system(size: 31, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)

                Text("Why are you reporting this story from \(creatorName)?")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Choose the closest reason. Reports are reviewed against UBEYE's Community Guidelines.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func reasonSection(_ section: StoryReportReasonSection) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(section.title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.ubeyeMuted)
                .textCase(.uppercase)

            VStack(spacing: 8) {
                ForEach(section.reasons) { reason in
                    reasonRow(reason)
                }
            }
        }
    }

    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Add details")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color.ubeyeInk)

            TextEditor(text: $details)
                .font(.system(size: 15, weight: .medium))
                .frame(minHeight: 96)
                .padding(10)
                .scrollContentBackground(.hidden)
                .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color.ubeyeBorder, lineWidth: 1)
                )
                .accessibilityLabel("Additional report details")

            Text("Optional, but helpful for review.")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.ubeyeMuted)
        }
    }

    private var submitBar: some View {
        VStack(spacing: 10) {
            Divider()

            VStack(spacing: 9) {
                Button {
                    Task { await submitReport() }
                } label: {
                    HStack(spacing: 8) {
                        if isSubmitting {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        }
                        Text(isSubmitting ? "Submitting report" : "Submit report")
                    }
                    .font(.system(size: 16, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .foregroundStyle(.white)
                    .background(selectedReason == nil ? Color.ubeyeMuted.opacity(0.45) : Color.ubeyeRed, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(selectedReason == nil || isSubmitting)

                Text(selectedReason == nil ? "Select a reason to continue." : "UBEYE reviews reports and may remove content or restrict accounts.")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
        .background(Color.ubeyeBackground)
    }

    private func reasonRow(_ reason: StoryReportReason) -> some View {
        Button {
            selectedReason = reason
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: reason.iconName)
                    .font(.system(size: 17, weight: .bold))
                    .frame(width: 34, height: 34)
                    .foregroundStyle(selectedReason == reason ? .white : Color.ubeyeRed)
                    .background(
                        selectedReason == reason ? Color.ubeyeRed : Color.ubeyeRed.opacity(0.09),
                        in: Circle()
                    )

                VStack(alignment: .leading, spacing: 4) {
                    Text(reason.title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color.ubeyeInk)
                    Text(reason.subtitle)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: selectedReason == reason ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(selectedReason == reason ? Color.ubeyeRed : Color.ubeyeMuted.opacity(0.55))
            }
            .padding(12)
            .background(selectedReason == reason ? Color.ubeyeRed.opacity(0.055) : .white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(selectedReason == reason ? Color.ubeyeRed.opacity(0.5) : Color.ubeyeBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(reason.title)
    }

    private func submitReport() async {
        guard let selectedReason, !isSubmitting else {
            return
        }

        isSubmitting = true
        error = nil
        let trimmedDetails = details.trimmingCharacters(in: .whitespacesAndNewlines)
        let didSubmit = await submit(selectedReason, trimmedDetails.isEmpty ? nil : trimmedDetails)
        isSubmitting = false

        if didSubmit {
            dismiss()
        } else {
            error = "Could not submit report. Try again."
        }
    }
}

private struct StoryViewerActions: View {
    let isOwnStack: Bool
    let canDeleteStory: Bool
    let actionSize: CGFloat
    let isPerformingAction: Bool
    let deleteStory: () -> Void
    let reportStory: () -> Void
    let blockCreator: () -> Void
    let canUnfollowCreator: Bool
    let unfollowCreator: () -> Void
    let close: () -> Void

    @State private var isActionDialogPresented = false

    var body: some View {
        HStack(spacing: 16) {
            if isOwnStack {
                if canDeleteStory {
                    Button(action: deleteStory) {
                        StoryViewerActionIcon(systemImage: "trash", size: actionSize, fontSize: 18)
                    }
                    .buttonStyle(.plain)
                    .disabled(isPerformingAction)
                    .opacity(isPerformingAction ? 0.55 : 1)
                    .accessibilityLabel("Delete story")
                }
            } else {
                Button {
                    isActionDialogPresented = true
                } label: {
                    StoryViewerActionIcon(systemImage: "ellipsis", size: actionSize, fontSize: 19)
                }
                .buttonStyle(.plain)
                .disabled(isPerformingAction)
                .opacity(isPerformingAction ? 0.55 : 1)
                .accessibilityLabel("Story options")
                .confirmationDialog(
                    "Story options",
                    isPresented: $isActionDialogPresented,
                    titleVisibility: .visible
                ) {
                    Button("Report story") {
                        reportStory()
                    }

                    if canUnfollowCreator {
                        Button("Unfollow creator", role: .destructive) {
                            unfollowCreator()
                        }
                    }

                    Button("Block creator", role: .destructive) {
                        blockCreator()
                    }

                    Button("Cancel", role: .cancel) {}
                }
            }

            Button(action: close) {
                StoryViewerActionIcon(systemImage: "xmark", size: actionSize, fontSize: 20)
            }
            .buttonStyle(.plain)
        }
    }
}

private struct StoryViewerActionIcon: View {
    let systemImage: String
    let size: CGFloat
    let fontSize: CGFloat

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: fontSize, weight: .bold))
            .frame(width: size, height: size)
            .background(.black.opacity(0.22), in: Circle())
            .contentShape(Circle())
    }
}

@MainActor
final class StoryVideoPlaybackPool: ObservableObject {
    struct PreparedPlayer {
        let player: AVPlayer
        let playbackURL: URL
        let cacheState: String
    }

    private var preparedPlayers: [URL: PreparedPlayer] = [:]
    private var prepareTasks: [URL: Task<Void, Never>] = [:]
    private let maxPreparedPlayers = 3

    func hasPreparedPlayer(for url: URL) -> Bool {
        preparedPlayers[url] != nil
    }

    func takePreparedPlayer(for url: URL) -> PreparedPlayer? {
        prepareTasks[url]?.cancel()
        prepareTasks[url] = nil

        guard let prepared = preparedPlayers.removeValue(forKey: url) else {
            return nil
        }

        prepared.player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
        MediaPerformance.mark("video_player_pool_hit url=\(url.lastPathComponent)")
        return prepared
    }

    func prepare(urls: [URL], activeURL: URL?) {
        var seen = Set<URL>()
        let desiredUrls = urls
            .filter { seen.insert($0).inserted }
            .filter { $0 != activeURL }
            .prefix(maxPreparedPlayers)

        let desiredSet = Set(desiredUrls)
        prune(keeping: desiredSet)

        for url in desiredUrls where preparedPlayers[url] == nil && prepareTasks[url] == nil {
            prepareTasks[url] = Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                let startedAt = Date()
                guard let prepared = await Self.buildPreparedPlayer(for: url),
                      !Task.isCancelled else {
                    self.prepareTasks[url] = nil
                    return
                }

                self.preparedPlayers[url] = prepared
                self.prepareTasks[url] = nil
                MediaPerformance.measure("video_player_prepared url=\(url.lastPathComponent)", since: startedAt)
                self.prune(keeping: desiredSet)
            }
        }
    }

    func removeAll() {
        for task in prepareTasks.values {
            task.cancel()
        }
        prepareTasks.removeAll()

        for prepared in preparedPlayers.values {
            prepared.player.pause()
        }
        preparedPlayers.removeAll()
    }

    private static func buildPreparedPlayer(for url: URL) async -> PreparedPlayer? {
        let resolved = await resolvePlaybackURL(for: url)
        let asset = AVURLAsset(url: resolved.playbackURL)

        do {
            guard try await asset.load(.isPlayable) else {
                return nil
            }
            _ = try? await asset.load(.duration)
        } catch {
            MediaPerformance.mark("video_player_prepare_failed url=\(url.lastPathComponent)")
            return nil
        }

        let item = AVPlayerItem(asset: asset)
        configureStreamingHints(for: item, playbackURL: resolved.playbackURL)
        item.preferredForwardBufferDuration = resolved.playbackURL.pathExtension.lowercased() == "m3u8" ? 6 : 3

        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
        player.pause()

        return PreparedPlayer(
            player: player,
            playbackURL: resolved.playbackURL,
            cacheState: resolved.cacheState
        )
    }

    private static func resolvePlaybackURL(for url: URL) async -> (playbackURL: URL, cacheState: String) {
        let canPersistVideo = await MediaFileDiskCache.shared.supportsPersistence(url: url, kind: .video)

        if canPersistVideo,
           let cachedPlaybackURL = await MediaFileDiskCache.shared.cachedFileURL(for: url) {
            return (cachedPlaybackURL, "hit")
        }

        return (url, "miss")
    }

    private static func configureStreamingHints(for item: AVPlayerItem, playbackURL: URL) {
        guard playbackURL.pathExtension.lowercased() == "m3u8" else {
            return
        }

        item.preferredPeakBitRate = NetworkQualityMonitor.shared.isConstrained ? 4_000_000 : 10_000_000
        item.preferredMaximumResolution = CGSize(width: 1920, height: 1920)
    }

    private func prune(keeping desiredSet: Set<URL>) {
        for url in Array(prepareTasks.keys) where !desiredSet.contains(url) {
            prepareTasks[url]?.cancel()
            prepareTasks[url] = nil
        }

        for url in Array(preparedPlayers.keys) where !desiredSet.contains(url) {
            preparedPlayers[url]?.player.pause()
            preparedPlayers[url] = nil
        }

        guard preparedPlayers.count > maxPreparedPlayers else {
            return
        }

        for url in Array(preparedPlayers.keys) where preparedPlayers.count > maxPreparedPlayers {
            preparedPlayers[url]?.player.pause()
            preparedPlayers[url] = nil
        }
    }
}

struct AutoPlayVideoPlayer: View {
    let url: URL
    let highQualityUrl: URL?
    let thumbnailUrl: URL?
    let preloadUrls: [URL]
    let playerPool: StoryVideoPlaybackPool?
    let showsThumbnailWhileLoading: Bool
    let isPaused: Bool
    let onReadyForPlayback: () -> Void
    let onProgress: (Double) -> Void
    let onFinished: () -> Void
    @StateObject private var playback = AutoPlayVideoPlaybackController()

    init(
        url: URL,
        highQualityUrl: URL? = nil,
        thumbnailUrl: URL? = nil,
        preloadUrls: [URL] = [],
        playerPool: StoryVideoPlaybackPool? = nil,
        showsThumbnailWhileLoading: Bool = true,
        isPaused: Bool = false,
        onReadyForPlayback: @escaping () -> Void = {},
        onProgress: @escaping (Double) -> Void = { _ in },
        onFinished: @escaping () -> Void = {}
    ) {
        self.url = url
        self.highQualityUrl = highQualityUrl
        self.thumbnailUrl = thumbnailUrl
        self.preloadUrls = preloadUrls
        self.playerPool = playerPool
        self.showsThumbnailWhileLoading = showsThumbnailWhileLoading
        self.isPaused = isPaused
        self.onReadyForPlayback = onReadyForPlayback
        self.onProgress = onProgress
        self.onFinished = onFinished
    }

    var body: some View {
        ZStack {
            AspectFillVideoPlayer(player: playback.player) {
                playback.revealVideo(reason: "layer_ready")
            }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            if showsThumbnailWhileLoading, !playback.isReadyForPlayback, let thumbnailUrl {
                CachedAsyncImage(url: thumbnailUrl) { image in
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                } placeholder: {
                    Color.black
                }
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.12), value: playback.isReadyForPlayback)
        .background(Color.black)
        .onAppear {
            playerPool?.prepare(urls: [url] + [highQualityUrl].compactMap { $0 } + preloadUrls, activeURL: nil)
            playback.play(
                url: url,
                highQualityUrl: highQualityUrl,
                playerPool: playerPool,
                isPaused: isPaused,
                onReadyForPlayback: onReadyForPlayback,
                onProgress: onProgress,
                onFinished: onFinished
            )
        }
        .onChange(of: url) { _, nextURL in
            playerPool?.prepare(urls: [nextURL] + [highQualityUrl].compactMap { $0 } + preloadUrls, activeURL: nil)
            playback.play(
                url: nextURL,
                highQualityUrl: highQualityUrl,
                playerPool: playerPool,
                isPaused: isPaused,
                onReadyForPlayback: onReadyForPlayback,
                onProgress: onProgress,
                onFinished: onFinished
            )
        }
        .onChange(of: highQualityUrl) { _, nextURL in
            playerPool?.prepare(urls: [url] + [nextURL].compactMap { $0 } + preloadUrls, activeURL: nil)
            playback.play(
                url: url,
                highQualityUrl: nextURL,
                playerPool: playerPool,
                isPaused: isPaused,
                onReadyForPlayback: onReadyForPlayback,
                onProgress: onProgress,
                onFinished: onFinished
            )
        }
        .onChange(of: preloadUrls) { _, nextUrls in
            playerPool?.prepare(urls: [url] + [highQualityUrl].compactMap { $0 } + nextUrls, activeURL: nil)
        }
        .onChange(of: isPaused) { _, nextValue in
            playback.setPaused(nextValue)
        }
        .onDisappear {
            playback.stop(reason: "disappear")
        }
    }
}

@MainActor
private final class AutoPlayVideoPlaybackController: ObservableObject {
    @Published private(set) var player: AVPlayer?
    @Published private(set) var isReadyForPlayback = false

    private var activeURL: URL?
    private var activeHighQualityURL: URL?
    private var activePlaybackURL: URL?
    private var isPaused = false
    private var didFinishPlayback = false
    private var lastPublishedProgress = 0.0
    private var stallObserver: NSObjectProtocol?
    private var playbackFailureObserver: NSObjectProtocol?
    private var playbackEndObserver: NSObjectProtocol?
    private var timeObserver: Any?
    private weak var timeObserverPlayer: AVPlayer?
    private var playTask: Task<Void, Never>?
    private var revealTask: Task<Void, Never>?
    private var stallRecoveryTask: Task<Void, Never>?
    private var playbackStartedAt: Date?
    private var startupMetadata = ""
    private var onReadyForPlayback: () -> Void = {}
    private var onProgress: (Double) -> Void = { _ in }
    private var onFinished: () -> Void = {}
    private var playbackRetryCount = 0
    private var layerReadyForDisplay = false
    private let progressObserverInterval = CMTime(seconds: 1.0 / 60.0, preferredTimescale: 600)
    private let minimumPublishedProgressDelta = 0.0001
    private let maxPlaybackRetries = 2

    func play(
        url: URL,
        highQualityUrl: URL?,
        playerPool: StoryVideoPlaybackPool?,
        isPaused: Bool,
        onReadyForPlayback: @escaping () -> Void,
        onProgress: @escaping (Double) -> Void,
        onFinished: @escaping () -> Void
    ) {
        self.onReadyForPlayback = onReadyForPlayback
        self.onProgress = onProgress
        self.onFinished = onFinished
        self.isPaused = isPaused

        if activeURL == url, activeHighQualityURL == highQualityUrl, player != nil {
            setPaused(isPaused)
            return
        }

        cleanupCurrentPlayer(reason: activeURL == nil ? nil : "replace")
        activeURL = url
        activeHighQualityURL = highQualityUrl
        playbackRetryCount = 0
        isReadyForPlayback = false
        layerReadyForDisplay = false
        didFinishPlayback = false
        lastPublishedProgress = 0
        startPlayback(url: url, highQualityUrl: highQualityUrl, playerPool: playerPool)
    }

    private func startPlayback(url: URL, highQualityUrl: URL?, playerPool: StoryVideoPlaybackPool?) {
        playTask?.cancel()
        revealTask?.cancel()
        revealTask = nil
        playTask = Task { @MainActor in
            let startedAt = Date()
            playbackStartedAt = startedAt
            let selected = await preferredPlaybackURL(
                defaultURL: url,
                highQualityURL: highQualityUrl,
                playerPool: playerPool
            )
            let prepared = playerPool?.takePreparedPlayer(for: selected.url)
            let resolved = prepared == nil ? await resolvePlaybackURL(for: selected.url) : nil
            let playbackURL = prepared?.playbackURL ?? resolved?.playbackURL ?? selected.url
            activePlaybackURL = playbackURL
            let delivery = playbackDelivery(for: selected.url)
            let cacheState = prepared?.cacheState ?? resolved?.cacheState ?? "miss"
            let playerSource = prepared == nil ? "fresh" : "pooled"
            startupMetadata = "delivery=\(delivery) cache=\(cacheState) source=\(playerSource) quality=\(selected.quality) url=\(selected.url.lastPathComponent)"
            MediaPerformance.mark(
                "video_startup \(startupMetadata)"
            )

            if cacheState == "hit" {
                MediaPerformance.mark("video_disk_cache_hit quality=\(selected.quality) url=\(selected.url.lastPathComponent)")
            }

            guard !Task.isCancelled else {
                return
            }

            player?.pause()
            let next = prepared?.player ?? makeFreshPlayer(playbackURL: playbackURL)
            player = next
            observeReadiness(player: next, url: selected.url, startedAt: startedAt)
            observeStalls(player: next, url: selected.url)
            observeFailures(player: next, url: selected.url)
            observeCompletion(player: next, url: selected.url)
            observeProgress(player: next)
            AppAudioSession.configureForVideoPlayback()
            if isPaused {
                next.pause()
            } else {
                next.play()
            }
        }
    }

    private func preferredPlaybackURL(
        defaultURL: URL,
        highQualityURL: URL?,
        playerPool: StoryVideoPlaybackPool?
    ) async -> (url: URL, quality: String) {
        guard let highQualityURL else {
            return (defaultURL, "playback")
        }

        if playerPool?.hasPreparedPlayer(for: highQualityURL) == true {
            return (highQualityURL, "original_pooled")
        }

        if await MediaFileDiskCache.shared.cachedFileURL(for: highQualityURL) != nil {
            return (highQualityURL, "original_cached")
        }

        return (defaultURL, "playback")
    }

    private func makeFreshPlayer(playbackURL: URL) -> AVPlayer {
        let item = AVPlayerItem(url: playbackURL)
        item.preferredForwardBufferDuration = playbackURL.pathExtension.lowercased() == "m3u8" ? 6 : 3
        configureStreamingHints(for: item, playbackURL: playbackURL)
        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
        return player
    }

    private func resolvePlaybackURL(for url: URL) async -> (playbackURL: URL, cacheState: String) {
        let canPersistVideo = await MediaFileDiskCache.shared.supportsPersistence(url: url, kind: .video)

        if canPersistVideo,
           let cachedPlaybackURL = await MediaFileDiskCache.shared.cachedFileURL(for: url) {
            return (cachedPlaybackURL, "hit")
        }

        return (url, "miss")
    }

    private func configureStreamingHints(for item: AVPlayerItem?, playbackURL: URL) {
        guard let item, playbackURL.pathExtension.lowercased() == "m3u8" else {
            return
        }

        item.preferredPeakBitRate = NetworkQualityMonitor.shared.isConstrained ? 4_000_000 : 10_000_000
        item.preferredMaximumResolution = CGSize(width: 1920, height: 1920)
    }

    private func playbackDelivery(for url: URL) -> String {
        if url.pathExtension.lowercased() == "m3u8" {
            return "hls"
        }

        if url.isFileURL {
            return "file"
        }

        return "progressive"
    }

    func setPaused(_ isPaused: Bool) {
        self.isPaused = isPaused
        guard let player else {
            return
        }

        if isPaused {
            player.pause()
        } else if !didFinishPlayback {
            player.play()
        }
    }

    func stop(reason: String) {
        cleanupCurrentPlayer(reason: reason)
        activeURL = nil
        activeHighQualityURL = nil
    }

    private func observeReadiness(player: AVPlayer, url: URL, startedAt: Date) {
        revealTask?.cancel()
        revealTask = Task { @MainActor in
            var didLogItemReady = false

            for _ in 0..<300 {
                guard self.player === player else {
                    return
                }

                if player.currentItem?.status == .readyToPlay {
                    if !didLogItemReady {
                        didLogItemReady = true
                        MediaPerformance.measure("video_item_ready url=\(url.lastPathComponent)", since: startedAt)
                    }
                    attemptRevealVideo(reason: "item_ready")
                } else if player.currentItem?.status == .failed {
                    handlePlaybackFailure(player: player, url: url, reason: "item_failed")
                    return
                }

                try? await Task.sleep(for: .milliseconds(50))
            }

            guard self.player === player, !isReadyForPlayback else {
                return
            }

            retryPlaybackIfPossible(player: player, url: url, reason: "readiness_timeout")
        }
    }

    func revealVideo(reason: String) {
        layerReadyForDisplay = true
        attemptRevealVideo(reason: reason)
    }

    private func attemptRevealVideo(reason: String) {
        guard !isReadyForPlayback else {
            return
        }

        guard layerReadyForDisplay, isPlayerReadyToReveal else {
            return
        }

        let startedAt = playbackStartedAt ?? Date()
        isReadyForPlayback = true
        onReadyForPlayback()
        let metadata = startupMetadata.isEmpty
            ? "url=\(activeURL?.lastPathComponent ?? "unknown")"
            : startupMetadata
        MediaPerformance.measure(
            "video_first_frame reason=\(reason) \(metadata)",
            since: startedAt
        )
    }

    private var isPlayerReadyToReveal: Bool {
        guard let item = player?.currentItem, item.status == .readyToPlay else {
            return false
        }

        if activePlaybackURL?.isFileURL == true {
            return true
        }

        if item.isPlaybackLikelyToKeepUp || item.isPlaybackBufferFull {
            return true
        }

        let loadedDuration = item.loadedTimeRanges
            .map(\.timeRangeValue)
            .map { $0.start.seconds + $0.duration.seconds }
            .filter { $0.isFinite }
            .max() ?? 0
        let currentTime = player?.currentTime().seconds ?? 0
        return loadedDuration - currentTime >= 0.2
    }

    private func observeStalls(player: AVPlayer, url: URL) {
        if let stallObserver {
            NotificationCenter.default.removeObserver(stallObserver)
        }

        stallObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemPlaybackStalled,
            object: player.currentItem,
            queue: .main
        ) { [weak self, weak player] _ in
            Task { @MainActor in
                guard let self, let player, self.player === player else {
                    return
                }

                let phase = self.isReadyForPlayback ? "playing" : "startup"
                MediaPerformance.mark("video_stalled phase=\(phase) url=\(url.lastPathComponent)")
                if self.isReadyForPlayback {
                    self.monitorStallRecovery(player: player, url: url)
                } else {
                    self.retryPlaybackIfPossible(player: player, url: url, reason: "stalled_before_ready")
                }
            }
        }
    }

    private func monitorStallRecovery(player: AVPlayer, url: URL) {
        stallRecoveryTask?.cancel()
        stallRecoveryTask = Task { @MainActor in
            let stalledAt = Date()

            for _ in 0..<100 {
                guard self.player === player, !Task.isCancelled else {
                    return
                }

                if player.currentItem?.isPlaybackLikelyToKeepUp == true {
                    MediaPerformance.measure(
                        "video_recovered reason=stall url=\(url.lastPathComponent)",
                        since: stalledAt
                    )
                    if !self.isPaused, !self.didFinishPlayback {
                        player.play()
                    }
                    return
                }

                try? await Task.sleep(for: .milliseconds(50))
            }

            guard self.player === player, !Task.isCancelled else {
                return
            }

            logPlaybackFailure(player: player, url: url, reason: "stall_recovery_timeout")
        }
    }

    private func observeFailures(player: AVPlayer, url: URL) {
        if let playbackFailureObserver {
            NotificationCenter.default.removeObserver(playbackFailureObserver)
        }

        playbackFailureObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: player.currentItem,
            queue: .main
        ) { [weak self, weak player] notification in
            Task { @MainActor in
                guard let self, self.player === player, let player else {
                    return
                }

                let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                self.handlePlaybackFailure(player: player, url: url, reason: "failed_to_end", error: error)
            }
        }
    }

    private func observeCompletion(player: AVPlayer, url: URL) {
        if let playbackEndObserver {
            NotificationCenter.default.removeObserver(playbackEndObserver)
        }

        playbackEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: player.currentItem,
            queue: .main
        ) { [weak self, weak player] _ in
            Task { @MainActor in
                guard let self, self.player === player else {
                    return
                }

                self.finishPlayback(url: url)
            }
        }
    }

    private func observeProgress(player: AVPlayer) {
        removeTimeObserver()

        timeObserverPlayer = player
        timeObserver = player.addPeriodicTimeObserver(forInterval: progressObserverInterval, queue: .main) { [weak self, weak player] time in
            Task { @MainActor in
                guard let self, self.player === player, let player else {
                    return
                }

                self.publishProgress(currentTime: time, player: player)
            }
        }
    }

    private func publishProgress(currentTime: CMTime, player: AVPlayer) {
        guard !didFinishPlayback,
              let durationSeconds = finiteSeconds(player.currentItem?.duration),
              durationSeconds > 0 else {
            return
        }

        let currentSeconds = max(0, currentTime.seconds)
        let progress = min(max(currentSeconds / durationSeconds, 0), 1)
        guard progress >= 0.995 || progress - lastPublishedProgress >= minimumPublishedProgressDelta else {
            return
        }

        lastPublishedProgress = progress
        onProgress(progress)
    }

    private func finishPlayback(url: URL) {
        guard !didFinishPlayback else {
            return
        }

        didFinishPlayback = true
        isReadyForPlayback = true
        lastPublishedProgress = 1
        onProgress(1)
        MediaPerformance.mark("video_ended url=\(url.lastPathComponent)")
        onFinished()
    }

    private func handlePlaybackFailure(player: AVPlayer, url: URL, reason: String, error: Error? = nil) {
        logPlaybackFailure(player: player, url: url, reason: reason, error: error)
        retryPlaybackIfPossible(player: player, url: url, reason: reason)
    }

    private func retryPlaybackIfPossible(player: AVPlayer, url: URL, reason: String) {
        guard self.player === player,
              !isReadyForPlayback,
              !didFinishPlayback,
              activeURL != nil,
              playbackRetryCount < maxPlaybackRetries else {
            return
        }

        playbackRetryCount += 1
        let retryURL = activeURL ?? url
        MediaPerformance.mark("video_retry reason=\(reason) attempt=\(playbackRetryCount) url=\(url.lastPathComponent) retryUrl=\(retryURL.lastPathComponent)")
        cleanupCurrentPlayer(reason: nil)
        activeURL = retryURL
        activeHighQualityURL = nil
        isReadyForPlayback = false
        layerReadyForDisplay = false
        didFinishPlayback = false
        lastPublishedProgress = 0
        startPlayback(url: retryURL, highQualityUrl: nil, playerPool: nil)
    }

    private func logPlaybackFailure(player: AVPlayer, url: URL, reason: String, error: Error? = nil) {
        let nsError = (error ?? player.currentItem?.error) as NSError?
        var event = "video_stalled reason=\(reason) url=\(url.lastPathComponent)"

        if let nsError {
            event += " domain=\(nsError.domain) code=\(nsError.code)"
        }

        if let statusCode = player.currentItem?.errorLog()?.events.last?.errorStatusCode, statusCode > 0 {
            event += " status=\(statusCode)"
        }

        MediaPerformance.mark(event)
    }

    private func cleanupCurrentPlayer(reason: String?) {
        playTask?.cancel()
        playTask = nil
        revealTask?.cancel()
        revealTask = nil
        stallRecoveryTask?.cancel()
        stallRecoveryTask = nil

        if let stallObserver {
            NotificationCenter.default.removeObserver(stallObserver)
            self.stallObserver = nil
        }
        if let playbackFailureObserver {
            NotificationCenter.default.removeObserver(playbackFailureObserver)
            self.playbackFailureObserver = nil
        }
        if let playbackEndObserver {
            NotificationCenter.default.removeObserver(playbackEndObserver)
            self.playbackEndObserver = nil
        }

        removeTimeObserver()

        if let reason, let activeURL {
            MediaPerformance.mark("video_dismissed reason=\(reason) url=\(activeURL.lastPathComponent)")
        }

        player?.pause()
        player = nil
        isReadyForPlayback = false
        layerReadyForDisplay = false
        didFinishPlayback = false
        lastPublishedProgress = 0
        playbackStartedAt = nil
        startupMetadata = ""
        activePlaybackURL = nil
    }

    private func removeTimeObserver() {
        if let timeObserver, let timeObserverPlayer {
            timeObserverPlayer.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        timeObserverPlayer = nil
    }

    private func finiteSeconds(_ time: CMTime?) -> Double? {
        guard let time, time.isNumeric else {
            return nil
        }

        let seconds = time.seconds
        guard seconds.isFinite, seconds > 0 else {
            return nil
        }

        return seconds
    }
}

private struct AspectFillVideoPlayer: UIViewRepresentable {
    let player: AVPlayer?
    let onReadyForDisplay: () -> Void

    func makeUIView(context: Context) -> AspectFillPlayerView {
        AspectFillPlayerView()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func updateUIView(_ view: AspectFillPlayerView, context: Context) {
        view.player = player
        context.coordinator.observeReadyForDisplay(
            playerLayer: view.playerLayer,
            onReadyForDisplay: onReadyForDisplay
        )
    }

    final class Coordinator {
        private var observation: NSKeyValueObservation?

        func observeReadyForDisplay(
            playerLayer: AVPlayerLayer,
            onReadyForDisplay: @escaping () -> Void
        ) {
            observation?.invalidate()

            if playerLayer.isReadyForDisplay {
                onReadyForDisplay()
                return
            }

            observation = playerLayer.observe(
                \.isReadyForDisplay,
                options: [.new]
            ) { layer, _ in
                guard layer.isReadyForDisplay else {
                    return
                }

                Task { @MainActor in
                    onReadyForDisplay()
                }
            }
        }
    }
}

private final class AspectFillPlayerView: UIView {
    override static var layerClass: AnyClass {
        AVPlayerLayer.self
    }

    var playerLayer: AVPlayerLayer {
        layer as! AVPlayerLayer
    }

    var player: AVPlayer? {
        get { playerLayer.player }
        set { playerLayer.player = newValue }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        playerLayer.backgroundColor = UIColor.black.cgColor
        playerLayer.videoGravity = .resizeAspectFill
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .black
        playerLayer.backgroundColor = UIColor.black.cgColor
        playerLayer.videoGravity = .resizeAspectFill
    }
}
