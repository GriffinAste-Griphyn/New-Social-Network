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
    init() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor.white
        appearance.shadowColor = UIColor(Color.ubeyeBorder)
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }

    var body: some View {
        TabView {
            FollowingView()
                .tabItem {
                    Label("Following", systemImage: "mappin.and.ellipse")
                }

            HomeView()
                .tabItem {
                    Label("Stories", systemImage: "message")
                }

            StoryComposerView()
                .tabItem {
                    Label("Add", systemImage: "camera.fill")
                }

            DiscoverView()
                .tabItem {
                    Label("Network", systemImage: "person.2.fill")
                }

            RepliesView()
                .tabItem {
                    Label("Replies", systemImage: "paperplane.fill")
                }
                .badge("")
        }
        .tint(.ubeyeRed)
    }
}
