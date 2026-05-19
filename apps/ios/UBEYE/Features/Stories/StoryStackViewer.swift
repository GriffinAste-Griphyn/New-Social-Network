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

    func load(storyId: String, api: APIClient) async {
        if stack == nil, let cached = await api.cachedStoryStackForDisplay(storyId: storyId) {
            applyLoadedStack(cached.story)
        }

        isLoading = stack == nil
        error = nil
        do {
            let response = try await api.storyStack(storyId: storyId)
            MediaPreheater.preheat(stack: response.story)
            applyLoadedStack(response.story)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func applyLoadedStack(_ nextStack: StoryStack) {
        stack = nextStack
        impressionStartedAt = Date()
        lastImpressionStoryId = nextStack.items.first?.id
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
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = StoryStackStore()
    @State private var index = 0
    @State private var storyStartedAt = Date()
    @State private var storyProgress = 0.0
    @State private var timedStoryId: String?
    @State private var didFinishCurrentItem = false
    @State private var reportingItem: StoryStackItem?
    @State private var repliesSheetItem: StoryStackItem?
    @State private var confirmationDismissTask: Task<Void, Never>?
    @State private var reportConfirmationDismissTask: Task<Void, Never>?
    @FocusState private var isReplyFieldFocused: Bool

    private let defaultStoryDurationSeconds: TimeInterval = 10
    private let storyTimer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
    private let storyAvatarSize: CGFloat = 42
    private let storyActionSize: CGFloat = 42
    private let ownerStatsHeight: CGFloat = 64
    private let replyComposerHeight: CGFloat = 46
    private let bottomChromeInset: CGFloat = 16
    private let captionBottomGap: CGFloat = 14
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

                    storyChrome(stack: stack, item: item)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .allowsHitTesting(true)

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
            await store.load(storyId: route.id, api: api)
            MediaPerformance.measure("story_open id=\(route.id)", since: route.openedAt)
            if route.source != .ownStory {
                await store.loadFollows(api: api)
            }
            if let item = store.stack?.items[safe: index] {
                resetStoryTimer(for: item)
            }
        }
        .onReceive(storyTimer) { now in
            updateStoryProgress(now: now)
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
    }

    @ViewBuilder
    private func media(_ item: StoryStackItem) -> some View {
        ZStack {
            Color.black

            if item.assetKind == .video {
                AutoPlayVideoPlayer(url: item.mediaUrl, thumbnailUrl: item.thumbnailUrl)
            } else {
                CachedAsyncImage(url: item.mediaUrl) { image in
                    image
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } placeholder: {
                    ProgressView().tint(.white)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func storyChrome(stack: StoryStack, item: StoryStackItem) -> some View {
        ZStack {
            storyTopChrome(stack: stack, item: item)
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

            storyBottomChrome(stack: stack, item: item)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.horizontal, bottomChromeInset)
                .padding(.bottom, bottomChromeInset)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(.white)
    }

    private func storyTopChrome(stack: StoryStack, item: StoryStackItem) -> some View {
        VStack(spacing: 12) {
            storyProgressIndicator(stack: stack)
            storyHeader(stack: stack, item: item)
        }
        .padding(.horizontal, UBEYEMetrics.screenInset)
        .padding(.top, 18)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .top)
    }

    @ViewBuilder
    private func storyCaption(_ item: StoryStackItem) -> some View {
        let overlays = item.textOverlays?.filter {
            !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        } ?? []

        if !overlays.isEmpty {
            GeometryReader { proxy in
                ForEach(overlays) { overlay in
                    storyOverlayChip(overlay)
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
    private func storyOverlayChip(_ overlay: StoryTextOverlay) -> some View {
        if overlay.kind == "link", let href = overlay.href {
            Link(destination: href) {
                storyOverlayChipContent(overlay)
            }
            .buttonStyle(.plain)
            .contentShape(Capsule())
            .zIndex(2)
        } else {
            storyOverlayChipContent(overlay)
        }
    }

    private func storyOverlayChipContent(_ overlay: StoryTextOverlay) -> some View {
        HStack(spacing: 8) {
            if overlay.kind == "link" {
                Image(systemName: "link")
                    .font(.system(size: 15, weight: .bold))
            }

            Text(overlay.label)
                .font(.title3.bold())
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.black.opacity(0.42), in: Capsule())
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
                actionSize: storyActionSize,
                deleteStory: {
                    Task {
                        if await store.delete(item: item, api: api) {
                            dismiss()
                        }
                    }
                },
                reportStory: {
                    reportingItem = item
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
        HStack(spacing: 5) {
            ForEach(stack.items.indices, id: \.self) { itemIndex in
                StoryProgressSegment(progress: progressValue(for: itemIndex))
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
                MediaPreheater.preheat(stack: stack, around: index)
            }
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
        storyStartedAt = Date()
        storyProgress = 0
        didFinishCurrentItem = false
    }

    private func updateStoryProgress(now: Date) {
        guard let stack = store.stack, let item = stack.items[safe: index] else {
            return
        }

        startStoryTimerIfNeeded(for: item)
        let duration = displayDuration(for: item)

        if shouldPauseStoryProgress {
            storyStartedAt = now.addingTimeInterval(-storyProgress * duration)
            return
        }

        storyProgress = min(max(now.timeIntervalSince(storyStartedAt) / duration, 0), 1)

        guard storyProgress >= 1, !didFinishCurrentItem else {
            return
        }

        didFinishCurrentItem = true
        if index < stack.items.count - 1 {
            move(1, item: item)
        } else {
            Task { await store.recordImpression(item: item, completed: true, api: api) }
            dismiss()
        }
    }

    private func displayDuration(for item: StoryStackItem) -> TimeInterval {
        if item.assetKind == .video, let durationSeconds = item.durationSeconds {
            return max(0.5, min(defaultStoryDurationSeconds, durationSeconds))
        }

        return defaultStoryDurationSeconds
    }

    private var shouldPauseStoryProgress: Bool {
        isReplyFieldFocused ||
            repliesSheetItem != nil ||
            store.isSendingReply ||
            !store.replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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

private struct StoryProgressSegment: View {
    let progress: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(.white.opacity(0.32))
                Capsule()
                    .fill(.white)
                    .frame(width: max(0, min(1, progress)) * proxy.size.width)
            }
        }
        .frame(height: 4)
        .frame(maxWidth: .infinity)
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

    var title: String {
        switch self {
        case .spam:
            return "Spam, scam, or misleading"
        case .harassment:
            return "Harassment or bullying"
        case .hate:
            return "Hate speech or symbols"
        case .sexualContent:
            return "Nudity or sexual content"
        case .violence:
            return "Violence or dangerous acts"
        case .selfHarm:
            return "Self-harm or suicide"
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
            return "Fake engagement, scams, or deceptive content."
        case .harassment:
            return "Threats, targeted abuse, or unwanted attacks."
        case .hate:
            return "Attacks based on identity or protected traits."
        case .sexualContent:
            return "Explicit nudity, solicitation, or sexual content."
        case .violence:
            return "Graphic violence, threats, or dangerous behavior."
        case .selfHarm:
            return "Content encouraging self-harm or suicide."
        case .illegalGoods:
            return "Drugs, weapons, or other restricted products."
        case .impersonation:
            return "Pretending to be another person or brand."
        case .intellectualProperty:
            return "Copyright, trademark, or stolen content."
        case .other:
            return "Another safety issue."
        }
    }
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
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header

                    VStack(spacing: 10) {
                        ForEach(StoryReportReason.allCases) { reason in
                            reasonRow(reason)
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Additional details")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Color.ubeyeInk)
                        TextEditor(text: $details)
                            .font(.system(size: 15, weight: .medium))
                            .frame(minHeight: 92)
                            .padding(10)
                            .scrollContentBackground(.hidden)
                            .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(Color.ubeyeBorder, lineWidth: 1)
                            )
                    }

                    if let error {
                        InlineNotice(message: error, isError: true)
                    }

                    Button {
                        Task { await submitReport() }
                    } label: {
                        HStack(spacing: 8) {
                            if isSubmitting {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(.white)
                            }
                            Text(isSubmitting ? "Submitting" : "Submit report")
                        }
                        .font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .foregroundStyle(.white)
                        .background(selectedReason == nil ? Color.ubeyeMuted.opacity(0.45) : Color.ubeyeRed, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(selectedReason == nil || isSubmitting)
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 32)
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

                Spacer()
            }

            VStack(alignment: .leading, spacing: 5) {
                Text("Report story")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                Text("Choose why this story from \(creatorName) should be reviewed.")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func reasonRow(_ reason: StoryReportReason) -> some View {
        Button {
            selectedReason = reason
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(reason.title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color.ubeyeInk)
                    Text(reason.subtitle)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(2)
                }

                Spacer(minLength: 10)

                Image(systemName: selectedReason == reason ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(selectedReason == reason ? Color.ubeyeRed : Color.ubeyeMuted.opacity(0.55))
            }
            .padding(12)
            .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(selectedReason == reason ? Color.ubeyeRed.opacity(0.45) : Color.ubeyeBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
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
    let actionSize: CGFloat
    let deleteStory: () -> Void
    let reportStory: () -> Void
    let blockCreator: () -> Void
    let canUnfollowCreator: Bool
    let unfollowCreator: () -> Void
    let close: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            Menu {
                if isOwnStack {
                    Button(role: .destructive, action: deleteStory) {
                        Label("Delete story", systemImage: "trash")
                    }
                } else {
                    if canUnfollowCreator {
                        Button(role: .destructive, action: unfollowCreator) {
                            Label("Unfollow creator", systemImage: "person.badge.minus")
                        }
                    }
                    Button(action: reportStory) {
                        Label("Report story", systemImage: "flag")
                    }
                    Button(role: .destructive, action: blockCreator) {
                        Label("Block creator", systemImage: "hand.raised")
                    }
                }
            } label: {
                StoryViewerActionIcon(systemImage: "ellipsis", size: actionSize, fontSize: 19)
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
    let url: URL
    let thumbnailUrl: URL?
    @State private var player: AVPlayer?
    @State private var isReadyForPlayback = false
    @State private var stallObserver: NSObjectProtocol?
    @State private var playTask: Task<Void, Never>?
    @State private var playbackStartedAt: Date?

    init(url: URL, thumbnailUrl: URL? = nil) {
        self.url = url
        self.thumbnailUrl = thumbnailUrl
    }

    var body: some View {
        ZStack {
            AspectFitVideoPlayer(player: player) {
                guard !isReadyForPlayback else {
                    return
                }

                isReadyForPlayback = true
                MediaPerformance.measure(
                    "video_first_frame url=\(url.lastPathComponent)",
                    since: playbackStartedAt ?? Date()
                )
            }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            if !isReadyForPlayback, let thumbnailUrl {
                CachedAsyncImage(url: thumbnailUrl) { image in
                    image
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } placeholder: {
                    Color.black
                }
            }
        }
        .background(Color.black)
        .onAppear {
            play(url)
        }
        .onChange(of: url) { _, nextURL in
            play(nextURL)
        }
        .onDisappear {
            playTask?.cancel()
            playTask = nil
            if let stallObserver {
                NotificationCenter.default.removeObserver(stallObserver)
                self.stallObserver = nil
            }
            player?.pause()
            player = nil
            isReadyForPlayback = false
            playbackStartedAt = nil
        }
    }

    private func play(_ url: URL) {
        playTask?.cancel()
        isReadyForPlayback = false
        playTask = Task { @MainActor in
            let startedAt = Date()
            playbackStartedAt = startedAt
            let canPersistVideo = await MediaFileDiskCache.shared.supportsPersistence(url: url, kind: .video)
            let cachedPlaybackURL: URL?

            if canPersistVideo {
                cachedPlaybackURL = await MediaFileDiskCache.shared.cachedFileURL(for: url)
            } else {
                cachedPlaybackURL = nil
            }
            let playbackURL = cachedPlaybackURL ?? url

            if canPersistVideo {
                if cachedPlaybackURL == nil {
                    Task {
                        await MediaFileDiskCache.shared.cache(url: url, kind: .video)
                    }
                } else {
                    MediaPerformance.mark("video_disk_cache_hit url=\(url.lastPathComponent)")
                }
            }

            guard !Task.isCancelled else {
                return
            }

            player?.pause()
            let next = WarmVideoPlayerPool.shared.takePlayer(for: url, playbackURL: playbackURL)
            player = next
            observeReadiness(player: next, url: url, startedAt: startedAt)
            observeStalls(player: next, url: url)
            AppAudioSession.configureForVideoPlayback()
            next.play()
        }
    }

    private func observeReadiness(player: AVPlayer, url: URL, startedAt: Date) {
        Task { @MainActor in
            for _ in 0..<80 {
                guard self.player === player else {
                    return
                }

                if player.currentItem?.status == .readyToPlay {
                    MediaPerformance.measure("video_item_ready url=\(url.lastPathComponent)", since: startedAt)
                    return
                }

                try? await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    private func observeStalls(player: AVPlayer, url: URL) {
        if let stallObserver {
            NotificationCenter.default.removeObserver(stallObserver)
        }

        stallObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemPlaybackStalled,
            object: player.currentItem,
            queue: .main
        ) { _ in
            MediaPerformance.mark("video_stalled url=\(url.lastPathComponent)")
        }
    }
}

private struct AspectFitVideoPlayer: UIViewRepresentable {
    let player: AVPlayer?
    let onReadyForDisplay: () -> Void

    func makeUIView(context: Context) -> AspectFitPlayerView {
        AspectFitPlayerView()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func updateUIView(_ view: AspectFitPlayerView, context: Context) {
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

private final class AspectFitPlayerView: UIView {
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
        playerLayer.videoGravity = .resizeAspect
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .black
        playerLayer.backgroundColor = UIColor.black.cgColor
        playerLayer.videoGravity = .resizeAspect
    }
}
