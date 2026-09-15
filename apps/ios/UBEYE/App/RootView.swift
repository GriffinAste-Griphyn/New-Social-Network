import SwiftUI

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        Group {
            if auth.isRestoringSession {
                SessionRestoreView()
            } else if auth.account == nil {
                AuthView()
            } else {
                MainTabView()
                    .id(auth.account?.email)
            }
        }
        .transaction { transaction in
            transaction.animation = nil
        }
    }
}

private struct SessionRestoreView: View {
    var body: some View {
        VStack(spacing: 18) {
            UBEYEWordmark()

            ProgressView()
                .tint(.ubeyeRed)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ubeyeScreen()
    }
}

struct MainTabView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var pendingStoryUploads: PendingStoryUploadStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject private var network = NetworkQualityMonitor.shared
    @ObservedObject private var resourceMonitor = UBEYEResourceMonitor.shared
    @StateObject private var storyUploadNotice = StoryUploadNoticeStore()
    @StateObject private var storyUploadCoordinator = StoryUploadCoordinator()
    @State private var selectedTab: AppTab = .home
    @State private var visitedTabs: Set<AppTab> = [.home]
    @SceneStorage("ubeye.selected-tab") private var restoredTabRawValue = AppTab.home.rawValue
    @State private var discoverSearchFocusRequest = 0
    @State private var isShowingProfile = false
    @State private var pendingQuotedReply: QuotedStoryReply?
    @State private var hasObservedOfflineState = false
    @State private var showsReconnectedBanner = false
    @State private var reconnectBannerTask: Task<Void, Never>?
    @State private var selectedUploadNeedingAttention: PendingStoryUpload?

    var body: some View {
        ZStack {
            ForEach(AppTab.allCases) { tab in
                if visitedTabs.contains(tab) {
                    ZStack {
                        tabContent(tab)
                            .environment(\.isTabActive, selectedTab == tab)
                    }
                        .opacity(selectedTab == tab ? 1 : 0)
                        .allowsHitTesting(selectedTab == tab)
                        .accessibilityHidden(selectedTab != tab)
                        .accessibilityRespondsToUserInteraction(selectedTab == tab)
                        .zIndex(selectedTab == tab ? 1 : 0)
                }
            }

            if !network.isConnected || showsReconnectedBanner {
                ConnectivityBanner(isOffline: !network.isConnected)
                    .padding(.top, 62)
                    .padding(.horizontal, 62)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(200)
            }
        }
        .environmentObject(storyUploadNotice)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            AppBottomBar(selectedTab: selectedTab, select: selectTab)
        }
        .overlay(alignment: .bottom) {
            GlobalStoryUploadActivitySurface(
                pendingUploads: pendingStoryUploads,
                notice: storyUploadNotice,
                onNeedsAttention: { upload in
                    selectedUploadNeedingAttention = upload
                }
            )
            .padding(.horizontal, UBEYEMetrics.screenInset)
            .padding(.bottom, UBEYEMetrics.bottomBarHeight + 12)
        }
        .ignoresSafeArea(
            selectedTab == .post ? .keyboard : [],
            edges: .bottom
        )
        .overlay(alignment: .topTrailing) {
            FixedAccountAvatarOverlay {
                isShowingProfile = true
            }
            .padding(.horizontal, UBEYEMetrics.screenInset)
            .padding(.top, UBEYEMetrics.topAvatarTopInset)
        }
        .sheet(isPresented: $isShowingProfile) {
            ProfileView()
        }
        .alert(item: $selectedUploadNeedingAttention) { upload in
            Alert(
                title: Text("Story upload needs attention"),
                message: Text(upload.displayErrorMessage),
                primaryButton: .default(Text("Retry")) {
                    retryPendingUpload(upload)
                },
                secondaryButton: .destructive(Text("Remove")) {
                    pendingStoryUploads.remove(id: upload.id)
                    if pendingStoryUploads.latestVisibleUpload == nil {
                        storyUploadNotice.state = nil
                    }
                }
            )
        }
        .onAppear {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-story-composer-selected-photo-fixture") {
                visitedTabs.insert(.post)
                selectedTab = .post
                return
            }
            #endif

