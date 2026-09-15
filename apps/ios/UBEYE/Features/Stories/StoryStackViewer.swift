import AVKit
import CryptoKit
import SwiftUI
import UIKit

struct StoryViewerPausePolicy {
    var sceneIsActive = true
    var isPressingPlayableVideo = false
    var isReplyFieldFocused = false
    var isOwnerSheetPresented = false
    var isSendingReply = false
    var hasReplyDraft = false

    var shouldPausePlayback: Bool {
        !sceneIsActive ||
            isPressingPlayableVideo ||
            isReplyFieldFocused ||
            isOwnerSheetPresented ||
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

enum StoryProgressPausePolicy {
    static func shouldPause(
        playbackIsPaused: Bool,
        isPressingMedia: Bool,
        isDismissTransitionActive: Bool,
        isWaitingForVideo: Bool
    ) -> Bool {
        playbackIsPaused ||
            isPressingMedia ||
            isDismissTransitionActive ||
            isWaitingForVideo
    }
}

private struct StoryDismissBackdrop: View {
    let offset: CGFloat
    let viewportHeight: CGFloat

    var body: some View {
        Color.black.opacity(Double(1 - min(max(offset / max(viewportHeight, 1), 0), 1)))
            .contentShape(Rectangle())
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @ObservedObject private var resourceMonitor = UBEYEResourceMonitor.shared
    @StateObject private var store = StoryStackStore()
    @State private var storyTimerState = StoryTimerState()
    @State private var index = 0
    @State private var timedStoryId: String?
    @State private var videoReadyItemId: String?
    @State private var pendingFinishedItemId: String?
    @State private var didFinishCurrentItem = false
    @State private var deleteConfirmationItem: StoryStackItem?
    @State private var isDeleteConfirmationPresented = false
    @State private var reportingItem: StoryStackItem?
    @State private var ownerSheet: StoryOwnerSheet?
    @State private var confirmationDismissTask: Task<Void, Never>?
    @State private var reportConfirmationDismissTask: Task<Void, Never>?
    @State private var completionDismissTask: Task<Void, Never>?
    @State private var isClearingCompletedStory = false
    @State private var keyboardHeight: CGFloat = 0
    @State private var mediaPreparationTask: Task<Void, Never>?
    @State private var pendingTransitionMeasurement: StoryTransitionMeasurement?
    @State private var interactionLatencyTracker = StoryInteractionLatencyTracker()
    @State private var verticalDragOffset: CGFloat = 0
    @State private var viewportHeight: CGFloat = 844
    @State private var isChromeVisible = true
    @State private var showsReactionBurst = false
    @State private var reactionBurstTask: Task<Void, Never>?
    @State private var pendingDeletion: PendingStoryDeletion?
    @State private var deletionCommitTask: Task<Void, Never>?
    @State private var gestureAxis: GestureAxisIntent = .undecided
    @State private var isDismissTransitionActive = false
    @State private var didPlayDismissHaptic = false
    @State private var showsGestureHint = false
    @State private var gestureHintDismissTask: Task<Void, Never>?
    @State private var keyboardRequestStartedAt: Date?
    @AppStorage("ubeye.story-playback-muted") private var isStoryPlaybackMuted = false
    @GestureState private var isPressingStoryMedia = false
    @FocusState private var isReplyFieldFocused: Bool

    private let defaultStoryDurationSeconds: TimeInterval = 10
    private let maxVideoStoryDurationSeconds = TimeInterval(
        StoryMediaContract.maximumVideoDurationSeconds
    )
    private let storyAvatarSize: CGFloat = 42
    private let storyActionSize: CGFloat = 42
    @ScaledMetric(relativeTo: .body) private var scaledOwnerStatsHeight: CGFloat = 64
    @ScaledMetric(relativeTo: .body) private var scaledReplyComposerHeight: CGFloat = 46
    private let bottomChromeInset: CGFloat = 16
    private let bottomChromeScreenGap: CGFloat = 20
    private let keyboardComposerGap: CGFloat = 8
    private let topChromeGap: CGFloat = 10
    private let topChromeMinimumInset: CGFloat = 58
    private let storyCanvasCornerRadius: CGFloat = 0
    private let storyGestureCoordinateSpace = "story-viewer-viewport"
    private let verticalSwipeDominanceRatio: CGFloat = 1.15

    private var ownerStatsHeight: CGFloat { min(scaledOwnerStatsHeight, 84) }
    private var replyComposerHeight: CGFloat { min(scaledReplyComposerHeight, 62) }

    var body: some View {
        GeometryReader { proxy in
            let safeAreaInsets = resolvedSafeAreaInsets(proxy.safeAreaInsets)

            ZStack {
                StoryDismissBackdrop(offset: verticalDragOffset, viewportHeight: proxy.size.height)

                if isClearingCompletedStory {
                    Color.black
                } else if store.isLoading && store.stack == nil {
                    StoryViewerLoadingPlaceholder()
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
                        extendsToTop: true
                    )

                    ZStack {
                    ZStack {
                        StoryCanvasBackground()

                        storyMediaBuffer(stack: stack, activeIndex: index)
                    }
                        .storyCanvasFrame(
                            canvasLayout,
                            cornerRadius: storyCanvasCornerRadius
                        )
                        .onAppear {
                            store.markActiveItem(item)
                            startStoryTimerIfNeeded(for: item)
                        }
                        .onDisappear {
                            Task {
                                await store.recordImpression(
                                    item: item,
                                    completed: false,
                                    api: api
                                )
                            }
                        }

                    tapNavigationOverlay(item: item, viewportSize: proxy.size, safeAreaInsets: safeAreaInsets)
                        .frame(width: proxy.size.width, height: proxy.size.height)

                    storyChromeScrim(stack: stack)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .allowsHitTesting(false)
                        .opacity(isChromeVisible ? 1 : 0)

                    storyChrome(stack: stack, item: item, safeAreaInsets: safeAreaInsets)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .allowsHitTesting(true)
                        .zIndex(2)
                        .opacity(isChromeVisible ? 1 : 0)
                        .allowsHitTesting(isChromeVisible)

                    if !isClearingCompletedStory {
                        storyBottomOverlayChrome(
                            stack: stack,
                            item: item,
                            safeAreaBottom: safeAreaInsets.bottom
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .zIndex(3)
                        .opacity(isChromeVisible ? 1 : 0)
                        .allowsHitTesting(isChromeVisible)
                    }

                    if showsReactionBurst {
                        Image(systemName: "heart.fill")
                            .font(.system(size: 92, weight: .black))
                            .foregroundStyle(.white)
                            .shadow(color: Color.ubeyeRed.opacity(0.75), radius: 24)
                            .transition(.scale(scale: 0.25).combined(with: .opacity))
                            .allowsHitTesting(false)
                            .zIndex(8)
                    }

                    if let ownerSheet {
                        Color.black.opacity(0.001)
                            .ignoresSafeArea()
                            .zIndex(9)
                            .onTapGesture {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
                                    self.ownerSheet = nil
                                }
                            }

                        storyOwnerSheet(ownerSheet, maxHeight: proxy.size.height)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                            .zIndex(10)
                    }
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    // Resolve the slide once before media-specific transactions.
                    .geometryGroup()
                    .offset(y: max(verticalDragOffset, 0))
                }

                if showsGestureHint {
                    Button {
                        dismissGestureHint()
                    } label: {
                        UBEYEContextualHint(
                            systemImage: "hand.tap",
                            message: "Tap sides to move · Double-tap center to react · Swipe down to close"
                        )
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 20)
                    .padding(.bottom, max(safeAreaInsets.bottom + 84, 104))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(20)
                }

                if pendingDeletion != nil {
                    storyDeletionUndoToast
                        .padding(.horizontal, 16)
                        .padding(.bottom, max(safeAreaInsets.bottom + 22, 34))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .zIndex(30)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .coordinateSpace(name: storyGestureCoordinateSpace)
            .simultaneousGesture(
                verticalStorySwipeGesture
                    .simultaneously(with: pressToPauseGesture)
            )
            .onAppear {
                viewportHeight = proxy.size.height
            }
            .onChange(of: proxy.size.height) { _, height in
                viewportHeight = height
            }
        }
        .ignoresSafeArea(.container, edges: .all)
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .contentShape(Rectangle())
        .presentationBackground(.clear)
        .onAppear {
            mediaEngine.storyViewerDidAppear(storyId: route.id)
            AppAudioSession.configureForVideoPlayback()
            InteractionFrameMonitor.shared.start(surface: "story_viewer")
            UBEYEFeedback.prepare(.selection)
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
            MediaPerformance.measure(
                "interaction_latency surface=story_viewer action=open source=\(String(describing: route.source))",
                since: route.openedAt
            )
            if route.source != .ownStory {
                await store.loadFollows(api: api)
            }
            if let item = store.stack?.items[safe: index] {
                startStoryTimerIfNeeded(for: item)
            }
            presentGestureHintIfNeeded()
        }
        .onReceive(pendingStoryUploads.$uploads
            .map { $0.map(\.presentation) }
            .removeDuplicates()
            .receive(on: RunLoop.main)) { _ in
            guard route.id == "my-story" else {
                return
            }

            let activeItemID = store.stack?.items[safe: index]?.id
            store.applyPendingUploads(
                pendingUploads: pendingStoryUploads,
                account: auth.account,
                mediaEngine: mediaEngine,
                around: index
            )
            guard let resolvedIndex = StoryStackRefreshPolicy.resolvedIndex(
                activeItemID: activeItemID,
                previousIndex: index,
                itemIDs: store.stack?.items.map(\.id) ?? []
            ), let refreshedItem = store.stack?.items[safe: resolvedIndex] else {
                storyTimerState.stop()
                return
            }

            index = resolvedIndex
            if timedStoryId != refreshedItem.id {
                store.markActiveItem(refreshedItem)
                resetStoryTimer(for: refreshedItem)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .storyUploadDidRegister)) { _ in
            guard route.id == "my-story" else {
                return
            }

            let previousIndex = index
            Task { @MainActor in
                await store.load(
                    storyId: route.id,
                    api: api,
                    mediaEngine: mediaEngine,
                    pendingUploads: pendingStoryUploads,
                    account: auth.account
                )
                guard let resolvedIndex = StoryStackRefreshPolicy.resolvedIndex(
                    activeItemID: nil,
                    previousIndex: previousIndex,
                    itemIDs: store.stack?.items.map(\.id) ?? []
                ), let refreshedItem = store.stack?.items[safe: resolvedIndex] else {
                    return
                }
                index = resolvedIndex
                store.markActiveItem(refreshedItem)
                resetStoryTimer(for: refreshedItem)
            }
        }
        .onChange(of: store.replyConfirmation) { _, confirmation in
            scheduleConfirmationDismiss(for: confirmation)
        }
        .onChange(of: store.reportConfirmation) { _, confirmation in
            scheduleReportConfirmationDismiss(for: confirmation)
        }
        .onChange(of: shouldPauseStoryProgress) { _, isPaused in
            storyTimerState.setPaused(isPaused)
            guard !isPaused,
                  let pendingFinishedItemId,
                  let item = store.stack?.items[safe: index],
                  item.id == pendingFinishedItemId else {
                return
            }

            self.pendingFinishedItemId = nil
            finishCurrentItem(item)
        }
        .onChange(of: isReplyFieldFocused) { _, isFocused in
            if isFocused {
                keyboardRequestStartedAt = Date()
                UBEYEFeedback.prepare(.selection)
            } else if keyboardHeight == 0 {
                keyboardRequestStartedAt = nil
            }
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
            reactionBurstTask?.cancel()
            gestureHintDismissTask?.cancel()
            storyTimerState.stop()
            mediaPreparationTask?.cancel()
            mediaPreparationTask = nil
            mediaEngine.storyViewerDidDisappear()
            InteractionFrameMonitor.shared.stop(surface: "story_viewer")
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
                    beginDeleteStory(item)
                }
            }
            Button("Cancel", role: .cancel) {
                deleteConfirmationItem = nil
            }
        } message: {
            Text("This removes the story from your profile and followers' feeds.")
        }
    }

    private func storyMediaBuffer(stack: StoryStack, activeIndex: Int) -> some View {
        let bufferedMedia = StoryMediaBufferPolicy.stableIndices(
            activeIndex: activeIndex,
            itemCount: stack.items.count,
            mode: resourceMonitor.mode
        ).compactMap { itemIndex -> BufferedStoryMedia? in
            guard let item = stack.items[safe: itemIndex] else {
                return nil
            }

            return BufferedStoryMedia(item: item, isActive: itemIndex == activeIndex)
        }

        return ZStack {
            ForEach(bufferedMedia) { buffered in
                ZStack {
                    media(buffered.item, isActive: buffered.isActive)
                        .allowsHitTesting(false)

                    storyCanvasOverlay(buffered.item)
                        .zIndex(1)
                }
                    .opacity(buffered.isActive ? 1 : 0)
                    .allowsHitTesting(buffered.isActive)
                    .accessibilityHidden(!buffered.isActive)
                    .zIndex(buffered.isActive ? 1 : 0)
            }
        }
        // Story switches remain instant, but the enclosing viewer slide must animate
        // media with its controls rather than having this subtree jump to the final offset.
        .animation(nil, value: activeIndex)
    }

    @ViewBuilder
    private func media(_ item: StoryStackItem, isActive: Bool) -> some View {
        ZStack {
            Color.black

            if item.isProcessingVideo {
                processingVideoPlaceholder(item)
                    .onAppear {
                        if isActive {
                            completeStoryTransitionIfNeeded(for: item)
                        }
                    }
                    .onChange(of: isActive) { _, nextIsActive in
                        if nextIsActive {
                            completeStoryTransitionIfNeeded(for: item)
                        }
                    }
                    .task(id: "\(item.id):\(item.processingStatus ?? "unknown"):\(isActive)") {
                        guard isActive,
                              item.processingStatus == "processing",
                              !PendingStoryUploadStore.isPendingStoryId(item.id) else {
                            return
                        }

                        let result = await api.waitForStoryLive(storyId: item.id)
                        guard !Task.isCancelled, result != .timedOut else {
                            return
                        }
                        api.invalidateStoryStacks(ids: [route.id, item.id, "my-story"])
                        await store.load(
                            storyId: route.id,
                            api: api,
                            mediaEngine: mediaEngine,
                            pendingUploads: pendingStoryUploads,
                            account: auth.account
                        )
                    }
            } else if item.assetKind == .video {
                AutoPlayVideoPlayer(
                    source: item.playbackSource,
                    thumbnailUrl: item.playbackThumbnailUrl,
                    expectedDuration: displayDuration(for: item),
                    preloadSources: adjacentVideoSources(for: item),
                    playerPool: mediaEngine.storyVideoPlaybackPool,
                    refreshSource: {
                        guard !PendingStoryUploadStore.isPendingStoryId(item.id),
                              let response = try? await api.storyStack(
                                storyId: route.id,
                                refresh: true
                              ),
                              let refreshedItem = response.story.items.first(where: {
                                $0.id == item.id
                              }),
                              refreshedItem.isPlayableVideo else {
                            return nil
                        }

                        return refreshedItem.playbackSource
                    },
                    showsThumbnailWhileLoading: true,
                    preparesPlayerPool: false,
                    isActive: isActive,
                    isPaused: !isActive || shouldPauseVideoPlayback,
                    isMuted: isStoryPlaybackMuted,
                    contentMode: item.playbackVideoContentMode,
                    onReadyForPlayback: {
                        guard isActive,
                              store.stack?.items[safe: index]?.id == item.id else {
                            return
                        }

                        completeStoryTransitionIfNeeded(for: item)
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
                ProgressiveCachedImage(
                    placeholderURL: item.playbackPlaceholderUrl,
                    thumbnailURL: item.playbackThumbnailUrl,
                    fullURL: item.playbackMediaUrl
                ) { image, _, _ in
                    StoryCanvasImage(image: image, contentMode: .fill)
                } placeholder: {
                    StoryCanvasBackground()
                } onReady: { _ in
                    if isActive {
                        completeStoryTransitionIfNeeded(for: item)
                    }
                }
                .id(item.id)
                .onChange(of: isActive) { _, nextIsActive in
                    guard nextIsActive,
                          MediaImageCache.shared.cachedImage(for: item.playbackMediaUrl) != nil else {
                        return
                    }

                    completeStoryTransitionIfNeeded(for: item)
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
                if item.hasVideoProcessingFailed {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 30, weight: .bold))
                } else {
                    ProgressView()
                        .tint(.white)
                        .controlSize(.large)
                }
                Text(item.hasVideoProcessingFailed ? "Video couldn’t be processed" : "Preparing your video")
                    .font(.system(size: 18, weight: .bold))
                Text(
                    item.hasVideoProcessingFailed
                        ? "Your original upload is safe. Please try uploading the video again."
                        : "We’re optimizing it for smooth, high-quality playback."
                )
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
        if item.assetKind == .image {
            StoryCanvasBackground()
        } else if let thumbnailUrl = item.playbackThumbnailUrl {
            CachedAsyncImage(url: thumbnailUrl) { image in
                StoryCanvasImage(image: image, contentMode: item.playbackVideoContentMode)
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
                        .allowsHitTesting(overlay.kind == "link" && overlay.href != nil)
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
                .allowsHitTesting(false)
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
        let displayLabel = overlay.kind == "text"
            ? normalizedStoryOverlayText(overlay.label)
            : overlay.label

        return HStack(spacing: 6) {
            if overlay.kind == "link" {
                Image(systemName: "link")
                    .font(.system(size: 13, weight: .semibold))
            }

            Text(displayLabel)
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
                        .font(.headline.weight(.medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)

                    if canFollowCreator(stack) {
                        discoverFollowButton()
                    }
                }

                Text(item.postedAt)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)

            StoryViewerActions(
                isOwnStack: isOwnStack(stack),
                isVideo: item.assetKind == .video,
                isMuted: isStoryPlaybackMuted,
                canDeleteStory: !PendingStoryUploadStore.isPendingStoryId(item.id),
                actionSize: storyActionSize,
                isPerformingAction: store.isPerformingAction || pendingDeletion != nil,
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
                toggleMute: {
                    UBEYEFeedback.selection()
                    isStoryPlaybackMuted.toggle()
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

    private func beginDeleteStory(_ item: StoryStackItem) {
        guard pendingDeletion == nil,
              let originalStack = store.stack,
              let originalIndex = originalStack.items.firstIndex(where: { $0.id == item.id }) else {
            return
        }

        let replacementItemID = StoryDeletionPolicy.replacementItemID(
            deleting: item.id,
            from: originalStack.items.map(\.id)
        )
        let pending = PendingStoryDeletion(
            item: item,
            originalStack: originalStack,
            originalIndex: originalIndex
        )
        pendingDeletion = pending
        deleteConfirmationItem = nil
        ownerSheet = nil
        store.removeItemForUndo(item.id)
        UBEYEFeedback.warning()
        MediaPerformance.mark("undo_action kind=story_delete phase=offered")

        if let replacementItemID,
           let stack = store.stack,
           let nextIndex = stack.items.firstIndex(where: { $0.id == replacementItemID }),
           let nextItem = stack.items[safe: nextIndex] {
            index = nextIndex
            store.markActiveItem(nextItem)
            resetStoryTimer(for: nextItem)
            mediaEngine.prepare(
                stack: stack,
                around: nextIndex,
                activeIdentity: nextItem.isPlayableVideo ? nextItem.playbackIdentity : nil
            )
        } else {
            isClearingCompletedStory = true
            storyTimerState.stop()
        }

        deletionCommitTask?.cancel()
        deletionCommitTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(4.5))
            guard !Task.isCancelled else { return }
            await commitPendingDeletion(id: pending.id)
        }
    }

    private func undoStoryDeletion() {
        guard let pendingDeletion else { return }
        deletionCommitTask?.cancel()
        deletionCommitTask = nil
        store.restoreStackForUndo(pendingDeletion.originalStack)
        index = min(
            pendingDeletion.originalIndex,
            max(pendingDeletion.originalStack.items.count - 1, 0)
        )
        isClearingCompletedStory = false
        if let restoredItem = pendingDeletion.originalStack.items[safe: index] {
            store.markActiveItem(restoredItem)
            resetStoryTimer(for: restoredItem)
            mediaEngine.prepare(
                stack: pendingDeletion.originalStack,
                around: index,
                activeIdentity: restoredItem.isPlayableVideo ? restoredItem.playbackIdentity : nil
            )
        }
        withAnimation(UBEYEMotion.reveal(reduceMotion: reduceMotion, mode: resourceMonitor.mode)) {
            self.pendingDeletion = nil
        }
        UBEYEFeedback.success()
        MediaPerformance.mark("undo_action kind=story_delete phase=undone")
    }

    private func commitPendingDeletion(id: UUID) async {
        guard let pendingDeletion, pendingDeletion.id == id else { return }
        let didDelete = await store.commitDelete(item: pendingDeletion.item, api: api)
        guard self.pendingDeletion?.id == id else { return }

        if didDelete {
            MediaPerformance.mark("undo_action kind=story_delete phase=committed")
            withAnimation(.easeOut(duration: 0.14)) {
                self.pendingDeletion = nil
            }
            if store.stack?.items.isEmpty != false {
                dismiss()
            }
        } else {
            store.restoreStackForUndo(pendingDeletion.originalStack)
            index = min(
                pendingDeletion.originalIndex,
                max(pendingDeletion.originalStack.items.count - 1, 0)
            )
            isClearingCompletedStory = false
            self.pendingDeletion = nil
            if let restoredItem = pendingDeletion.originalStack.items[safe: index] {
                store.markActiveItem(restoredItem)
                resetStoryTimer(for: restoredItem)
                mediaEngine.prepare(
                    stack: pendingDeletion.originalStack,
                    around: index,
                    activeIdentity: restoredItem.isPlayableVideo ? restoredItem.playbackIdentity : nil
                )
            }
            UBEYEFeedback.error()
        }
    }

    private var storyDeletionUndoToast: some View {
        HStack(spacing: 12) {
            Image(systemName: "trash")
                .font(.body.weight(.bold))
            Text("Story removed")
                .font(.body.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 8)
            Button("Undo") {
                undoStoryDeletion()
            }
            .font(.body.weight(.bold))
            .foregroundStyle(Color.ubeyeYellow)
            .frame(minWidth: 44, minHeight: 44)
        }
        .foregroundStyle(.white)
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .frame(minHeight: 52)
        .background(.black.opacity(reduceTransparency ? 0.96 : 0.82), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.2), lineWidth: 1))
        .shadow(color: .black.opacity(0.28), radius: 14, y: 6)
        .accessibilityElement(children: .contain)
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

    private func tapNavigationOverlay(item: StoryStackItem, viewportSize: CGSize, safeAreaInsets: EdgeInsets) -> some View {
        // Navigation must not wait for the reaction recognizer's second tap.
        // Keep that exclusive single/double-tap decision inside the center zone.
        HStack(spacing: 0) {
            storySideTapZone(width: viewportSize.width * 0.32, viewportSize: viewportSize, safeAreaInsets: safeAreaInsets)
            Color.clear
                .frame(width: viewportSize.width * 0.36)
                .contentShape(Rectangle())
                .gesture(storyMediaTapGesture(viewportSize: viewportSize, safeAreaInsets: safeAreaInsets))
            storySideTapZone(width: viewportSize.width * 0.32, viewportSize: viewportSize, safeAreaInsets: safeAreaInsets)
        }
            .ignoresSafeArea()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Story viewer")
            .accessibilityValue(storyAccessibilityValue)
            .accessibilityHint("Use actions to move, react, show controls, or close")
            .accessibilityAction(named: Text("Previous story")) {
                move(-1, item: item)
            }
            .accessibilityAction(named: Text("Next story")) {
                move(1, item: item)
            }
            .accessibilityAction(named: Text("React with heart")) {
                reactToStory(item)
            }
            .accessibilityAction(named: Text(isChromeVisible ? "Hide controls" : "Show controls")) {
                isChromeVisible.toggle()
            }
            .accessibilityAction(named: Text("Close stories")) {
                dismissStoryFromSwipe(item: item)
            }
    }

    private func storySideTapZone(width: CGFloat, viewportSize: CGSize, safeAreaInsets: EdgeInsets) -> some View {
        Color.clear
            .frame(width: width)
            .contentShape(Rectangle())
            .gesture(
                SpatialTapGesture(coordinateSpace: .named(storyGestureCoordinateSpace))
                    .onEnded { value in
                        handleStoryMediaTap(value.location, doubleTap: false,
                            viewportSize: viewportSize, safeAreaInsets: safeAreaInsets)
                    }
            )
    }

    private var storyAccessibilityValue: String {
        guard let stack = store.stack,
              let item = stack.items[safe: index] else {
            return "Loading"
        }
        return "\(stack.creator), story \(index + 1) of \(stack.items.count), \(item.assetKind.rawValue)"
    }

    private var pressToPauseGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(storyGestureCoordinateSpace))
            .updating($isPressingStoryMedia) { _, isPressing, _ in
                isPressing = true
                interactionLatencyTracker.beginTouchIfNeeded()
            }
    }

    private func storyMediaTapGesture(viewportSize: CGSize, safeAreaInsets: EdgeInsets) -> some Gesture {
        SpatialTapGesture(count: 2, coordinateSpace: .named(storyGestureCoordinateSpace))
            .onEnded { value in
                handleStoryMediaTap(value.location, doubleTap: true,
                    viewportSize: viewportSize, safeAreaInsets: safeAreaInsets)
            }
            .exclusively(before:
                SpatialTapGesture(coordinateSpace: .named(storyGestureCoordinateSpace))
                    .onEnded { value in
                        handleStoryMediaTap(value.location, doubleTap: false,
                            viewportSize: viewportSize, safeAreaInsets: safeAreaInsets)
                    }
            )
    }

    private func handleStoryMediaTap(_ location: CGPoint, doubleTap: Bool,
        viewportSize: CGSize, safeAreaInsets: EdgeInsets) {
        guard ownerSheet == nil, !isDismissTransitionActive,
              let stack = store.stack, let item = stack.items[safe: index] else { return }
        let topInset = max(safeAreaInsets.top + topChromeGap, topChromeMinimumInset)
            + 1.5 + 12 + storyActionSize + 14
        let bottomInset = bottomChromeHeight(for: stack)
            + bottomChromeBottomPadding(safeAreaBottom: safeAreaInsets.bottom)
        guard location.y >= topInset, location.y < viewportSize.height - bottomInset else { return }

        let horizontalFraction = location.x / max(viewportSize.width, 1)
        if horizontalFraction < 0.32 || horizontalFraction > 0.68 {
            handleStoryNavigationTap(direction: horizontalFraction < 0.32 ? -1 : 1, item: item)
        } else {
            interactionLatencyTracker.cancelTouch()
            if doubleTap {
                reactToStory(item)
            } else {
                toggleStoryChrome()
            }
        }
    }

    private func handleStoryNavigationTap(direction: Int, item: StoryStackItem) {
        guard ownerSheet == nil else {
            interactionLatencyTracker.cancelTouch()
            return
        }

        let interactionStartedAt = interactionLatencyTracker.consumeTouchStart()
        MediaPerformance.measure(
            "story_tap_recognized direction=\(direction > 0 ? "forward" : "backward")",
            since: interactionStartedAt
        )
        move(direction, item: item, interactionStartedAt: interactionStartedAt)
    }

    private func toggleStoryChrome() {
        UBEYEFeedback.selection()
        withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .snappy(duration: 0.2)) {
            isChromeVisible.toggle()
        }
    }

    private func reactToStory(_ item: StoryStackItem) {
        guard let stack = store.stack, !isOwnStack(stack), ownerSheet == nil else {
            return
        }

        UBEYEFeedback.impact(.medium, intensity: 0.95)
        reactionBurstTask?.cancel()
        withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.24, dampingFraction: 0.66)) {
            showsReactionBurst = true
        }
        reactionBurstTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(620))
            guard !Task.isCancelled else {
                return
            }
            withAnimation(.easeOut(duration: 0.16)) {
                showsReactionBurst = false
            }
        }
        Task {
            await store.sendReaction("❤️", item: item, api: api)
            if store.reactedStoryIds.contains(item.id) {
                UBEYEFeedback.success()
            } else {
                UBEYEFeedback.error()
            }
        }
    }

    private func replyComposer(_ item: StoryStackItem) -> some View {
        let fieldBackgroundOpacity = reduceTransparency ? 0.92 : (isReplyFieldFocused ? 0.62 : 0.48)
        let fieldBorderOpacity = isReplyFieldFocused ? 0.24 : 0.16

        return HStack(spacing: 10) {
            TextField(
                "",
                text: $store.replyText,
                prompt: Text("Reply").foregroundStyle(.white.opacity(0.86))
            )
                .textFieldStyle(.plain)
                .font(.body.weight(.semibold))
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
                Button {
                    showViewers(for: item)
                } label: {
                    stat("Views", stats.views)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(
                    "Show \(stats.views) story views from \(stats.uniqueViewers) viewers"
                )
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

    private func showViewers(for item: StoryStackItem) {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
            ownerSheet = .viewers(item)
        }
        Task {
            await store.loadViewers(item: item, api: api, force: true)
        }
    }

    private func showReplies(for item: StoryStackItem) {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
            ownerSheet = .replies(item)
        }
        Task {
            await store.loadReplies(item: item, api: api)
        }
    }

    @ViewBuilder
    private func storyOwnerSheet(_ sheet: StoryOwnerSheet, maxHeight: CGFloat) -> some View {
        switch sheet {
        case .viewers(let item):
            storyViewersSheet(item, maxHeight: maxHeight)
        case .replies(let item):
            storyRepliesSheet(item, maxHeight: maxHeight)
        }
    }

    private func storyViewersSheet(_ item: StoryStackItem, maxHeight: CGFloat) -> some View {
        let page = store.storyViewerPages[item.id]

        return StoryViewersBottomSheet(
            totalViewers: page?.totalViewers ?? item.stats?.uniqueViewers ?? 0,
            totalViews: page?.totalViews ?? item.stats?.views ?? 0,
            viewers: page?.viewers ?? [],
            isLoading: store.loadingViewersStoryId == item.id ||
                (page == nil && store.viewerErrors[item.id] == nil),
            isLoadingMore: store.loadingMoreViewersStoryId == item.id,
            hasMore: page?.nextCursor != nil,
            error: store.viewerErrors[item.id],
            loadMore: {
                Task { await store.loadMoreViewers(item: item, api: api) }
            },
            retry: {
                Task {
                    if page?.viewers.isEmpty == false {
                        await store.loadMoreViewers(item: item, api: api)
                    } else {
                        await store.loadViewers(item: item, api: api, force: true)
                    }
                }
            },
            close: {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
                    ownerSheet = nil
                }
            }
        )
        .frame(maxHeight: min(430, maxHeight * 0.52))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
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
                    ownerSheet = nil
                }
            }
        )
        .frame(maxHeight: min(360, maxHeight * 0.44))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var verticalStorySwipeGesture: some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .named(storyGestureCoordinateSpace))
            .onChanged { value in
                guard ownerSheet == nil, !isDismissTransitionActive else {
                    return
                }
                let axis = GestureIntentPolicy.axis(
                    translation: value.translation,
                    minimumDistance: 8,
                    dominanceRatio: verticalSwipeDominanceRatio
                )
                // A little sideways movement at touch-down must not lock out a downward swipe.
                if gestureAxis != .vertical, axis == .vertical {
                    gestureAxis = .vertical
                }
                guard gestureAxis == .vertical else {
                    return
                }

                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    verticalDragOffset = StoryDismissGesturePolicy.displayedOffset(
                        translation: value.translation.height,
                        viewportHeight: viewportHeight
                    )
                }

                let crossedThreshold = value.translation.height >= StoryDismissGesturePolicy.distanceThreshold(
                    viewportHeight: viewportHeight
                )
                if crossedThreshold, !didPlayDismissHaptic {
                    didPlayDismissHaptic = true
                    UBEYEFeedback.snap()
                }
            }
            .onEnded { value in
                handleVerticalStorySwipe(value)
            }
    }

    private func handleVerticalStorySwipe(_ value: DragGesture.Value) {
        defer {
            gestureAxis = .undecided
            didPlayDismissHaptic = false
            interactionLatencyTracker.cancelTouch()
        }
        guard ownerSheet == nil, !isDismissTransitionActive,
              let stack = store.stack,
              let item = stack.items[safe: index] else {
            return
        }

        switch StoryDismissGesturePolicy.outcome(
            axis: gestureAxis,
            translation: value.translation.height,
            predictedTranslation: value.predictedEndTranslation.height,
            viewportHeight: viewportHeight
        ) {
        case .ignored:
            MediaPerformance.mark("gesture_outcome surface=story axis=unclaimed outcome=ignored")
            withAnimation(UBEYEMotion.interactive(reduceMotion: reduceMotion, mode: resourceMonitor.mode)) {
                verticalDragOffset = 0
            }
        case .swipeUp:
            verticalDragOffset = 0
            MediaPerformance.mark("gesture_outcome surface=story axis=vertical direction=up outcome=reply_or_dismiss")
            handleStorySwipeUp(stack: stack, item: item)
        case .dismiss:
            // Flicks can dismiss before reaching the distance threshold. Give those
            // the same single haptic, without repeating feedback already felt while dragging.
            if !didPlayDismissHaptic {
                didPlayDismissHaptic = true
                UBEYEFeedback.snap()
            }
            MediaPerformance.mark("gesture_outcome surface=story axis=vertical direction=down outcome=dismissed")
            dismissStoryFromSwipe(item: item, velocity: value.velocity.height)
        case .cancel:
            MediaPerformance.mark("gesture_outcome surface=story axis=vertical direction=down outcome=cancelled")
            withAnimation(UBEYEMotion.interactive(reduceMotion: reduceMotion, mode: resourceMonitor.mode)) {
                verticalDragOffset = 0
            }
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

    private func dismissStoryFromSwipe(item: StoryStackItem, velocity: CGFloat? = nil) {
        guard !isDismissTransitionActive else { return }
        isDismissTransitionActive = true
        pendingFinishedItemId = nil
        completionDismissTask?.cancel()
        storyTimerState.stop()
        mediaPreparationTask?.cancel()
        Task { await store.recordImpression(item: item, completed: false, api: api) }
        guard let velocity else {
            dismiss()
            return
        }

        let finishDismissal = {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                dismiss()
            }
        }
        guard !reduceMotion else {
            finishDismissal()
            return
        }

        let destination = max(viewportHeight, verticalDragOffset) + 1
        let remainingDistance = max(destination - verticalDragOffset, 1)
        let initialVelocity = min(max(velocity, 0) / remainingDistance, 4)
        let duration = 0.24
        let initialControlY = Double(initialVelocity) * duration * 0.18
        MediaPerformance.mark("story_dismiss_motion from=\(Int(verticalDragOffset)) to=\(Int(destination)) velocity=\(Int(velocity))")
        // Continue from the finger's position and velocity, then remove the now-invisible
        // presentation without starting a second system slide or waiting on a timer.
        withAnimation(
            .timingCurve(0.18, initialControlY, 0.4, 1, duration: duration),
            completionCriteria: .logicallyComplete
        ) {
            verticalDragOffset = destination
        } completion: {
            MediaPerformance.mark("story_dismiss_motion_complete")
            finishDismissal()
        }
    }

    private func canReplyFromSwipe(_ stack: StoryStack) -> Bool {
        !isOwnStack(stack) && route.source != .discover && isFollowingCreator(stack)
    }

    private func move(
        _ delta: Int,
        item: StoryStackItem,
        interactionStartedAt: Date? = nil
    ) {
        let action = StoryNavigationPolicy.action(
            currentIndex: index,
            itemCount: store.stack?.items.count ?? 0,
            delta: delta
        )

        guard case let .move(to: nextIndex) = action else {
            if action == .finish {
                UBEYEFeedback.boundary()
                finishCurrentItem(item, trigger: .explicitNavigation)
            } else if action == .stay {
                UBEYEFeedback.boundary()
            }
            return
        }

        guard let stack = store.stack,
              let next = stack.items[safe: nextIndex] else {
            return
        }

        UBEYEFeedback.selection()

        let targetWasBuffered = StoryMediaBufferPolicy.indices(
            activeIndex: index,
            itemCount: stack.items.count,
            mode: resourceMonitor.mode
        ).contains(nextIndex)
        pendingTransitionMeasurement = StoryTransitionMeasurement(
            destinationItemId: next.id,
            direction: delta > 0 ? "forward" : "backward",
            sourceKind: item.assetKind,
            destinationKind: next.assetKind,
            startedAt: interactionStartedAt ?? Date()
        )
        Task { await store.recordImpression(item: item, completed: delta > 0, api: api) }
        ownerSheet = nil
        mediaEngine.recordViewerNavigation(delta: delta)
        mediaEngine.commitViewerIntent(stack: stack, index: nextIndex, activeIdentity: next.isPlayableVideo ? next.playbackIdentity : nil)
        index = nextIndex
        store.markActiveItem(next)
        resetStoryTimer(for: next)
        prepareStoryMediaAfterVisibleCommit(
            stack: stack,
            targetIndex: nextIndex,
            targetItem: next,
            targetWasBuffered: targetWasBuffered
        )
    }

    private func prepareStoryMediaAfterVisibleCommit(
        stack: StoryStack,
        targetIndex: Int,
        targetItem: StoryStackItem,
        targetWasBuffered: Bool
    ) {
        mediaPreparationTask?.cancel()
        mediaPreparationTask = Task { @MainActor in
            await Task.yield()
            guard index == targetIndex,
                  !Task.isCancelled,
                  store.stack?.items[safe: targetIndex]?.id == targetItem.id else { return }
            mediaEngine.prepare(
                stack: stack,
                around: targetIndex,
                activeIdentity: targetItem.isPlayableVideo ? targetItem.playbackIdentity : nil,
                promoteActiveIfNeeded: !targetWasBuffered
            )
            mediaPreparationTask = nil
        }
    }

    private func completeStoryTransitionIfNeeded(for item: StoryStackItem) {
        if route.source != .ownStory, !item.isProcessingVideo, store.stack?.items[safe: index]?.id == item.id {
            StoryDeliveryMeasurements.shared.observe(storyID: item.id, phase: "first_frame", openedAt: pendingTransitionMeasurement?.startedAt ?? route.openedAt)
        }
        guard let measurement = pendingTransitionMeasurement,
              measurement.destinationItemId == item.id else {
            return
        }

        pendingTransitionMeasurement = nil
        MediaPerformance.measure(
            "story_transition_visible direction=\(measurement.direction) from=\(measurement.sourceKind.rawValue) to=\(measurement.destinationKind.rawValue)",
            since: measurement.startedAt
        )
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
        return StoryWarmOrder.indices(active: itemIndex, count: stack.items.count, mode: resourceMonitor.mode, direction: mediaEngine.viewerNavigationDirection)
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
        pendingFinishedItemId = nil
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

        guard !shouldPauseStoryProgress else {
            pendingFinishedItemId = item.id
            return
        }

        pendingFinishedItemId = nil
        finishCurrentItem(item)
    }

    private func finishCurrentItem(
        _ item: StoryStackItem,
        trigger: StoryCompletionTrigger = .automaticPlayback
    ) {
        guard let stack = store.stack, !didFinishCurrentItem else {
            return
        }

        guard !StoryCompletionPolicy.shouldDefer(
            trigger: trigger,
            progressIsPaused: shouldPauseStoryProgress
        ) else {
            pendingFinishedItemId = item.id
            return
        }

        pendingFinishedItemId = nil
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
        if height > 0, let keyboardRequestStartedAt {
            MediaPerformance.measure(
                "keyboard_latency surface=story_reply phase=will_change_frame",
                since: keyboardRequestStartedAt
            )
            self.keyboardRequestStartedAt = nil
        }
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
        StoryProgressPausePolicy.shouldPause(
            playbackIsPaused: shouldPauseVideoPlayback,
            isPressingMedia: isPressingStoryMedia,
            isDismissTransitionActive: isDismissTransitionActive,
            isWaitingForVideo: isWaitingForCurrentVideo
        )
    }

    private var shouldPauseVideoPlayback: Bool {
        isDismissTransitionActive || StoryViewerPausePolicy(
            sceneIsActive: scenePhase == .active,
            isPressingPlayableVideo: isPressingCurrentVideo,
            isReplyFieldFocused: isReplyFieldFocused,
            isOwnerSheetPresented: ownerSheet != nil,
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

    private func presentGestureHintIfNeeded() {
        let hintKey = "story-navigation-v2"
        guard route.source != .ownStory,
              !voiceOverEnabled,
              UBEYEContextualHintStore.shared.shouldShow(hintKey) else {
            return
        }

        withAnimation(UBEYEMotion.reveal(reduceMotion: reduceMotion, mode: resourceMonitor.mode)) {
            showsGestureHint = true
        }
        gestureHintDismissTask?.cancel()
        gestureHintDismissTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(4.5))
            guard !Task.isCancelled else { return }
            dismissGestureHint()
        }
    }

    private func dismissGestureHint() {
        gestureHintDismissTask?.cancel()
        gestureHintDismissTask = nil
        UBEYEContextualHintStore.shared.markSeen("story-navigation-v2")
        withAnimation(UBEYEMotion.reveal(reduceMotion: reduceMotion, mode: resourceMonitor.mode)) {
            showsGestureHint = false
        }
    }
}

