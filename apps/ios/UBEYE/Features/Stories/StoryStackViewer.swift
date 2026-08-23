import AVKit
import SwiftUI
import UIKit

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

        stack = mergedStack
        if lastImpressionStoryId == nil {
            lastImpressionStoryId = mergedStack.items.first?.id
            impressionStartedAt = Date()
        }
        mediaEngine.prepare(stack: mergedStack, around: index, activeIdentity: nil)
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

struct StoryViewerPausePolicy {
    var sceneIsActive = true
    var isPressingPlayableVideo = false
    var isReplyFieldFocused = false
    var isRepliesSheetPresented = false
    var isSendingReply = false
    var hasReplyDraft = false

    var shouldPausePlayback: Bool {
        !sceneIsActive ||
            isPressingPlayableVideo ||
            isReplyFieldFocused ||
            isRepliesSheetPresented ||
            isSendingReply ||
            hasReplyDraft
    }

    static func isPressingPlayableVideo(
        assetKind: SocialAssetKind?,
        processingStatus: String?,
        isPressing: Bool
    ) -> Bool {
        guard isPressing, assetKind == .video else {
            return false
        }

        return processingStatus == nil || processingStatus == "ready"
    }
}

struct StoryStackViewer: View {
    let route: StoryRoute
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var mediaEngine: MediaEngine
    @EnvironmentObject private var pendingStoryUploads: PendingStoryUploadStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = StoryStackStore()
    @State private var storyTimerState = StoryTimerState()
    @State private var index = 0
    @State private var timedStoryId: String?
    @State private var videoReadyItemId: String?
    @State private var pendingFinishedVideoItemId: String?
    @State private var didFinishCurrentItem = false
    @State private var deleteConfirmationItem: StoryStackItem?
    @State private var isDeleteConfirmationPresented = false
    @State private var reportingItem: StoryStackItem?
    @State private var repliesSheetItem: StoryStackItem?
    @State private var confirmationDismissTask: Task<Void, Never>?
    @State private var reportConfirmationDismissTask: Task<Void, Never>?
    @State private var completionDismissTask: Task<Void, Never>?
    @State private var isClearingCompletedStory = false
    @State private var keyboardHeight: CGFloat = 0
    @GestureState private var isPressingStoryMedia = false
    @FocusState private var isReplyFieldFocused: Bool

    private let defaultStoryDurationSeconds: TimeInterval = 10
    private let maxVideoStoryDurationSeconds = TimeInterval(
        StoryMediaContract.maximumVideoDurationSeconds
    )
    private let storyAvatarSize: CGFloat = 42
    private let storyActionSize: CGFloat = 42
    private let ownerStatsHeight: CGFloat = 64
    private let replyComposerHeight: CGFloat = 46
    private let bottomChromeInset: CGFloat = 16
    private let bottomChromeScreenGap: CGFloat = 20
    private let keyboardComposerGap: CGFloat = 8
    private let topChromeGap: CGFloat = 10
    private let topChromeMinimumInset: CGFloat = 58
    private let storyCanvasCornerRadius: CGFloat = 18
    private let verticalSwipeMinimumDistance: CGFloat = 58
    private let verticalSwipeDominanceRatio: CGFloat = 1.15