            if let restoredTab = AppTab(rawValue: restoredTabRawValue) {
                visitedTabs.insert(restoredTab)
                selectedTab = restoredTab
            }
        }
        .onChange(of: selectedTab) { _, tab in
            visitedTabs.insert(tab)
            restoredTabRawValue = tab.rawValue
        }
        .onChange(of: network.isConnected) { wasConnected, isConnected in
            handleConnectivityChange(wasConnected: wasConnected, isConnected: isConnected)
        }
        .onReceive(NotificationCenter.default.publisher(for: PendingStoryUploadStore.recoveredCompletionAvailable)) { _ in
            if scenePhase == .active { presentRecoveredStoryUploads() }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else {
                return
            }
            Task {
                await resumeInterruptedStoryUploads()
                presentRecoveredStoryUploads()
                storyUploadNotice.didBecomeActive()
            }
        }
        .task {
            await PendingSocialActionQueue.shared.flush(api: api)
            await resumeInterruptedStoryUploads()
            if scenePhase == .active {
                presentRecoveredStoryUploads()
            }
        }
    }

    @ViewBuilder
    private func tabContent(_ tab: AppTab) -> some View {
        switch tab {
        case .home:
            HomeView(
                uploadedStoryRegistrations: storyUploadCoordinator.registrations,
                onSearchTap: {
                    discoverSearchFocusRequest += 1
                    selectTab(.discover)
                },
                onDiscoverTap: {
                    selectTab(.discover)
                },
                onPendingUploadRetried: { response in
                    storyUploadCoordinator.register(
                        response,
                        api: api,
                        notice: storyUploadNotice,
                        pendingUploads: pendingStoryUploads
                    )
                }
            )
        case .following:
            FollowingView()
        case .post:
            StoryComposerView(
                isActive: selectedTab == .post,
                quotedReply: pendingQuotedReply,
                clearQuotedReply: {
                    pendingQuotedReply = nil
                },
                onPendingUploadStarted: {
                    pendingQuotedReply = nil
                    selectTab(.home)
                    storyUploadNotice.showPosting()
                },
                onUploadRegistered: { response in
                    pendingQuotedReply = nil
                    selectTab(.home)
                    storyUploadCoordinator.register(
                        response,
                        api: api,
                        notice: storyUploadNotice,
                        pendingUploads: pendingStoryUploads
                    )
                }
            )
        case .discover:
            DiscoverView(searchFocusRequest: discoverSearchFocusRequest)
        case .replies:
            RepliesView { quote in
                pendingQuotedReply = quote
                selectTab(.post)
            }
        }
    }

    private func selectTab(_ tab: AppTab) {
        switch AppTabSelectionPolicy.decision(current: selectedTab, requested: tab) {
        case .reselect:
            UBEYEFeedback.selection()
            NotificationCenter.default.post(name: .appTabReselected, object: tab.rawValue)
            return
        case .switchTo:
            break
        }

        UBEYEFeedback.selection()
        withAnimation(
            UBEYEMotion.reveal(
                reduceMotion: reduceMotion,
                mode: resourceMonitor.mode
            )
        ) {
            selectedTab = tab
        }
    }

    private func resumeInterruptedStoryUploads() async {
        _ = await pendingStoryUploads.resumeInterruptedUploads(api: api)
    }

    private func presentRecoveredStoryUploads() {
        Task { @MainActor in
            for response in await pendingStoryUploads.takeRecoveredCompletions() {
                storyUploadCoordinator.register(
                    response,
                    api: api,
                    notice: storyUploadNotice,
                    pendingUploads: pendingStoryUploads
                )
            }
        }
    }

    private func retryPendingUpload(_ upload: PendingStoryUpload) {
        storyUploadNotice.showPosting()
        Task {
            do {
                let response = try await pendingStoryUploads.retry(id: upload.id, api: api)
                storyUploadCoordinator.register(
                    response,
                    api: api,
                    notice: storyUploadNotice,
                    pendingUploads: pendingStoryUploads
                )
            } catch {
                storyUploadNotice.showFailed(message: error.localizedDescription)
            }
        }
    }

    private func handleConnectivityChange(wasConnected: Bool, isConnected: Bool) {
        reconnectBannerTask?.cancel()

        if !isConnected {
            hasObservedOfflineState = true
            showsReconnectedBanner = false
            return
        }

        guard hasObservedOfflineState, !wasConnected else {
            return
        }

        UBEYEFeedback.success()
        showsReconnectedBanner = true
        Task {
            await PendingSocialActionQueue.shared.flush(api: api)
            await resumeInterruptedStoryUploads()
            if scenePhase == .active {
                presentRecoveredStoryUploads()
            }
        }
        reconnectBannerTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else {
                return
            }
            withAnimation(.easeOut(duration: 0.18)) {
                showsReconnectedBanner = false
            }
        }
    }
}