private struct StoryViewerLoadingPlaceholder: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [.black, Color.ubeyeNavy.opacity(0.9), .black],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    UBEYESkeletonCircle(size: 42)
                    VStack(alignment: .leading, spacing: 7) {
                        UBEYESkeletonLine(width: 116, height: 12)
                        UBEYESkeletonLine(width: 72, height: 9)
                    }
                    Spacer()
                    UBEYESkeletonCircle(size: 42)
                }
                .padding(.horizontal, 16)
                .padding(.top, 64)

                Spacer()

                ProgressView()
                    .tint(.white)
                    .controlSize(.large)
                    .opacity(reduceMotion ? 0.75 : 1)

                Spacer()

                Capsule()
                    .fill(.white.opacity(0.14))
                    .frame(height: 46)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 34)
            }
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading story")
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

private struct StoryViewersBottomSheet: View {
    let totalViewers: Int
    let totalViews: Int
    let viewers: [StoryViewerProfile]
    let isLoading: Bool
    let isLoadingMore: Bool
    let hasMore: Bool
    let error: String?
    let loadMore: () -> Void
    let retry: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header

            if isLoading && viewers.isEmpty {
                loadingState
            } else if let error, viewers.isEmpty {
                errorState(error)
            } else if viewers.isEmpty {
                emptyState
            } else {
                viewerList
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
                    Text("Viewers")
                        .font(.system(size: 16, weight: .semibold))
                    Text(storyViewerSummary(totalViewers: totalViewers, totalViews: totalViews))
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
                .accessibilityLabel("Close viewers")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 12)
    }

    private var viewerList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(viewers) { viewer in
                    StoryViewerPreviewRow(viewer: viewer)
                        .onAppear {
                            if hasMore,
                               error == nil,
                               viewer.id == viewers.last?.id {
                                loadMore()
                            }
                        }
                }

                if isLoadingMore {
                    ProgressView()
                        .tint(.white)
                        .padding(.vertical, 12)
                } else if let error {
                    paginationError(error)
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
            Text("Loading viewers")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity, minHeight: 170)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "eye")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white.opacity(0.55))
            Text("No viewers yet")
                .font(.system(size: 14, weight: .semibold))
            Text("People who view this story will appear here.")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(.white.opacity(0.55))
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, minHeight: 170)
        .padding(.horizontal, 24)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 10) {
            Text(message)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.72))
                .multilineTextAlignment(.center)

            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 170)
        .padding(.horizontal, 24)
    }

    private func paginationError(_ message: String) -> some View {
        VStack(spacing: 8) {
            Text(message)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.65))
                .multilineTextAlignment(.center)
            retryButton
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 18)
    }

    private var retryButton: some View {
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
}

