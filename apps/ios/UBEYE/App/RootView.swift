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
        .animation(.snappy, value: auth.isRestoringSession)
        .animation(.snappy, value: auth.account?.mobileToken)
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
    @StateObject private var storyUploadNotice = StoryUploadNoticeStore()
    @State private var selectedTab: AppTab = .home
    @State private var discoverSearchFocusRequest = 0
    @State private var isShowingProfile = false

    var body: some View {
        ZStack {
            switch selectedTab {
            case .home:
                HomeView(
                    onSearchTap: {
                        discoverSearchFocusRequest += 1
                        selectedTab = .discover
                    },
                    onDiscoverTap: {
                        selectedTab = .discover
                    }
                )
            case .following:
                FollowingView()
            case .post:
                StoryComposerView { response in
                    handleStoryUpload(response)
                }
            case .discover:
                DiscoverView(searchFocusRequest: discoverSearchFocusRequest)
            case .replies:
                RepliesView()
            }
        }
        .environmentObject(storyUploadNotice)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            AppBottomBar(selectedTab: $selectedTab)
        }
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
    }

    private func handleStoryUpload(_ response: StoryUploadResponse) {
        selectedTab = .home
        if let thumbnailUrl = response.asset.thumbnailUrl {
            MediaImageCache.shared.preheat([thumbnailUrl], limit: 1)
        }

        if response.asset.assetKind == .video && response.processingStatus != "ready" {
            storyUploadNotice.showProcessing()
            Task {
                let isLive = await api.waitForStoryLive(storyId: response.storyId)
                guard isLive else {
                    return
                }
                await MainActor.run {
                    api.invalidateStoryStacks(ids: ["my-story", response.storyId])
                    storyUploadNotice.showPosted()
                    NotificationCenter.default.post(name: .storyUploadDidComplete, object: nil)
                }
            }
        } else {
            api.invalidateStoryStacks(ids: ["my-story", response.storyId])
            storyUploadNotice.showPosted()
            NotificationCenter.default.post(name: .storyUploadDidComplete, object: nil)
        }
    }
}

@MainActor
final class StoryUploadNoticeStore: ObservableObject {
    enum State: Equatable {
        case processing
        case posted
    }

    @Published var state: State?
    private var dismissTask: Task<Void, Never>?

    var title: String {
        switch state {
        case .processing:
            "Video is processing"
        case .posted:
            "Added to your story"
        case nil:
            ""
        }
    }

    var message: String {
        switch state {
        case .processing:
            "It will appear in My Story as soon as it is ready."
        case .posted:
            "Your story is live."
        case nil:
            ""
        }
    }

    var systemImage: String {
        switch state {
        case .processing:
            "arrow.triangle.2.circlepath"
        case .posted:
            "checkmark.circle.fill"
        case nil:
            "checkmark.circle.fill"
        }
    }

    var isProcessing: Bool {
        state == .processing
    }

    func showProcessing() {
        dismissTask?.cancel()
        state = .processing
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
        .buttonStyle(.plain)
        .accessibilityLabel("Profile")
        .frame(width: UBEYEMetrics.topAvatar, height: UBEYEMetrics.topAvatar)
        .zIndex(100)
    }
}

enum AppTab: String, CaseIterable, Identifiable {
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

struct AppBottomBar: View {
    @Binding var selectedTab: AppTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    ZStack {
                        if tab == .post {
                            Circle()
                                .fill(Color.ubeyeInk)
                                .frame(width: 46, height: 46)
                        }

                        Image(systemName: tab.systemImage)
                            .font(.system(size: iconFontSize(for: tab), weight: .semibold))
                            .symbolVariant(selectedTab == tab && tab != .post ? .fill : .none)
                            .foregroundStyle(tab == .post ? .white : (selectedTab == tab ? Color.ubeyeInk : Color.ubeyeMuted))
                            .frame(width: iconFrameSize(for: tab), height: iconFrameSize(for: tab))
                            .offset(x: iconOpticalOffset(for: tab))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.title)
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
}