struct StoryUploadActivityPresentation: Equatable {
    let title: String
    let message: String
    let systemImage: String
    let progress: Double?
    let showsIndeterminateProgress: Bool
    let needsAttention: Bool
}

enum StoryUploadActivityPolicy {
    static func presentation(
        state: PendingStoryUploadState,
        assetKind: SocialAssetKind,
        progress: Double,
        errorMessage: String?
    ) -> StoryUploadActivityPresentation {
        let clampedProgress = min(max(progress, 0), 1)
        switch state {
        case .queued:
            return StoryUploadActivityPresentation(
                title: "Story queued",
                message: "Your story is saved and will upload in the background.",
                systemImage: "clock.arrow.circlepath",
                progress: clampedProgress,
                showsIndeterminateProgress: false,
                needsAttention: false
            )
        case .recovering:
            return StoryUploadActivityPresentation(
                title: "Resuming upload…",
                message: "Your story is safe. Uploading will continue automatically.",
                systemImage: "arrow.clockwise.circle.fill",
                progress: clampedProgress,
                showsIndeterminateProgress: true,
                needsAttention: false
            )
        case .uploading:
            return StoryUploadActivityPresentation(
                title: "Uploading · \(Int((clampedProgress * 100).rounded()))%",
                message: "You can keep using UBEYE or leave the app.",
                systemImage: "arrow.up.circle.fill",
                progress: clampedProgress,
                showsIndeterminateProgress: false,
                needsAttention: false
            )
        case .completing:
            return StoryUploadActivityPresentation(
                title: assetKind == .video ? "Processing video…" : "Processing photo…",
                message: "Your story is safe and finishing in the background.",
                systemImage: assetKind == .video ? "video.fill" : "photo.fill",
                progress: nil,
                showsIndeterminateProgress: true,
                needsAttention: false
            )
        case .paused:
            return StoryUploadActivityPresentation(
                title: "Upload paused",
                message: errorMessage ?? "We’ll retry automatically when the app reconnects.",
                systemImage: "pause.circle.fill",
                progress: nil,
                showsIndeterminateProgress: false,
                needsAttention: true
            )
        case .failed:
            return StoryUploadActivityPresentation(
                title: "Upload needs attention",
                message: errorMessage ?? "Tap to retry without losing your story.",
                systemImage: "exclamationmark.circle.fill",
                progress: nil,
                showsIndeterminateProgress: false,
                needsAttention: true
            )
        }
    }
}

private struct GlobalStoryUploadActivitySurface: View {
    @ObservedObject var pendingUploads: PendingStoryUploadStore
    @ObservedObject var notice: StoryUploadNoticeStore
    let onNeedsAttention: (PendingStoryUpload) -> Void

