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

    var body: some View {
        ZStack {
            ForEach(AppTab.allCases) { tab in
                if visitedTabs.contains(tab) {
                    ZStack {
                        tabContent(tab)
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
        .task {
            await PendingSocialActionQueue.shared.flush(api: api)
            let resumed = await pendingStoryUploads.resumeInterruptedUploads(api: api)
            for response in resumed {
                storyUploadCoordinator.register(
                    response,
                    api: api,
                    notice: storyUploadNotice,
                    pendingUploads: pendingStoryUploads
                )
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
        case processing
        case delayed
        case posted
        case review(String?)
        case failed(String)
    }

    @Published var state: State?
    private var dismissTask: Task<Void, Never>?

    var title: String {
        switch state {
        case .posting:
            "Uploading story…"
        case .processing:
            "Processing video…"
        case .delayed:
            "Video processing delayed"
        case .posted:
            "Added to your story"
        case .review:
            "Story is under review"
        case .failed:
            "Story upload failed"
        case nil:
            ""
        }
    }

    var message: String {
        switch state {
        case .posting:
            "Your story is visible in My Story while it uploads."
        case .processing:
            "Preparing a streamable version now. Higher quality will continue in the background."
        case .delayed:
            "Your upload is safe. We’ll keep trying to prepare it in the background."
        case .posted:
            "Your story is ready to play."
        case .review(let reason):
            reason ?? "It will appear if it passes safety review."
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
        case .processing:
            "video.fill"
        case .delayed:
            "clock.badge.exclamationmark.fill"
        case .posted:
            "checkmark.circle.fill"
        case .review:
            "shield.lefthalf.filled"
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

    func showProcessing() {
        dismissTask?.cancel()
        state = .processing
    }

    func showDelayed() {
        dismissTask?.cancel()
        state = .delayed
    }

    func showPosted() {
        dismissTask?.cancel()
        state = .posted
        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            await MainActor.run {
                self?.state = nil
            }
        }
    }

    func showReview(reason: String?) {
        dismissTask?.cancel()
        state = .review(reason)
    }

    func showFailed(message: String) {
        dismissTask?.cancel()
        state = .failed(message)
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
                    .frame(height: 52)
                    .contentShape(Rectangle())
                }
                .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.92, pressedOpacity: 0.74))
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
                .accessibilityHint(selectedTab == tab ? "Double tap to return to the top and refresh" : "Double tap to open")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 7)
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