private struct StoryViewerPreviewRow: View {
    let viewer: StoryViewerProfile

    var body: some View {
        HStack(spacing: 10) {
            RemoteAvatar(url: viewer.imageUrl, size: 38, name: viewer.name)
                .overlay(Circle().stroke(.white.opacity(0.12), lineWidth: 1))

            VStack(alignment: .leading, spacing: 3) {
                Text(viewer.name)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text("@\(viewer.handle)")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(.white.opacity(0.5))
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 3) {
                Text(storyViewerTimestamp(viewer.lastViewedAt))
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(.white.opacity(0.5))
                    .lineLimit(1)

                if viewer.viewCount > 1 {
                    Text("\(viewer.viewCount) views")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.white.opacity(0.62))
                        .lineLimit(1)
                }
            }
        }
        .padding(10)
        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(viewer.name), at \(viewer.handle), \(viewer.viewCount) views, last viewed \(storyViewerTimestamp(viewer.lastViewedAt))"
        )
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

private func storyViewerSummary(totalViewers: Int, totalViews: Int) -> String {
    let people = totalViewers == 1 ? "1 person" : "\(totalViewers) people"
    let views = totalViews == 1 ? "1 total view" : "\(totalViews) total views"
    return "\(people) · \(views)"
}

private func storyViewerTimestamp(_ value: String) -> String {
    guard let date = ISO8601DateFormatter.storyReplyWithFractionalSeconds.date(from: value) ??
        ISO8601DateFormatter.storyReply.date(from: value) else {
        return value
    }

    return RelativeDateTimeFormatter.storyViewer.localizedString(for: date, relativeTo: Date())
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

private extension RelativeDateTimeFormatter {
    static let storyViewer: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.dateTimeStyle = .numeric
        formatter.unitsStyle = .abbreviated
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
    let isVideo: Bool
    let isMuted: Bool
    let canDeleteStory: Bool
    let actionSize: CGFloat
    let isPerformingAction: Bool
    let deleteStory: () -> Void
    let reportStory: () -> Void
    let blockCreator: () -> Void
    let canUnfollowCreator: Bool
    let unfollowCreator: () -> Void
    let toggleMute: () -> Void
    let close: () -> Void

    @State private var isActionDialogPresented = false

    var body: some View {
        HStack(spacing: 16) {
            if isVideo {
                Button(action: toggleMute) {
                    StoryViewerActionIcon(
                        systemImage: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill",
                        size: actionSize,
                        fontSize: 17
                    )
                }
                .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
                .accessibilityLabel(isMuted ? "Unmute story" : "Mute story")
                .accessibilityValue(isMuted ? "Muted" : "Sound on")
            }

            if isOwnStack {
                if canDeleteStory {
                    Button(action: deleteStory) {
                        StoryViewerActionIcon(systemImage: "trash", size: actionSize, fontSize: 18)
                    }
                    .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
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
                .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
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
            .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
            .accessibilityLabel("Close story")
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