    var body: some View {
        Group {
            if showsDebugFixture {
                GlobalStoryUploadActivityCard(
                    title: "Uploading · 43%",
                    message: "You can keep using UBEYE or leave the app.",
                    systemImage: "arrow.up.circle.fill",
                    progress: 0.43,
                    showsIndeterminateProgress: false,
                    needsAttention: false,
                    action: nil
                )
            } else if let batch = pendingUploads.latestBatchSummary {
                let failedUpload = batch.uploads.first(where: \.isFailed)
                GlobalStoryUploadActivityCard(
                    title: batchTitle(batch),
                    message: batchMessage(batch),
                    systemImage: failedUpload == nil ? "arrow.up.circle.fill" : "exclamationmark.circle.fill",
                    progress: failedUpload == nil ? batch.progress : nil,
                    showsIndeterminateProgress: false,
                    needsAttention: failedUpload != nil,
                    action: failedUpload.map { upload in
                        { onNeedsAttention(upload) }
                    }
                )
            } else if let upload = pendingUploads.latestVisibleUpload {
                let presentation = StoryUploadActivityPolicy.presentation(
                    state: upload.state,
                    assetKind: upload.assetKind,
                    progress: upload.displayProgress,
                    errorMessage: upload.errorMessage
                )
                GlobalStoryUploadActivityCard(
                    title: presentation.title,
                    message: presentation.message,
                    systemImage: presentation.systemImage,
                    progress: presentation.progress,
                    showsIndeterminateProgress: presentation.showsIndeterminateProgress,
                    needsAttention: presentation.needsAttention,
                    action: presentation.needsAttention ? { onNeedsAttention(upload) } : nil
                )
            } else if notice.state != nil {
                GlobalStoryUploadActivityCard(
                    title: notice.title,
                    message: notice.message,
                    systemImage: notice.systemImage,
                    progress: notice.state == .posted ? 1 : nil,
                    showsIndeterminateProgress: notice.isProcessing,
                    needsAttention: notice.isFailure,
                    action: nil
                )
            }
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .animation(.snappy(duration: 0.24), value: activityIdentity)
    }

    private var activityIdentity: String {
        if showsDebugFixture {
            return "debug-fixture"
        }
        if let upload = pendingUploads.latestVisibleUpload {
            return "\(upload.id)|\(upload.state.rawValue)|\(Int(upload.displayProgress * 100))"
        }
        return String(describing: notice.state)
    }

    private var showsDebugFixture: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-story-upload-activity-fixture")
        #else
        false
        #endif
    }

    private func batchTitle(_ batch: PendingStoryUploadBatchSummary) -> String {
        if batch.failedCount > 0 {
            return "\(batch.failedCount) stor\(batch.failedCount == 1 ? "y" : "ies") need attention"
        }
        return "Posting \(min(batch.completedCount + 1, batch.totalCount)) of \(batch.totalCount)"
    }

    private func batchMessage(_ batch: PendingStoryUploadBatchSummary) -> String {
        if batch.failedCount > 0 {
            return "Tap to retry. Your original media is still safe."
        }
        if batch.unavailableCount > 0 {
            return "Some stories could not be queued or are no longer pending. Other stories will continue uploading."
        }
        return "You can keep using UBEYE or leave the app."
    }
}

private struct GlobalStoryUploadActivityCard: View {
    let title: String
    let message: String
    let systemImage: String
    let progress: Double?
    let showsIndeterminateProgress: Bool
    let needsAttention: Bool
    let action: (() -> Void)?

    var body: some View {
        Group {
            if let action {
                Button(action: action) {
                    content
                }
                .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.985, pressedOpacity: 0.9))
            } else {
                content
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(needsAttention ? "Double tap for upload options" : "")
    }

    private var content: some View {
        VStack(spacing: 9) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(needsAttention ? Color.orange : Color.ubeyeRed, in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.ubeyeInk)
                        .contentTransition(.numericText())
                    Text(message)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(2)
                }

                Spacer(minLength: 8)

                if needsAttention {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.ubeyeMuted)
                }
            }

            if progress != nil || showsIndeterminateProgress {
                Group {
                    if showsIndeterminateProgress {
                        ProgressView()
                    } else {
                        ProgressView(value: progress ?? 0, total: 1)
                    }
                }
                .progressViewStyle(.linear)
                .tint(Color.ubeyeRed)
            }
        }
        .padding(12)
        .background(.white.opacity(0.98), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.ubeyeBorder, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
    }
}