    var body: some View {
        GeometryReader { proxy in
            let safeAreaInsets = resolvedSafeAreaInsets(proxy.safeAreaInsets)

            ZStack {
                Color.black

                if isClearingCompletedStory {
                    Color.black
                } else if store.isLoading && store.stack == nil {
                    ProgressView()
                        .tint(.white)
                } else if let error = store.error, store.stack == nil {
                    EmptyStateView(title: "Story unavailable", message: error, systemImage: "exclamationmark.triangle")
                        .padding()
                } else if let stack = store.stack, let item = stack.items[safe: index] {
                    let canvasLayout = StoryCanvasLayout(
                        containerSize: proxy.size,
                        reservedBottomHeight: storyCanvasReservedBottomHeight(
                            for: stack,
                            safeAreaBottom: safeAreaInsets.bottom
                        ),
                        fillsAvailableHeight: true
                    )

                    media(item)
                        .frame(
                            width: canvasLayout.frame.width,
                            height: canvasLayout.frame.height
                        )
                        .position(
                            x: canvasLayout.frame.midX,
                            y: canvasLayout.frame.midY
                        )
                        .clipShape(
                            RoundedRectangle(
                                cornerRadius: storyCanvasCornerRadius,
                                style: .continuous
                            )
                        )
                        .onAppear {
                            store.markActiveItem(item)
                            startStoryTimerIfNeeded(for: item)
                        }
                        .onDisappear {
                            Task { await store.recordImpression(item: item, completed: false, api: api) }
                        }

                    storyCanvasOverlay(item)
                        .frame(
                            width: canvasLayout.frame.width,
                            height: canvasLayout.frame.height
                        )
                        .position(
                            x: canvasLayout.frame.midX,
                            y: canvasLayout.frame.midY
                        )
                        .clipShape(
                            RoundedRectangle(
                                cornerRadius: storyCanvasCornerRadius,
                                style: .continuous
                            )
                        )
                        .zIndex(1)

                    tapNavigationOverlay(item: item, viewportWidth: proxy.size.width)
                        .frame(width: proxy.size.width, height: proxy.size.height)

                    storyChromeScrim(stack: stack)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .allowsHitTesting(false)

                    storyChrome(stack: stack, item: item, safeAreaInsets: safeAreaInsets)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .allowsHitTesting(true)
                        .zIndex(2)

                    if !isClearingCompletedStory {
                        storyBottomOverlayChrome(
                            stack: stack,
                            item: item,
                            safeAreaBottom: safeAreaInsets.bottom
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .zIndex(3)
                    }

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
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .ignoresSafeArea(.container, edges: .all)
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onAppear {
            mediaEngine.storyViewerDidAppear()
            AppAudioSession.configureForVideoPlayback()
        }
        .task {
            let storyOpenMetadata = "id=\(route.id) source=\(String(describing: route.source))"
            let stackLoadInterval = MediaPerformance.beginInterval("story_open phase=stack_load \(storyOpenMetadata)")
            await store.load(
                storyId: route.id,
                api: api,
                mediaEngine: mediaEngine,
                pendingUploads: route.id == "my-story" ? pendingStoryUploads : nil,
                account: auth.account
            )
            MediaPerformance.endInterval(
                stackLoadInterval,
                event: "story_open phase=stack_load \(storyOpenMetadata)",
                upload: false
            )
            MediaPerformance.measure("story_open \(storyOpenMetadata)", since: route.openedAt)
            if route.source != .ownStory {
                await store.loadFollows(api: api)
            }
            if let item = store.stack?.items[safe: index] {
                startStoryTimerIfNeeded(for: item)
            }
            if let stack = store.stack {
                mediaEngine.prepare(stack: stack, around: index, activeIdentity: nil)
            }
        }
        .onReceive(pendingStoryUploads.$uploads) { _ in
            guard route.id == "my-story" else {
                return
            }

            store.applyPendingUploads(
                pendingUploads: pendingStoryUploads,
                account: auth.account,
                mediaEngine: mediaEngine,
                around: index
            )
            index = min(index, max((store.stack?.items.count ?? 1) - 1, 0))
        }
        .onChange(of: shouldPauseVideoPlayback) { _, isPaused in
            guard !isPaused,
                  let pendingFinishedVideoItemId,
                  let item = store.stack?.items[safe: index],
                  item.id == pendingFinishedVideoItemId else {
                return
            }

            self.pendingFinishedVideoItemId = nil
            finishCurrentItem(item)
        }
        .onChange(of: store.replyConfirmation) { _, confirmation in
            scheduleConfirmationDismiss(for: confirmation)
        }
        .onChange(of: store.reportConfirmation) { _, confirmation in
            scheduleReportConfirmationDismiss(for: confirmation)
        }
        .onChange(of: shouldPauseStoryProgress) { _, isPaused in
            storyTimerState.setPaused(isPaused)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
            updateKeyboardHeight(from: notification)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { notification in
            updateKeyboardHeight(from: notification, forcedHeight: 0)
        }
        .onDisappear {
            confirmationDismissTask?.cancel()
            reportConfirmationDismissTask?.cancel()
            completionDismissTask?.cancel()
            storyTimerState.stop()
            mediaEngine.storyViewerDidDisappear()
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
                    source: item.playbackSource,
                    thumbnailUrl: item.playbackThumbnailUrl,
                    expectedDuration: displayDuration(for: item),
                    preloadSources: adjacentVideoSources(for: item),
                    playerPool: mediaEngine.storyVideoPlaybackPool,
                    showsThumbnailWhileLoading: true,
                    isPaused: shouldPauseVideoPlayback,
                    onReadyForPlayback: {
                        guard store.stack?.items[safe: index]?.id == item.id else {
                            return
                        }

                        startStoryTimerIfNeeded(for: item)
                        guard videoReadyItemId != item.id else {
                            return
                        }

                        videoReadyItemId = item.id
                        storyTimerState.resetForPlayerProgress()
                    },
                    onProgress: { progress in
                        updateVideoStoryProgress(progress, item: item)
                    },
                    onFinished: {
                        finishVideoStory(item)
                    }
                )
                .id(item.id)
            } else {
                CachedAsyncImage(url: item.playbackMediaUrl) { image in
                    StoryCanvasImage(image: image)
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
        if let thumbnailUrl = item.playbackThumbnailUrl {
            CachedAsyncImage(url: thumbnailUrl) { image in
                StoryCanvasImage(image: image)
            } placeholder: {
                Color.black
            }
        } else {
            ProgressView().tint(.white)
        }
    }

    private func storyChrome(stack: StoryStack, item: StoryStackItem, safeAreaInsets: EdgeInsets) -> some View {
        ZStack {
            storyTopChrome(stack: stack, item: item, safeAreaTop: safeAreaInsets.top)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

            if let confirmation = store.replyConfirmation {
                replyConfirmationToast(confirmation)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.horizontal, UBEYEMetrics.screenInset)
                    .padding(.bottom, replyConfirmationBottomInset(for: stack, safeAreaBottom: safeAreaInsets.bottom))
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if let confirmation = store.reportConfirmation {
                replyConfirmationToast(confirmation)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.horizontal, UBEYEMetrics.screenInset)
                    .padding(.bottom, replyConfirmationBottomInset(for: stack, safeAreaBottom: safeAreaInsets.bottom))
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if let error = store.error, !error.isEmpty {
                replyConfirmationToast(error)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.horizontal, UBEYEMetrics.screenInset)
                    .padding(.bottom, replyConfirmationBottomInset(for: stack, safeAreaBottom: safeAreaInsets.bottom))
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(.white)
    }

    private func storyChromeScrim(stack: StoryStack) -> some View {
        VStack(spacing: 0) {
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.56), location: 0),
                    .init(color: .black.opacity(0.32), location: 0.52),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 148)

            Spacer(minLength: 0)

            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .black.opacity(0.48), location: 0.5),
                    .init(color: .black.opacity(0.76), location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: isOwnStack(stack) || route.source == .discover ? 190 : 230)
        }
        .ignoresSafeArea()
        .compositingGroup()
    }

    private func storyTopChrome(stack: StoryStack, item: StoryStackItem, safeAreaTop: CGFloat) -> some View {
        VStack(spacing: 12) {
            storyProgressIndicator(stack: stack)
            storyHeader(stack: stack, item: item)
        }
        .padding(.horizontal, UBEYEMetrics.screenInset)
        .padding(.top, max(safeAreaTop + topChromeGap, topChromeMinimumInset))
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .top)
    }

    @ViewBuilder
    private func storyCanvasOverlay(_ item: StoryStackItem) -> some View {
        let overlays = item.textOverlays?.filter {
            !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        } ?? []

        if !overlays.isEmpty {
            GeometryReader { proxy in
                ForEach(overlays) { overlay in
                    storyOverlayChip(
                        overlay,
                        maxWidth: max(
                            proxy.size.width - StoryTextOverlayAppearance.horizontalScreenInset * 2,
                            120
                        )
                    )
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
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.horizontal, UBEYEMetrics.screenInset)
                .padding(.bottom, 24)
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
            .contentShape(
                RoundedRectangle(
                    cornerRadius: StoryTextOverlayAppearance.cornerRadius,
                    style: .continuous
                )
            )
            .zIndex(2)
        } else {
            storyOverlayChipContent(overlay, maxWidth: maxWidth)
        }
    }

    private func storyQuoteReplyOverlay(_ overlay: StoryTextOverlay) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let actorName = overlay.sourceActorName {
                HStack(spacing: 7) {
                    RemoteAvatar(
                        url: overlay.sourceActorAvatarUrl,
                        size: 22,
                        name: actorName
                    )

                    VStack(alignment: .leading, spacing: 0) {
                        Text(actorName)
                            .font(.system(size: 12, weight: .semibold))
                            .lineLimit(1)

                        if let handle = overlay.sourceActorHandle {
                            Text("@\(handle)")
                                .font(.system(size: 10, weight: .regular))
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                    }
                }
            }

            Text(overlay.label)
                .font(.system(size: 15, weight: .medium))
                .lineLimit(4)
                .multilineTextAlignment(.leading)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(width: 300, alignment: .leading)
        .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 14, y: 7)
    }

    private func storyOverlayChipContent(_ overlay: StoryTextOverlay, maxWidth: CGFloat) -> some View {
        HStack(spacing: 6) {
            if overlay.kind == "link" {
                Image(systemName: "link")
                    .font(.system(size: 13, weight: .semibold))
            }

            Text(overlay.label)
                .font(.system(size: StoryTextOverlayAppearance.fontSize, weight: .regular))
                .tracking(StoryTextOverlayAppearance.letterSpacing)
                .multilineTextAlignment(.center)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: maxWidth)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, StoryTextOverlayAppearance.horizontalPadding)
        .padding(.vertical, StoryTextOverlayAppearance.verticalPadding)
        .frame(maxWidth: maxWidth)
        .background(
            .black.opacity(0.46),
            in: RoundedRectangle(
                cornerRadius: StoryTextOverlayAppearance.cornerRadius,
                style: .continuous
            )
        )
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

    @ViewBuilder
    private func storyBottomOverlayChrome(stack: StoryStack, item: StoryStackItem, safeAreaBottom: CGFloat) -> some View {
        if bottomChromeHeight(for: stack) > 0 {
            storyBottomChrome(stack: stack, item: item)
                .frame(height: bottomChromeHeight(for: stack))
                .frame(maxWidth: .infinity)
                .padding(.horizontal, bottomChromeInset)
                .padding(.bottom, bottomChromeBottomPadding(safeAreaBottom: safeAreaBottom))
                .foregroundStyle(.white)
        }
    }

    private func bottomChromeBottomPadding(safeAreaBottom: CGFloat) -> CGFloat {
        if keyboardHeight > 0 {
            return keyboardHeight + keyboardComposerGap
        }

        return max(safeAreaBottom + 10, bottomChromeScreenGap)
    }

    private func bottomChromeHeight(for stack: StoryStack) -> CGFloat {
        if isOwnStack(stack) {
            return ownerStatsHeight
        }

        if route.source != .discover {
            return replyComposerHeight
        }

        return 0
    }

    private func storyCanvasReservedBottomHeight(
        for stack: StoryStack,
        safeAreaBottom: CGFloat
    ) -> CGFloat {
        let chromeHeight = bottomChromeHeight(for: stack)
        guard chromeHeight > 0 else {
            return 0
        }

        let restingBottomPadding = max(safeAreaBottom + 10, bottomChromeScreenGap)
        return chromeHeight + restingBottomPadding
    }

    private func replyConfirmationBottomInset(for stack: StoryStack, safeAreaBottom: CGFloat) -> CGFloat {
        let bottomPadding = bottomChromeBottomPadding(safeAreaBottom: safeAreaBottom)

        if isOwnStack(stack) || route.source == .discover {
            return bottomPadding
        }

        return bottomPadding + replyComposerHeight + 10
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
                            dismiss()
                        }
                    }
                },
                canUnfollowCreator: canUnfollowCreator(stack),
                unfollowCreator: {
                    Task { await store.unfollowCreator(api: api) }
                },
                close: {
                    Task { await store.recordImpression(item: item, completed: false, api: api) }
                    dismiss()
                }
            )
            .fixedSize()
        }
        .frame(maxWidth: .infinity, minHeight: storyAvatarSize, alignment: .leading)
    }

    private func deleteStory(_ item: StoryStackItem) async {
        if await store.delete(item: item, api: api) {
            dismiss()
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

    private func storyProgressIndicator(stack: StoryStack) -> some View {
        StoryTimelineProgressView(
            segmentCount: stack.items.count,
            activeIndex: index,
            progressState: storyTimerState.progressState
        )
        .frame(maxWidth: .infinity)
        .frame(height: 1.5)
        .transaction { transaction in
            transaction.animation = nil
            transaction.disablesAnimations = true
        }
        .accessibilityLabel("Story \(index + 1) of \(stack.items.count)")
    }

    private func tapNavigationOverlay(item: StoryStackItem, viewportWidth: CGFloat) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(storyNavigationGesture(item: item, viewportWidth: viewportWidth))
            .simultaneousGesture(pressToPauseGesture)
            .ignoresSafeArea()
    }

    private var pressToPauseGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .updating($isPressingStoryMedia) { _, isPressing, transaction in
                transaction.disablesAnimations = true
                isPressing = true
            }
    }

    private func storyNavigationGesture(item: StoryStackItem, viewportWidth: CGFloat) -> some Gesture {
        verticalStorySwipeGesture.exclusively(
            before: SpatialTapGesture().onEnded { value in
                guard repliesSheetItem == nil else {
                    return
                }
                let width = max(viewportWidth, 1)
                move(value.location.x < width / 2 ? -1 : 1, item: item)
            }
        )
    }

    private func replyComposer(_ item: StoryStackItem) -> some View {
        let fieldBackgroundOpacity = isReplyFieldFocused ? 0.62 : 0.48
        let fieldBorderOpacity = isReplyFieldFocused ? 0.24 : 0.16

        return HStack(spacing: 10) {
            TextField(
                "",
                text: $store.replyText,
                prompt: Text("Reply").foregroundStyle(.white.opacity(0.86))
            )
                .textFieldStyle(.plain)
                .font(.system(size: 16, weight: .semibold))
                .padding(.horizontal, 14)
                .frame(height: 46)
                .background(.black.opacity(fieldBackgroundOpacity), in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(.white.opacity(fieldBorderOpacity), lineWidth: 1)
                )
                .foregroundColor(.white)
                .foregroundStyle(.white)
                .tint(.white)
                .focused($isReplyFieldFocused)
                .lineLimit(1)
                .submitLabel(.send)
                .onSubmit {
                    submitReply(item)
                }
            Button {
                submitReply(item)
            } label: {
                Image(systemName: store.isSendingReply ? "hourglass" : "paperplane.fill")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(Color.ubeyeRed, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(store.isSendingReply || store.replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Send reply")
        }
    }

    private func submitReply(_ item: StoryStackItem) {
        Task {
            await store.sendReply(item: item, api: api)
            if store.replyConfirmation != nil || store.error != nil {
                isReplyFieldFocused = false
            }
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
            isReplyFieldFocused = true
            return
        }

        if route.source == .discover {
            dismissStoryFromSwipe(item: item)
        }
    }

    private func dismissStoryFromSwipe(item: StoryStackItem) {
        Task { await store.recordImpression(item: item, completed: false, api: api) }
        dismiss()
    }

    private func canReplyFromSwipe(_ stack: StoryStack) -> Bool {
        !isOwnStack(stack) && route.source != .discover && isFollowingCreator(stack)
    }

    private func move(_ delta: Int, item: StoryStackItem) {
        let nextIndex = min(max(index + delta, 0), max((store.stack?.items.count ?? 1) - 1, 0))
        guard nextIndex != index else {
            return
        }

        Task { await store.recordImpression(item: item, completed: delta > 0, api: api) }
        repliesSheetItem = nil
        index = nextIndex
        if let next = store.stack?.items[safe: index] {
            store.markActiveItem(next)
            resetStoryTimer(for: next)
            if let stack = store.stack {
                mediaEngine.prepare(
                    stack: stack,
                    around: index,
                    activeIdentity: next.isPlayableVideo ? next.playbackIdentity : nil
                )
            }
        }
    }

    private func adjacentVideoSources(
        for item: StoryStackItem
    ) -> [StoryVideoPlaybackSource] {
        guard let stack = store.stack,
              let itemIndex = stack.items.firstIndex(where: { $0.id == item.id }) else {
            return []
        }

        return adjacentVideoSources(in: stack, around: itemIndex)
    }

    private func adjacentVideoSources(
        in stack: StoryStack,
        around itemIndex: Int
    ) -> [StoryVideoPlaybackSource] {
        orderedNearbyStoryItems(in: stack, around: itemIndex)
            .filter(\.isPlayableVideo)
            .map(\.playbackSource)
    }

    private func orderedNearbyStoryItems(in stack: StoryStack, around itemIndex: Int) -> [StoryStackItem] {
        guard stack.items.indices.contains(itemIndex) else {
            return []
        }

        var seen = Set<Int>()
        return [itemIndex, itemIndex + 1, itemIndex - 1, itemIndex + 2]
            .filter { index in
                stack.items.indices.contains(index) && seen.insert(index).inserted
            }
            .map { stack.items[$0] }
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
        if item.assetKind == .video {
            storyTimerState.resetForPlayerProgress()
        } else {
            storyTimerState.reset()
            storyTimerState.start(
                duration: displayDuration(for: item),
                paused: shouldPauseStoryProgress
            ) {
                guard timedStoryId == item.id, !didFinishCurrentItem else {
                    return
                }
                finishCurrentItem(item)
            }
        }
        didFinishCurrentItem = false
        pendingFinishedVideoItemId = nil
    }

    private func updateVideoStoryProgress(_ progress: Double, item: StoryStackItem) {
        guard timedStoryId == item.id,
              videoReadyItemId == item.id,
              !didFinishCurrentItem else {
            return
        }

        let currentProgress = storyTimerState.playerProgress
        let nextProgress = max(currentProgress, min(max(progress, 0), 1))
        guard nextProgress >= 1 || abs(nextProgress - currentProgress) >= 0.001 else {
            return
        }

        storyTimerState.setPlayerProgress(nextProgress)
    }

    private func finishVideoStory(_ item: StoryStackItem) {
        guard timedStoryId == item.id else {
            return
        }

        guard !shouldPauseVideoPlayback else {
            pendingFinishedVideoItemId = item.id
            return
        }

        pendingFinishedVideoItemId = nil
        finishCurrentItem(item)
    }

    private func finishCurrentItem(_ item: StoryStackItem) {
        guard let stack = store.stack, !didFinishCurrentItem else {
            return
        }

        didFinishCurrentItem = true

        if index < stack.items.count - 1 {
            move(1, item: item)
        } else {
            Task { await store.recordImpression(item: item, completed: true, api: api) }
            dismissAfterClearingCompletedStory()
        }
    }

    private func dismissAfterClearingCompletedStory() {
        guard !isClearingCompletedStory else {
            return
        }

        isClearingCompletedStory = true
        completionDismissTask?.cancel()
        completionDismissTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(35))
            guard !Task.isCancelled else {
                return
            }
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

    private func updateKeyboardHeight(
        from notification: Notification,
        forcedHeight: CGFloat? = nil
    ) {
        let measuredHeight: CGFloat
        if let forcedHeight {
            measuredHeight = forcedHeight
        } else {
            guard let endFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
                return
            }
            measuredHeight = max(0, UIScreen.main.bounds.maxY - endFrame.minY)
        }

        let height = measuredHeight > 1 ? measuredHeight : 0
        let duration = (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
        let curve = (notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber)?.intValue ?? 0
        setKeyboardHeight(height, duration: duration, curve: curve)
    }

    private func setKeyboardHeight(
        _ height: CGFloat,
        duration: TimeInterval,
        curve: Int
    ) {
        let animation: Animation = switch curve {
        case 1:
            .easeIn(duration: duration)
        case 2:
            .easeOut(duration: duration)
        case 3:
            .linear(duration: duration)
        default:
            .easeInOut(duration: duration)
        }
        withAnimation(animation) {
            keyboardHeight = height
        }
    }

    private func resolvedSafeAreaInsets(_ insets: EdgeInsets) -> EdgeInsets {
        let fallback = Self.activeWindowSafeAreaInsets

        return EdgeInsets(
            top: insets.top > 0 ? insets.top : fallback.top,
            leading: insets.leading > 0 ? insets.leading : fallback.left,
            bottom: insets.bottom > 0 ? insets.bottom : fallback.bottom,
            trailing: insets.trailing > 0 ? insets.trailing : fallback.right
        )
    }

    private static var activeWindowSafeAreaInsets: UIEdgeInsets {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let foregroundScene = scenes.first { $0.activationState == .foregroundActive }
        let scene = foregroundScene ?? scenes.first
        return scene?.windows.first(where: \.isKeyWindow)?.safeAreaInsets ?? .zero
    }

    private var shouldPauseStoryProgress: Bool {
        shouldPauseVideoPlayback ||
            isWaitingForCurrentVideo
    }

    private var shouldPauseVideoPlayback: Bool {
        StoryViewerPausePolicy(
            sceneIsActive: scenePhase == .active,
            isPressingPlayableVideo: isPressingCurrentVideo,
            isReplyFieldFocused: isReplyFieldFocused,
            isRepliesSheetPresented: repliesSheetItem != nil,
            isSendingReply: store.isSendingReply,
            hasReplyDraft: !store.replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ).shouldPausePlayback
    }

    private var isPressingCurrentVideo: Bool {
        let item = store.stack?.items[safe: index]
        return StoryViewerPausePolicy.isPressingPlayableVideo(
            assetKind: item?.assetKind,
            processingStatus: item?.processingStatus,
            isPressing: isPressingStoryMedia
        )
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

@MainActor
private final class StoryTimerProgressState: ObservableObject {
    @Published fileprivate(set) var visibleProgress = 0.0
}

@MainActor
private final class StoryTimerState {
    let progressState = StoryTimerProgressState()
    var startedAt = Date()
    private(set) var playerProgress = 0.0
    private var usesPlayerProgress = false
    private var displayLink: CADisplayLink?
    private var displayDuration: TimeInterval = 1
    private var isPaused = false
    private var onFinished: (() -> Void)?

    private var visibleProgress: Double {
        get { progressState.visibleProgress }
        set { progressState.visibleProgress = newValue }
    }

    func reset(at date: Date = Date()) {
        stop()
        startedAt = date
        playerProgress = 0
        usesPlayerProgress = false
        visibleProgress = 0
    }

    func resetForPlayerProgress(at date: Date = Date()) {
        stop()
        startedAt = date
        playerProgress = 0
        usesPlayerProgress = true
        visibleProgress = 0
    }

    func start(
        duration: TimeInterval,
        paused: Bool,
        onFinished: @escaping () -> Void
    ) {
        stop()
        usesPlayerProgress = false
        displayDuration = max(duration, 0.001)
        startedAt = Date().addingTimeInterval(-visibleProgress * displayDuration)
        isPaused = paused
        self.onFinished = onFinished

        let displayLink = CADisplayLink(target: self, selector: #selector(displayLinkDidFire(_:)))
        displayLink.preferredFrameRateRange = CAFrameRateRange(
            minimum: 30,
            maximum: 120,
            preferred: 120
        )
        displayLink.isPaused = paused
        displayLink.add(to: .main, forMode: .common)
        self.displayLink = displayLink
    }

    func setPaused(_ paused: Bool, at date: Date = Date()) {
        guard paused != isPaused else {
            return
        }

        if paused, !usesPlayerProgress {
            visibleProgress = progress(at: date, duration: displayDuration)
        } else if !paused, !usesPlayerProgress {
            startedAt = date.addingTimeInterval(-visibleProgress * displayDuration)
        }

        isPaused = paused
        displayLink?.isPaused = paused
    }

    func stop() {
        displayLink?.invalidate()
        displayLink = nil
        onFinished = nil
        isPaused = false
    }

    func setPlayerProgress(_ progress: Double) {
        usesPlayerProgress = true
        playerProgress = max(playerProgress, Self.clamped(progress))
        visibleProgress = playerProgress
    }

    func progress(at date: Date, duration: TimeInterval) -> Double {
        if usesPlayerProgress {
            return playerProgress
        }

        guard duration > 0 else {
            return 1
        }

        return Self.clamped(date.timeIntervalSince(startedAt) / duration)
    }

    func align(progress: Double, duration: TimeInterval, at date: Date) {
        usesPlayerProgress = false
        startedAt = date.addingTimeInterval(-Self.clamped(progress) * max(duration, 0.001))
    }

    @objc private func displayLinkDidFire(_ displayLink: CADisplayLink) {
        guard !usesPlayerProgress, !isPaused else {
            return
        }

        let nextProgress = progress(at: Date(), duration: displayDuration)
        visibleProgress = nextProgress
        guard nextProgress >= 1 else {
            return
        }

        let completion = onFinished
        stop()
        completion?()
    }

    private static func clamped(_ value: Double) -> Double {
        min(max(value, 0), 1)
    }
}

private struct StoryTimelineProgressView: View {
    let segmentCount: Int
    let activeIndex: Int
    @ObservedObject var progressState: StoryTimerProgressState

    private let segmentSpacing: CGFloat = 3

    var body: some View {
        Canvas { context, size in
            drawProgress(
                in: context,
                size: size,
                activeProgress: progressState.visibleProgress
            )
        }
    }

    private func drawProgress(
        in context: GraphicsContext,
        size: CGSize,
        activeProgress: Double
    ) {
        let count = max(segmentCount, 0)
        guard count > 0, size.width > 0, size.height > 0 else {
            return
        }

        let safeActiveIndex = min(max(activeIndex, 0), count - 1)
        let totalSpacing = segmentSpacing * CGFloat(max(count - 1, 0))
        let segmentWidth = max(0, (size.width - totalSpacing) / CGFloat(count))
        let cornerRadius = size.height / 2
        for index in 0..<count {
            let originX = CGFloat(index) * (segmentWidth + segmentSpacing)
            let frame = CGRect(x: originX, y: 0, width: segmentWidth, height: size.height)
            let backgroundPath = Path(roundedRect: frame, cornerRadius: cornerRadius)
            context.fill(backgroundPath, with: .color(.white.opacity(0.28)))

            let fillProgress: Double
            if index < safeActiveIndex {
                fillProgress = 1
            } else if index == safeActiveIndex {
                fillProgress = activeProgress
            } else {
                fillProgress = 0
            }

            guard fillProgress > 0 else {
                continue
            }

            let fillFrame = CGRect(
                x: frame.minX,
                y: frame.minY,
                width: frame.width * CGFloat(min(max(fillProgress, 0), 1)),
                height: frame.height
            )
            let fillPath = Path(roundedRect: fillFrame, cornerRadius: cornerRadius)
            context.fill(fillPath, with: .color(.white.opacity(0.96)))
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
                        .font(.system(size: 16, weight: .semibold))
                    Text("\(count) total")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.white.opacity(0.58))
                }

                Spacer()

                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
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
                .font(.system(size: 12, weight: .medium))
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
                .font(.system(size: 14, weight: .semibold))
            Text("Replies to this story will appear here.")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(.white.opacity(0.55))
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, minHeight: 150)
        .padding(.horizontal, 24)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 10) {
            Text(message)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.72))
                .multilineTextAlignment(.center)

            Button(action: retry) {
                Label("Try again", systemImage: "arrow.clockwise")
                    .font(.system(size: 12, weight: .semibold))
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
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)

                    Text("@\(reply.actor.handle)")
                        .font(.system(size: 10, weight: .regular))
                        .foregroundStyle(.white.opacity(0.5))
                        .lineLimit(1)

                    Spacer(minLength: 6)

                    Text(storyReplyTimestamp(reply.createdAt))
                        .font(.system(size: 10, weight: .regular))
                        .foregroundStyle(.white.opacity(0.5))
                        .lineLimit(1)
                }

                Text(reply.body ?? reply.reaction ?? "Reply")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(.white.opacity(0.88))
                    .fixedSize(horizontal: false, vertical: true)

                if reply.mediaUrl != nil {
                    Label("Media reply", systemImage: "photo")
                        .font(.system(size: 10, weight: .medium))
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

struct AutoPlayVideoPlayer: View {
    let source: StoryVideoPlaybackSource
    let thumbnailUrl: URL?
    let expectedDuration: TimeInterval?
    let preloadSources: [StoryVideoPlaybackSource]
    let playerPool: StoryVideoPlaybackPool?
    let showsThumbnailWhileLoading: Bool
    let isPaused: Bool
    let onReadyForPlayback: () -> Void
    let onProgress: (Double) -> Void
    let onFinished: () -> Void
    @StateObject private var playback = AutoPlayVideoPlaybackController()

    init(
        source: StoryVideoPlaybackSource,
        thumbnailUrl: URL? = nil,
        expectedDuration: TimeInterval? = nil,
        preloadSources: [StoryVideoPlaybackSource] = [],
        playerPool: StoryVideoPlaybackPool? = nil,
        showsThumbnailWhileLoading: Bool = true,
        isPaused: Bool = false,
        onReadyForPlayback: @escaping () -> Void = {},
        onProgress: @escaping (Double) -> Void = { _ in },
        onFinished: @escaping () -> Void = {}
    ) {
        self.source = source
        self.thumbnailUrl = thumbnailUrl
        self.expectedDuration = expectedDuration
        self.preloadSources = preloadSources
        self.playerPool = playerPool
        self.showsThumbnailWhileLoading = showsThumbnailWhileLoading
        self.isPaused = isPaused
        self.onReadyForPlayback = onReadyForPlayback
        self.onProgress = onProgress
        self.onFinished = onFinished
    }

    var body: some View {
        ZStack {
            Color.black

            FullBleedVideoPlayer(
                player: playback.player,
                onPlayerAttached: { player in
                    playback.playerDidAttach(player)
                },
                onReadyForDisplay: { player in
                    playback.revealVideo(player: player, reason: "layer_ready")
                }
            )
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            if showsThumbnailWhileLoading, !playback.isReadyForPlayback, let thumbnailUrl {
                CachedAsyncImage(url: thumbnailUrl) { image in
                    StoryCanvasImage(image: image)
                } placeholder: {
                    Color.black
                }
                .transition(
                    .asymmetric(
                        insertion: .identity,
                        removal: .opacity.animation(.easeOut(duration: 0.08))
                    )
                )
                .zIndex(1)
            }

            if playback.hasTerminalPlaybackFailure {
                Button {
                    playback.retry(playerPool: playerPool)
                } label: {
                    Label("Retry video", systemImage: "arrow.clockwise")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .background(.black.opacity(0.72), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Attempts to load this video again")
                .zIndex(2)
            }
        }
        .background(Color.black)
        .onAppear {
            playerPool?.prepare(
                sources: [source] + preloadSources,
                activeIdentity: source.identity
            )
            playback.play(
                source: source,
                expectedDuration: expectedDuration,
                playerPool: playerPool,
                isPaused: isPaused,
                onReadyForPlayback: onReadyForPlayback,
                onProgress: onProgress,
                onFinished: onFinished
            )
        }
        .onChange(of: source) { _, nextSource in
            playerPool?.prepare(
                sources: [nextSource] + preloadSources,
                activeIdentity: nextSource.identity
            )
            playback.play(
                source: nextSource,
                expectedDuration: expectedDuration,
                playerPool: playerPool,
                isPaused: isPaused,
                onReadyForPlayback: onReadyForPlayback,
                onProgress: onProgress,
                onFinished: onFinished
            )
        }
        .onChange(of: preloadSources) { _, nextSources in
            playerPool?.prepare(
                sources: [source] + nextSources,
                activeIdentity: source.identity
            )
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
    private enum PlaybackPhase: Equatable {
        case idle
        case resolving
        case awaitingAttachment
        case positioning
        case prerolling
        case awaitingFirstFrame
        case visible
        case finished
    }

    @Published private(set) var player: AVPlayer?
    @Published private(set) var isReadyForPlayback = false
    @Published private(set) var hasTerminalPlaybackFailure = false

    private var activeIdentity: String?
    private var activeURL: URL?
    private var activePlaybackURL: URL?
    private var expectedDurationSeconds: TimeInterval?
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
    private var seekTask: Task<Void, Never>?
    private var stallRecoveryTask: Task<Void, Never>?
    private var playbackStartedAt: Date?
    private var startupInterval: MediaPerformance.Interval?
    private var startupMetadata = ""
    private var onReadyForPlayback: () -> Void = {}
    private var onProgress: (Double) -> Void = { _ in }
    private var onFinished: () -> Void = {}
    private var playbackRetryCount = 0
    private var layerReadyForDisplay = false
    private var didUploadAccessLog = false
    private var playbackPhase = PlaybackPhase.idle
    private var playbackGeneration = 0
    private var revealTargetSeconds: TimeInterval = 0
    private let maxPlaybackRetries = 2

    func play(
        source: StoryVideoPlaybackSource,
        expectedDuration: TimeInterval?,
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
        let nextExpectedDurationSeconds = expectedDuration.map { max(0.001, $0) }

        if source.representsSameMedia(as: activePlaybackSource),
           playbackPhase != .idle,
           !hasTerminalPlaybackFailure {
            activeURL = source.url
            expectedDurationSeconds = nextExpectedDurationSeconds
            setPaused(isPaused)
            return
        }

        cleanupCurrentPlayer(reason: activeIdentity == nil ? nil : "replace")
        activeIdentity = source.identity
        activeURL = source.url
        expectedDurationSeconds = nextExpectedDurationSeconds
        playbackRetryCount = 0
        isReadyForPlayback = false
        hasTerminalPlaybackFailure = false
        layerReadyForDisplay = false
        didFinishPlayback = false
        didUploadAccessLog = false
        lastPublishedProgress = 0
        startPlayback(
            source: source,
            playerPool: playerPool
        )
    }

    private func startPlayback(
        source: StoryVideoPlaybackSource,
        playerPool: StoryVideoPlaybackPool?,
        resumeTimeSeconds: TimeInterval? = nil
    ) {
        let url = source.url
        playTask?.cancel()
        revealTask?.cancel()
        revealTask = nil
        seekTask?.cancel()
        seekTask = nil
        playbackGeneration += 1
        let generation = playbackGeneration
        playbackPhase = .resolving
        revealTargetSeconds = resumeTimeSeconds.flatMap { value in
            value.isFinite ? max(0, value) : nil
        } ?? 0
        playTask = Task { @MainActor in
            let startedAt = Date()
            playbackStartedAt = startedAt
            let startupInterval = MediaPerformance.beginInterval("video_startup url=\(url.lastPathComponent)")
            self.startupInterval = startupInterval
            startupMetadata = "url=\(url.lastPathComponent)"
            let selected = MediaPlaybackQuality.preferredPlaybackURL(defaultURL: url)
            let selectedSource = StoryVideoPlaybackSource(
                identity: source.identity,
                url: selected.url
            )
            let prepared = await playerPool?.takePreparedPlayer(for: selectedSource)
            let resolved = prepared == nil ? await resolvePlaybackURL(for: selected.url) : nil

            guard self.isCurrentPlayback(
                generation: generation,
                identity: source.identity
            ),
                  !Task.isCancelled else {
                prepared?.player.pause()
                return
            }

            let playbackURL = prepared?.playbackURL ?? resolved?.playbackURL ?? selected.url
            activePlaybackURL = playbackURL
            let delivery = playbackDelivery(for: selected.url)
            let cacheState = prepared?.cacheState ?? resolved?.cacheState ?? "miss"
            let playerSource = prepared == nil ? "fresh" : "pooled"
            startupMetadata = "delivery=\(delivery) cache=\(cacheState) source=\(playerSource) quality=\(selected.quality) url=\(selected.url.lastPathComponent)"
            MediaPerformance.mark("video_startup \(startupMetadata)")

            if cacheState == "hit" {
                MediaPerformance.mark("video_disk_cache_hit state=\(cacheState) quality=\(selected.quality) url=\(selected.url.lastPathComponent)")
            }

            player?.pause()
            let next = prepared?.player ?? makeFreshPlayer(playbackURL: playbackURL)
            next.pause()
            next.isMuted = true
            player = next
            playbackPhase = .awaitingAttachment
            observeReadiness(
                player: next,
                url: selected.url,
                startedAt: startedAt,
                generation: generation,
                source: playerSource
            )
            observeStalls(player: next, url: selected.url, generation: generation)
            observeFailures(player: next, url: selected.url, generation: generation)
            observeCompletion(player: next, url: selected.url, generation: generation)
            observeProgress(player: next, generation: generation)
        }
    }

    func playerDidAttach(_ attachedPlayer: AVPlayer) {
        guard player === attachedPlayer,
              playbackPhase == .awaitingAttachment else {
            return
        }

        let generation = playbackGeneration
        playbackPhase = .positioning
        let targetSeconds = revealTargetSeconds
        attachedPlayer.pause()
        seekTask?.cancel()
        seekTask = Task { @MainActor [weak self, weak attachedPlayer] in
            guard let self, let attachedPlayer else {
                return
            }

            let isReadyToPosition = await self.waitUntilReadyToPreroll(
                player: attachedPlayer,
                generation: generation
            )
            guard isReadyToPosition,
                  !Task.isCancelled,
                  self.isCurrentPlayer(attachedPlayer, generation: generation) else {
                if self.isCurrentPlayer(attachedPlayer, generation: generation),
                   let activeURL = self.activeURL {
                    self.recoverOrFail(
                        player: attachedPlayer,
                        url: activeURL,
                        reason: "preroll_readiness_timeout"
                    )
                }
                return
            }

            let currentSeconds = attachedPlayer.currentTime().seconds
            let needsSeek = !currentSeconds.isFinite || abs(currentSeconds - targetSeconds) > 0.05
            if needsSeek {
                let didSeek = await Self.seek(
                    player: attachedPlayer,
                    to: targetSeconds
                )
                guard didSeek,
                      !Task.isCancelled,
                      self.isCurrentPlayer(attachedPlayer, generation: generation) else {
                    if self.isCurrentPlayer(attachedPlayer, generation: generation),
                       let activeURL = self.activeURL {
                        self.recoverOrFail(
                            player: attachedPlayer,
                            url: activeURL,
                            reason: "reveal_position_failed"
                        )
                    }
                    return
                }
            }

            let isReadyToPreroll = await self.waitUntilReadyToPreroll(
                player: attachedPlayer,
                generation: generation
            )
            guard isReadyToPreroll,
                  !Task.isCancelled,
                  self.isCurrentPlayer(attachedPlayer, generation: generation) else {
                if self.isCurrentPlayer(attachedPlayer, generation: generation),
                   let activeURL = self.activeURL {
                    self.recoverOrFail(
                        player: attachedPlayer,
                        url: activeURL,
                        reason: "preroll_readiness_lost"
                    )
                }
                return
            }

            self.playbackPhase = .prerolling
            attachedPlayer.pause()
            let didPreroll = await attachedPlayer.preroll(atRate: 1)
            guard didPreroll,
                  !Task.isCancelled,
                  self.isCurrentPlayer(attachedPlayer, generation: generation) else {
                if self.isCurrentPlayer(attachedPlayer, generation: generation),
                   let activeURL = self.activeURL {
                    self.recoverOrFail(
                        player: attachedPlayer,
                        url: activeURL,
                        reason: "preroll_failed"
                    )
                }
                return
            }

            self.seekTask = nil
            self.playbackPhase = .awaitingFirstFrame
            MediaPerformance.mark(
                "video_prerolled position_ms=\(Int(targetSeconds * 1_000))"
            )
            if self.layerReadyForDisplay {
                self.attemptRevealVideo(reason: "prerolled")
            }
        }
    }

    func retry(playerPool: StoryVideoPlaybackPool?) {
        guard let activeIdentity, let activeURL else {
            return
        }

        let source = StoryVideoPlaybackSource(
            identity: activeIdentity,
            url: activeURL
        )
        let expectedDuration = expectedDurationSeconds
        cleanupCurrentPlayer(reason: nil)
        self.activeIdentity = activeIdentity
        self.activeURL = activeURL
        expectedDurationSeconds = expectedDuration
        playbackRetryCount = 0
        hasTerminalPlaybackFailure = false
        didFinishPlayback = false
        lastPublishedProgress = 0
        startPlayback(source: source, playerPool: playerPool)
    }

    private func updatePlaybackState(for player: AVPlayer) {
        guard self.player === player else {
            return
        }

        guard !isPaused, !didFinishPlayback else {
            player.pause()
            return
        }

        switch playbackPhase {
        case .awaitingFirstFrame:
            player.isMuted = true
            player.pause()
        case .visible:
            player.isMuted = false
            player.play()
        default:
            player.pause()
        }
    }

    private func makeFreshPlayer(playbackURL: URL) -> AVPlayer {
        let item = AVPlayerItem(url: playbackURL)
        item.preferredForwardBufferDuration = 4
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = true
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

        item.preferredPeakBitRate = MediaPlaybackQuality.preferredStreamingPeakBitRate
        item.preferredMaximumResolution = MediaPlaybackQuality.preferredStreamingMaximumResolution
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

        updatePlaybackState(for: player)
    }

    func stop(reason: String) {
        cleanupCurrentPlayer(reason: reason)
        activeIdentity = nil
        activeURL = nil
    }

    private func observeReadiness(
        player: AVPlayer,
        url: URL,
        startedAt: Date,
        generation: Int,
        source: String
    ) {
        revealTask?.cancel()
        revealTask = Task { @MainActor in
            var didLogItemReady = false
            var elapsedUnpausedSeconds: TimeInterval = 0
            let timeoutSeconds: TimeInterval = 4

            while elapsedUnpausedSeconds < timeoutSeconds {
                guard self.isCurrentPlayer(player, generation: generation),
                      !Task.isCancelled else {
                    return
                }

                if self.isReadyForPlayback {
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

                if !self.isPaused {
                    switch self.playbackPhase {
                    case .positioning, .prerolling, .awaitingFirstFrame:
                        elapsedUnpausedSeconds += 0.05
                    default:
                        break
                    }
                }
                try? await Task.sleep(for: .milliseconds(50))
            }

            guard self.isCurrentPlayer(player, generation: generation),
                  !Task.isCancelled,
                  !isReadyForPlayback else {
                return
            }

            recoverOrFail(
                player: player,
                url: url,
                reason: "first_frame_timeout_\(source)"
            )
        }
    }

    func revealVideo(player: AVPlayer, reason: String) {
        guard self.player === player,
              !isReadyForPlayback else {
            return
        }

        layerReadyForDisplay = true

        guard playbackPhase != .awaitingAttachment,
              playbackPhase != .positioning else {
            return
        }

        attemptRevealVideo(reason: reason)
        if !isReadyForPlayback, playbackPhase == .awaitingFirstFrame {
            updatePlaybackState(for: player)
        }
    }

    private func attemptRevealVideo(reason: String) {
        guard !isReadyForPlayback,
              playbackPhase == .awaitingFirstFrame,
              layerReadyForDisplay,
              let player else {
            return
        }

        guard isPlayerReadyToReveal else {
            return
        }

        let generation = playbackGeneration
        completeReveal(
            player: player,
            generation: generation,
            reason: reason,
            hiddenAdvanceSeconds: 0
        )
    }

    private func completeReveal(
        player: AVPlayer,
        generation: Int,
        reason: String,
        hiddenAdvanceSeconds: TimeInterval
    ) {
        guard isCurrentPlayer(player, generation: generation),
              !isReadyForPlayback else {
            return
        }

        let startedAt = playbackStartedAt ?? Date()
        playbackPhase = .visible
        isReadyForPlayback = true
        MediaPlaybackQuality.relaxStreamingHints(
            for: player.currentItem,
            playbackURL: activePlaybackURL
        )
        onReadyForPlayback()
        let metadata = startupMetadata.isEmpty
            ? "url=\(activeURL?.lastPathComponent ?? "unknown")"
            : startupMetadata
        let displayedSeconds = player.currentTime().seconds
        let finiteDisplayedSeconds = displayedSeconds.isFinite
            ? max(0, displayedSeconds)
            : revealTargetSeconds
        let positionMilliseconds = Int(finiteDisplayedSeconds * 1_000)
        let hiddenMilliseconds = Int(max(0, hiddenAdvanceSeconds) * 1_000)
        let firstFrameEvent = "video_first_frame reason=\(reason) position_ms=\(positionMilliseconds) hidden_ms=\(hiddenMilliseconds) \(metadata)"
        if let startupInterval {
            MediaPerformance.endInterval(startupInterval, event: firstFrameEvent)
            self.startupInterval = nil
        } else {
            MediaPerformance.measure(firstFrameEvent, since: startedAt)
        }
        updatePlaybackState(for: player)
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

        let currentTime = player?.currentTime().seconds ?? 0
        let bufferedAhead = item.loadedTimeRanges
            .map(\.timeRangeValue)
            .compactMap { range -> TimeInterval? in
                let start = range.start.seconds
                let end = start + range.duration.seconds
                guard start.isFinite,
                      end.isFinite,
                      currentTime.isFinite,
                      currentTime + 0.05 >= start,
                      currentTime <= end else {
                    return nil
                }

                return max(0, end - currentTime)
            }
            .max() ?? 0
        return bufferedAhead >= 0.75
    }

    private func observeStalls(player: AVPlayer, url: URL, generation: Int) {
        if let stallObserver {
            NotificationCenter.default.removeObserver(stallObserver)
        }

        stallObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemPlaybackStalled,
            object: player.currentItem,
            queue: .main
        ) { [weak self, weak player] _ in
            Task { @MainActor in
                guard let self,
                      let player,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                let phase = self.isReadyForPlayback ? "playing" : "startup"
                MediaPerformance.mark("video_stalled phase=\(phase) url=\(url.lastPathComponent)")
                self.monitorStallRecovery(
                    player: player,
                    url: url,
                    generation: generation
                )
            }
        }
    }

    private func monitorStallRecovery(player: AVPlayer, url: URL, generation: Int) {
        stallRecoveryTask?.cancel()
        stallRecoveryTask = Task { @MainActor in
            let stalledAt = Date()
            let stalledTime = player.currentTime().seconds
            var recoveryChecks = 0

            while recoveryChecks < 70 {
                guard self.isCurrentPlayer(player, generation: generation),
                      !Task.isCancelled else {
                    return
                }

                if self.isPaused {
                    try? await Task.sleep(for: .milliseconds(50))
                    continue
                }
                recoveryChecks += 1

                let currentTime = player.currentTime().seconds
                let playbackAdvanced = stalledTime.isFinite &&
                    currentTime.isFinite &&
                    currentTime - stalledTime >= 0.05
                if player.currentItem?.isPlaybackLikelyToKeepUp == true || playbackAdvanced {
                    MediaPerformance.measure(
                        "video_recovered reason=stall url=\(url.lastPathComponent)",
                        since: stalledAt
                    )
                    if self.isReadyForPlayback {
                        self.updatePlaybackState(for: player)
                    } else {
                        self.attemptRevealVideo(reason: "stall_recovered")
                        self.updatePlaybackState(for: player)
                    }
                    return
                }

                try? await Task.sleep(for: .milliseconds(50))
            }

            guard self.isCurrentPlayer(player, generation: generation),
                  !Task.isCancelled else {
                return
            }

            logPlaybackFailure(player: player, url: url, reason: "stall_recovery_timeout")
            recoverOrFail(player: player, url: url, reason: "stall_recovery_timeout")
        }
    }

    private func observeFailures(player: AVPlayer, url: URL, generation: Int) {
        if let playbackFailureObserver {
            NotificationCenter.default.removeObserver(playbackFailureObserver)
        }

        playbackFailureObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: player.currentItem,
            queue: .main
        ) { [weak self, weak player] notification in
            Task { @MainActor in
                guard let self,
                      let player,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                self.handlePlaybackFailure(player: player, url: url, reason: "failed_to_end", error: error)
            }
        }
    }

    private func observeCompletion(player: AVPlayer, url: URL, generation: Int) {
        if let playbackEndObserver {
            NotificationCenter.default.removeObserver(playbackEndObserver)
        }

        playbackEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: player.currentItem,
            queue: .main
        ) { [weak self, weak player] _ in
            Task { @MainActor in
                guard let self,
                      let player,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                self.finishPlayback(player: player, url: url)
            }
        }
    }

    private func observeProgress(player: AVPlayer, generation: Int) {
        removeTimeObserver()

        let interval = CMTime(value: 1, timescale: 60)
        timeObserverPlayer = player
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self, weak player] time in
            Task { @MainActor in
                guard let self,
                      let player,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                self.publishProgress(currentTime: time, player: player)
            }
        }
    }

    private func publishProgress(currentTime: CMTime, player: AVPlayer) {
        guard isReadyForPlayback,
              playbackPhase == .visible,
              !didFinishPlayback,
              let durationSeconds = finiteSeconds(player.currentItem?.duration) ?? expectedDurationSeconds,
              durationSeconds > 0 else {
            return
        }

        let currentSeconds = currentTime.seconds.isFinite ? max(0, currentTime.seconds) : 0
        let progress = min(max(currentSeconds / durationSeconds, 0), 1)
        guard progress >= 0.995 || abs(progress - lastPublishedProgress) >= 0.001 else {
            return
        }

        lastPublishedProgress = progress
        onProgress(progress)
    }

    private func finishPlayback(player: AVPlayer, url: URL) {
        guard !didFinishPlayback else {
            return
        }

        guard isReadyForPlayback, playbackPhase == .visible else {
            player.pause()
            MediaPerformance.mark(
                "video_ended_before_first_frame attempt=\(playbackRetryCount) url=\(url.lastPathComponent)"
            )
            recoverOrFail(
                player: player,
                url: url,
                reason: "ended_before_first_frame"
            )
            return
        }

        didFinishPlayback = true
        playbackPhase = .finished
        lastPublishedProgress = 1
        onProgress(1)
        MediaPerformance.mark("video_ended url=\(url.lastPathComponent)")
        onFinished()
    }

    private func handlePlaybackFailure(player: AVPlayer, url: URL, reason: String, error: Error? = nil) {
        logPlaybackFailure(player: player, url: url, reason: reason, error: error)
        recoverOrFail(player: player, url: url, reason: reason)
    }

    private func recoverOrFail(player: AVPlayer, url: URL, reason: String) {
        guard !retryPlaybackIfPossible(player: player, url: url, reason: reason) else {
            return
        }

        markTerminalPlaybackFailure(player: player, url: url, reason: reason)
    }

    private func markTerminalPlaybackFailure(player: AVPlayer, url: URL, reason: String) {
        guard self.player === player else {
            return
        }

        player.pause()
        player.isMuted = true
        revealTask?.cancel()
        revealTask = nil
        seekTask?.cancel()
        seekTask = nil
        stallRecoveryTask?.cancel()
        stallRecoveryTask = nil
        didFinishPlayback = true
        playbackPhase = .idle
        isReadyForPlayback = false
        hasTerminalPlaybackFailure = true
        if let startupInterval {
            MediaPerformance.cancelInterval(startupInterval, reason: "terminal_\(reason)")
            self.startupInterval = nil
        }
        MediaPerformance.mark(
            "video_terminal_failure reason=\(reason) attempts=\(playbackRetryCount) url=\(url.lastPathComponent)"
        )
    }

    @discardableResult
    private func retryPlaybackIfPossible(player: AVPlayer, url: URL, reason: String) -> Bool {
        guard self.player === player,
              !didFinishPlayback,
              let retryIdentity = activeIdentity,
              let retryURL = activeURL,
              playbackRetryCount < maxPlaybackRetries else {
            return false
        }

        let resumeTimeSeconds = isReadyForPlayback ? player.currentTime().seconds : nil
        let expectedDuration = expectedDurationSeconds
        let publishedProgress = lastPublishedProgress
        playbackRetryCount += 1
        let resumeMilliseconds = resumeTimeSeconds.flatMap { $0.isFinite ? Int(max(0, $0) * 1_000) : nil } ?? 0
        MediaPerformance.mark("video_retry reason=\(reason) attempt=\(playbackRetryCount) resume_ms=\(resumeMilliseconds) url=\(url.lastPathComponent) fallback=\(retryURL.lastPathComponent)")
        cleanupCurrentPlayer(reason: nil)
        activeIdentity = retryIdentity
        activeURL = retryURL
        expectedDurationSeconds = expectedDuration
        isReadyForPlayback = false
        hasTerminalPlaybackFailure = false
        layerReadyForDisplay = false
        didFinishPlayback = false
        lastPublishedProgress = publishedProgress
        startPlayback(
            source: StoryVideoPlaybackSource(
                identity: retryIdentity,
                url: retryURL
            ),
            playerPool: nil,
            resumeTimeSeconds: resumeTimeSeconds
        )
        return true
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

    private func logAccessLogIfNeeded(reason: String) {
        guard !didUploadAccessLog,
              MediaControlConfig.shared.shouldUploadAccessLog(),
              let event = player?.currentItem?.accessLog()?.events.last else {
            return
        }

        didUploadAccessLog = true
        let sourceURL = activePlaybackURL ?? activeURL
        let observedBitrate = Int(max(0, event.observedBitrate).rounded())
        let indicatedBitrate = Int(max(0, event.indicatedBitrate).rounded())
        let transferDurationMs = Int(max(0, event.transferDuration) * 1000)
        let watchedMs = Int(max(0, event.durationWatched) * 1000)
        let downloadedMs = Int(max(0, event.segmentsDownloadedDuration) * 1000)
        let uri = accessLogURIIdentifier(event.uri)
        let delivery = sourceURL.map(playbackDelivery(for:)) ?? "unknown"
        let presentationSize = player?.currentItem?.presentationSize ?? .zero
        let presentationWidth = Int(max(0, presentationSize.width).rounded())
        let presentationHeight = Int(max(0, presentationSize.height).rounded())

        MediaPerformance.mark(
            "video_access_log reason=\(reason) delivery=\(delivery) observedBitrate=\(observedBitrate) indicatedBitrate=\(indicatedBitrate) width=\(presentationWidth) height=\(presentationHeight) stalls=\(event.numberOfStalls) transferDurationMs=\(transferDurationMs) watchedMs=\(watchedMs) downloadedMs=\(downloadedMs) bytes=\(event.numberOfBytesTransferred) uri=\(uri)"
        )
    }

    private func accessLogURIIdentifier(_ uri: String?) -> String {
        guard let uri, !uri.isEmpty else {
            return "unknown"
        }

        if let url = URL(string: uri) {
            let lastPathComponent = url.lastPathComponent
            if !lastPathComponent.isEmpty {
                return String(lastPathComponent.prefix(80))
            }
        }

        return String(uri.prefix(80)).replacingOccurrences(of: " ", with: "_")
    }

    private func cleanupCurrentPlayer(reason: String?) {
        playbackGeneration += 1
        playTask?.cancel()
        playTask = nil
        revealTask?.cancel()
        revealTask = nil
        seekTask?.cancel()
        seekTask = nil
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

        logAccessLogIfNeeded(reason: reason ?? "cleanup")

        if let reason, let activeURL {
            MediaPerformance.mark("video_dismissed reason=\(reason) url=\(activeURL.lastPathComponent)")
        }
        if let startupInterval {
            MediaPerformance.cancelInterval(startupInterval, reason: reason ?? "cleanup")
            self.startupInterval = nil
        }

        player?.pause()
        player?.cancelPendingPrerolls()
        player?.currentItem?.cancelPendingSeeks()
        player = nil
        isReadyForPlayback = false
        hasTerminalPlaybackFailure = false
        layerReadyForDisplay = false
        didFinishPlayback = false
        lastPublishedProgress = 0
        playbackStartedAt = nil
        activePlaybackURL = nil
        expectedDurationSeconds = nil
        startupMetadata = ""
        playbackPhase = .idle
        revealTargetSeconds = 0
    }

    private func removeTimeObserver() {
        if let timeObserver, let timeObserverPlayer {
            timeObserverPlayer.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        timeObserverPlayer = nil
    }

    private func isCurrentPlayback(generation: Int, identity: String) -> Bool {
        guard playbackGeneration == generation,
              let activeIdentity else {
            return false
        }

        return activeIdentity == identity
    }

    private var activePlaybackSource: StoryVideoPlaybackSource? {
        guard let activeIdentity, let activeURL else {
            return nil
        }

        return StoryVideoPlaybackSource(identity: activeIdentity, url: activeURL)
    }

    private func isCurrentPlayer(_ player: AVPlayer, generation: Int) -> Bool {
        playbackGeneration == generation && self.player === player
    }

    private static func seek(player: AVPlayer, to seconds: TimeInterval) async -> Bool {
        let target = CMTime(
            seconds: max(0, seconds),
            preferredTimescale: 600
        )

        return await withCheckedContinuation { continuation in
            player.seek(
                to: target,
                toleranceBefore: .zero,
                toleranceAfter: .zero
            ) { didFinish in
                continuation.resume(returning: didFinish)
            }
        }
    }

    private func waitUntilReadyToPreroll(
        player: AVPlayer,
        generation: Int,
        timeout: Duration = .seconds(4)
    ) async -> Bool {
        let timeoutSeconds = Double(timeout.components.seconds) +
            Double(timeout.components.attoseconds) / 1_000_000_000_000_000_000
        var elapsedUnpausedSeconds: TimeInterval = 0

        while elapsedUnpausedSeconds < timeoutSeconds {
            guard !Task.isCancelled,
                  isCurrentPlayer(player, generation: generation),
                  let item = player.currentItem else {
                return false
            }

            if player.status == .failed || item.status == .failed {
                return false
            }

            if player.status == .readyToPlay, item.status == .readyToPlay {
                return true
            }

            try? await Task.sleep(for: .milliseconds(25))
            if !isPaused {
                elapsedUnpausedSeconds += 0.025
            }
        }

        return player.status == .readyToPlay &&
            player.currentItem?.status == .readyToPlay &&
            isCurrentPlayer(player, generation: generation)
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

private struct FullBleedVideoPlayer: UIViewRepresentable {
    let player: AVPlayer?
    let onPlayerAttached: (AVPlayer) -> Void
    let onReadyForDisplay: (AVPlayer) -> Void

    func makeUIView(context: Context) -> FullBleedPlayerView {
        FullBleedPlayerView()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func updateUIView(_ view: FullBleedPlayerView, context: Context) {
        view.attach(player)
        context.coordinator.observeReadyForDisplay(
            playerLayer: view.playerLayer,
            player: player,
            onPlayerAttached: onPlayerAttached,
            onReadyForDisplay: onReadyForDisplay
        )
    }

    static func dismantleUIView(_ view: FullBleedPlayerView, coordinator: Coordinator) {
        coordinator.stopObserving()
        view.player = nil
    }

    final class Coordinator {
        private var observation: NSKeyValueObservation?
        private weak var observedLayer: AVPlayerLayer?
        private weak var observedPlayer: AVPlayer?

        func observeReadyForDisplay(
            playerLayer: AVPlayerLayer,
            player: AVPlayer?,
            onPlayerAttached: @escaping (AVPlayer) -> Void,
            onReadyForDisplay: @escaping (AVPlayer) -> Void
        ) {
            guard let player else {
                stopObserving()
                return
            }

            if observedLayer === playerLayer, observedPlayer === player {
                Task { @MainActor in
                    guard playerLayer.player === player else {
                        return
                    }

                    onPlayerAttached(player)
                    if playerLayer.isReadyForDisplay {
                        onReadyForDisplay(player)
                    }
                }
                return
            }

            stopObserving()
            observedLayer = playerLayer
            observedPlayer = player
            observation = playerLayer.observe(
                \.isReadyForDisplay,
                options: [.initial, .new]
            ) { layer, _ in
                guard layer.player === player, layer.isReadyForDisplay else {
                    return
                }

                Task { @MainActor in
                    onReadyForDisplay(player)
                }
            }

            Task { @MainActor in
                guard playerLayer.player === player else {
                    return
                }

                onPlayerAttached(player)
                if playerLayer.isReadyForDisplay {
                    onReadyForDisplay(player)
                }
            }
        }

        func stopObserving() {
            observation?.invalidate()
            observation = nil
            observedLayer = nil
            observedPlayer = nil
        }
    }
}

final class FullBleedPlayerView: UIView {
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

    func attach(_ nextPlayer: AVPlayer?) {
        guard playerLayer.player !== nextPlayer else {
            return
        }
        playerLayer.player = nextPlayer
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        playerLayer.backgroundColor = UIColor.clear.cgColor
        playerLayer.videoGravity = .resizeAspect
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .clear
        playerLayer.backgroundColor = UIColor.clear.cgColor
        playerLayer.videoGravity = .resizeAspect
    }
}
