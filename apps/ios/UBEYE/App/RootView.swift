import SwiftUI

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        Group {
            if auth.account == nil {
                AuthView()
            } else {
                MainTabView()
            }
        }
        .animation(.snappy, value: auth.account?.mobileToken)
    }
}

struct MainTabView: View {
    @State private var selectedTab: AppTab = .home

    var body: some View {
        ZStack {
            switch selectedTab {
            case .home:
                HomeView()
            case .following:
                FollowingView()
            case .post:
                StoryComposerView()
            case .discover:
                DiscoverView()
            case .replies:
                RepliesView()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            AppBottomBar(selectedTab: $selectedTab)
        }
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
        HStack {
            ForEach(AppTab.allCases) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    VStack(spacing: 5) {
                        if tab == .post {
                            Image(systemName: tab.systemImage)
                                .font(.system(size: 21, weight: .medium))
                                .frame(width: 34, height: 34)
                                .foregroundStyle(.white)
                                .background(Color.ubeyeRed, in: Circle())
                        } else {
                            Image(systemName: tab.systemImage)
                                .font(.system(size: 27, weight: .medium))
                                .symbolVariant(selectedTab == tab ? .fill : .none)
                                .foregroundStyle(selectedTab == tab ? Color.ubeyeInk : Color.ubeyeMuted)
                        }

                        Text(tab.title)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(selectedTab == tab ? Color.ubeyeInk : Color.ubeyeMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(Color.white)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.ubeyeBorder)
                .frame(height: 1)
        }
    }
}