extension Notification.Name {
    static let appTabReselected = Notification.Name("ubeye.appTabReselected")
}

private struct ConnectivityBanner: View {
    let isOffline: Bool

    var body: some View {
        Label(
            isOffline ? "Offline · showing saved content" : "Back online",
            systemImage: isOffline ? "wifi.slash" : "wifi"
        )
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .frame(minHeight: 38)
        .background(isOffline ? Color.ubeyeNavy.opacity(0.92) : Color.green.opacity(0.92), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.18), lineWidth: 1))
        .shadow(color: .black.opacity(0.2), radius: 12, y: 5)
        .accessibilityLabel(isOffline ? "Offline. Showing saved content." : "Back online")
    }
}

@MainActor
final class StoryUploadNoticeStore: ObservableObject {
    enum State: Equatable {
        case posting
        case processing(SocialAssetKind)
        case delayed(SocialAssetKind)
        case posted
        case review(String?)
        case rejected(String?)
        case failed(String)
    }

    @Published var state: State?
    private var dismissTask: Task<Void, Never>?

    var isProcessing: Bool {
        if case .processing = state {
            return true
        }
        return false
    }

    var isFailure: Bool {
        if case .failed = state {
            return true
        }
        if case .rejected = state {
            return true
        }
        return false
    }

    var title: String {
        switch state {
        case .posting:
            "Uploading story…"
        case .processing(let assetKind):
            assetKind == .image ? "Processing photo…" : "Processing video…"
        case .delayed(let assetKind):
            assetKind == .image ? "Photo processing delayed" : "Video processing delayed"
        case .posted:
            "Added to your story"
        case .review:
            "Story is under review"
        case .rejected:
            "Story could not be posted"
        case .failed:
            "Story upload failed"
        case nil:
            ""
        }
    }

    var message: String {
        switch state {
        case .posting:
            "You can leave the app while your story uploads."
        case .processing(let assetKind):
            assetKind == .image
                ? "Preparing optimized versions now. Your photo will finish in the background."
                : "Preparing a streamable version now. Higher quality will continue in the background."
        case .delayed(let assetKind):
            assetKind == .image
                ? "Your photo is safe. We’ll keep trying to prepare it in the background."
                : "Your video is safe. We’ll keep trying to prepare it in the background."
        case .posted:
            "Your story is ready to play."
        case .review(let reason):
            reason ?? "It will appear if it passes safety review."
        case .rejected(let reason):
            reason ?? "This story did not pass safety review."
        case .failed(let message):
            message
        case nil:
            ""
        }
    }

    var systemImage: String {
        switch state {
        case .posting:
            "arrow.up.circle.fill"
        case .processing(let assetKind):
            assetKind == .image ? "photo.fill" : "video.fill"
        case .delayed:
            "clock.badge.exclamationmark.fill"
        case .posted:
            "checkmark.circle.fill"
        case .review:
            "shield.lefthalf.filled"
        case .rejected:
            "exclamationmark.shield.fill"
        case .failed:
            "exclamationmark.circle.fill"
        case nil:
            "checkmark.circle.fill"
        }
    }

    func showPosting() {
        dismissTask?.cancel()
        state = .posting
    }

    func showProcessing(assetKind: SocialAssetKind) {
        dismissTask?.cancel()
        state = .processing(assetKind)
    }

    func showDelayed(assetKind: SocialAssetKind) {
        dismissTask?.cancel()
        state = .delayed(assetKind)
    }

    func showPosted() {
        dismissTask?.cancel()
        state = .posted
        if UIApplication.shared.applicationState == .active {
            UBEYEFeedback.success()
        }
        schedulePostedDismissalIfActive()
    }

    func didBecomeActive() {
        guard state == .posted else {
            return
        }
        schedulePostedDismissalIfActive()
    }

    private func schedulePostedDismissalIfActive() {
        guard UIApplication.shared.applicationState == .active else {
            return
        }
        dismissTask?.cancel()
        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else {
                return
            }
            await MainActor.run {
                self?.state = nil
            }
        }
    }

    func showReview(reason: String?) {
        dismissTask?.cancel()
        state = .review(reason)
    }

    func showRejected(reason: String?) {
        dismissTask?.cancel()
        state = .rejected(reason)
        if UIApplication.shared.applicationState == .active {
            UBEYEFeedback.error()
        }
    }

    func showFailed(message: String) {
        dismissTask?.cancel()
        state = .failed(message)
        if UIApplication.shared.applicationState == .active {
            UBEYEFeedback.error()
        }
    }
}

private struct FixedAccountAvatarOverlay: View {
    @EnvironmentObject private var auth: AuthStore
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            RemoteAvatar(
                url: auth.account?.avatarUrl,
                size: UBEYEMetrics.topAvatar,
                name: auth.account?.displayName ?? auth.account?.handle ?? ""
            )
        }
        .buttonStyle(UBEYEPressButtonStyle())
        .accessibilityLabel("Profile")
        .frame(width: 48, height: 48)
        .contentShape(Circle())
        .zIndex(100)
    }
}

enum AppTab: String, CaseIterable, Identifiable, Hashable {
    case home
    case following
    case post
    case discover
    case replies

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "Home"
        case .following: "Following"
        case .post: "Post"
        case .discover: "Discover"
        case .replies: "Replies"
        }
    }

    var systemImage: String {
        switch self {
        case .home: "house"
        case .following: "play.circle"
        case .post: "plus"
        case .discover: "safari"
        case .replies: "ellipsis.message"
        }
    }
}

enum AppTabSelectionDecision: Equatable {
    case switchTo(AppTab)
    case reselect(AppTab)
}

enum AppTabSelectionPolicy {
    static func decision(current: AppTab, requested: AppTab) -> AppTabSelectionDecision {
        current == requested ? .reselect(requested) : .switchTo(requested)
    }
}

struct AppBottomBar: View {
    let selectedTab: AppTab
    let select: (AppTab) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                Button {
                    select(tab)
                } label: {
                    ZStack(alignment: .bottom) {
                        if tab == .post {
                            Circle()
                                .fill(Color.ubeyeInk)
                                .frame(width: 46, height: 46)
                        }

                        Image(systemName: tab.systemImage)
                            .font(.system(size: iconFontSize(for: tab), weight: .semibold))
                            .symbolVariant(selectedTab == tab && tab != .post ? .fill : .none)
                            .foregroundStyle(tab == .post ? .white : tabColor(for: tab))
                            .frame(width: iconFrameSize(for: tab), height: iconFrameSize(for: tab))
                            .offset(x: iconOpticalOffset(for: tab))

                        if selectedTab == tab, tab != .post {
                            Capsule()
                                .fill(Color.ubeyeRed)
                                .frame(width: 18, height: 2.5)
                                .offset(y: 4)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: UBEYEMetrics.bottomBarItemHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.92, pressedOpacity: 0.74))
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
                .accessibilityHint(selectedTab == tab ? "Double tap to return to the top and refresh" : "Double tap to open")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, UBEYEMetrics.bottomBarTopPadding)
        .padding(.bottom, UBEYEMetrics.bottomBarBottomPadding)
        .background(.white.opacity(0.98))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.ubeyeBorder.opacity(0.9))
                .frame(height: 1)
        }
    }

    private func iconFontSize(for tab: AppTab) -> CGFloat {
        switch tab {
        case .post:
            return 26
        case .home:
            return 21
        default:
            return 24
        }
    }

    private func iconFrameSize(for tab: AppTab) -> CGFloat {
        switch tab {
        case .post:
            return 46
        case .home:
            return 30
        default:
            return 32
        }
    }

    private func iconOpticalOffset(for tab: AppTab) -> CGFloat {
        tab == .following ? -1.5 : 0
    }

    private func tabColor(for tab: AppTab) -> Color {
        selectedTab == tab ? .ubeyeRed : .ubeyeMuted.opacity(0.82)
    }
}
